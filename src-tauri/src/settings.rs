//! Personal configuration: `settings.json` in app data.
//!
//! The half of configuration that must never leave this machine — where linked
//! projects live, appearance, later the MCP grant — as against the portable
//! per-project file planned for file rules. The seam is trust, not scope level:
//! anything that grants access or names a machine path belongs here, because a
//! file inside a project arrives on other machines by `git pull`. See
//! `docs/project-model.md`.
//!
//! Parsed once into app state and replaced on write, rather than re-read per
//! call the way the external-project map it absorbs was. A `reload` reads the
//! file again, so hand-editing while the app runs works; the frontend asks for
//! one when the window regains focus.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

/// Schema version. Every documented key is modeled below, so a write never
/// drops configuration it didn't understand — a new key has to be added here
/// before it can survive one.
const VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub version: u32,
    pub appearance: Appearance,
    /// Attributes for the projects that need them — a location outside the
    /// notes root, mounts, an access grant. Existence stays filesystem-derived
    /// (a first-level subfolder of the notes root is a project whether or not
    /// it appears here), so most projects have no entry at all.
    pub projects: BTreeMap<String, Project>,
    /// The note-type registry. `view` and `icon` are ids into in-tree tables,
    /// so this data can add a format but never a view.
    pub note_types: Vec<NoteType>,
    /// Where "New virtual folder" creates its backing folders. Absent means
    /// `virtual` in app data. A machine path, so it lives here and never in a
    /// project file.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub virtual_folders_root: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: VERSION,
            appearance: Appearance::default(),
            projects: BTreeMap::new(),
            note_types: default_note_types(),
            virtual_folders_root: None,
        }
    }
}

/// Values the frontend also mirrors in `localStorage`, because they are read
/// before the first paint. Absent means "never chosen" — the frontend then
/// keeps whatever that mirror gave it.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Appearance {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zoom: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub explorer: Option<ExplorerAppearance>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ExplorerAppearance {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pinned: Option<bool>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Project {
    /// Absolute folder this project lives in. Absent means it lives at
    /// `<notes root>/<name>`, which is the only difference between a project in
    /// the notes folder and one linked from elsewhere.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// Folders attached into this project at a project-relative name.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub mounts: Vec<Mount>,
    /// MCP access: `off` / `read` / `write`. Carried, not yet consumed — it
    /// lives here rather than in the project so no clone can widen it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Mount {
    /// Project-relative path, one or more segments.
    pub at: String,
    /// Absolute folder on disk.
    pub path: String,
}

impl Project {
    /// This project's mounts, longest `at` first. Every reader takes them in
    /// this order — a note id belongs to the deepest mount point that prefixes
    /// it — because two readers disagreeing about which mount owns a file give
    /// that file two ids, hence two shadow drafts and two tabs that overwrite
    /// each other.
    pub fn sorted_mounts(&self) -> Vec<&Mount> {
        let mut out: Vec<&Mount> = self.mounts.iter().collect();
        out.sort_by_key(|m| std::cmp::Reverse(m.at.len()));
        out
    }
}

/// One note format: which extensions it claims, how it opens, and what the
/// chrome may offer for it.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct NoteType {
    pub id: String,
    pub name: String,
    /// Without a leading dot, matched case-insensitively.
    pub extensions: Vec<String>,
    /// Id of an editing surface the app implements.
    pub view: String,
    pub icon: Option<String>,
    pub color: Option<String>,
    /// Affordance names from the app's closed set; anything else is ignored.
    pub features: Vec<String>,
}

/// The shipped registry. Written into `settings.json` on first launch so it is
/// there to be edited, and the union of these extensions is the note allowlist
/// on both sides of the IPC boundary — one list, not two kept in sync.
fn default_note_types() -> Vec<NoteType> {
    let strings = |v: &[&str]| v.iter().map(|s| (*s).to_string()).collect::<Vec<_>>();
    vec![
        NoteType {
            id: "markdown".into(),
            name: "Markdown".into(),
            extensions: strings(&["md", "markdown"]),
            view: "markdown".into(),
            icon: Some("file-text".into()),
            color: None,
            features: strings(&["live-preview", "preview", "mentions", "format", "images"]),
        },
        NoteType {
            id: "text".into(),
            name: "Plain text".into(),
            extensions: strings(&[
                "txt", "text", "tex", "log", "csv", "json", "yaml", "yml", "ini", "cfg", "toml",
                "xml",
            ]),
            view: "text".into(),
            icon: Some("file".into()),
            color: None,
            features: Vec::new(),
        },
    ]
}

impl Settings {
    /// Type of a file name: the first entry whose extension list contains its
    /// extension wins. A project's own entries will be consulted before these.
    pub fn type_for(&self, file: &str) -> Option<&NoteType> {
        let (stem, ext) = file.rsplit_once('.')?;
        if stem.is_empty() {
            return None;
        }
        self.note_types
            .iter()
            .find(|t| t.extensions.iter().any(|e| e.eq_ignore_ascii_case(ext)))
    }

    /// One definition of "is this a note", shared with the frontend through
    /// this file.
    pub fn is_note(&self, file: &str) -> bool {
        self.type_for(file).is_some()
    }

    /// Registered projects that carry a location of their own (name → folder).
    /// An entry without a `path` lives under the notes root, where the ordinary
    /// walk already finds it.
    pub fn located_projects(&self) -> impl Iterator<Item = (&String, &String)> {
        self.projects
            .iter()
            .filter_map(|(name, p)| p.path.as_ref().map(|path| (name, path)))
    }
}

/// Loaded state. A parse failure keeps the app running on shipped defaults and
/// carries the message to the frontend, rather than letting one typo in a
/// hand-editable file take the app down; writes are refused while it is set, so
/// the file the user has to fix is never overwritten.
struct Loaded {
    settings: Arc<Settings>,
    error: Option<String>,
}

/// Parsed settings in app state, filled on first use and replaced on write.
#[derive(Default)]
pub struct Cache(Mutex<Option<Loaded>>);

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

/// The store this file absorbed: a name → absolute path map of linked projects.
fn legacy_store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("external_projects.json"))
}

/// Write through a temporary file: this one file now holds every project
/// mapping, so a half-written one must never be what survives.
fn write(path: &Path, settings: &Settings) -> Result<(), String> {
    let data = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, data).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Read the file, creating it — and migrating `external_projects.json` into it
/// — on first launch. The old file is removed only once the new one is safely
/// written.
fn load(app: &AppHandle) -> Result<Loaded, String> {
    let path = store_path(app)?;
    if path.exists() {
        let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        return Ok(match serde_json::from_str::<Settings>(&data) {
            Ok(settings) => Loaded {
                settings: Arc::new(settings),
                error: None,
            },
            Err(e) => Loaded {
                settings: Arc::new(Settings::default()),
                error: Some(format!("settings.json: {e}")),
            },
        });
    }
    let mut settings = Settings::default();
    let legacy = legacy_store_path(app)?;
    if legacy.exists() {
        let data = fs::read_to_string(&legacy).map_err(|e| e.to_string())?;
        let map: BTreeMap<String, String> =
            serde_json::from_str(&data).map_err(|e| format!("external_projects.json: {e}"))?;
        for (name, path) in map {
            settings.projects.insert(
                name,
                Project {
                    path: Some(path),
                    ..Project::default()
                },
            );
        }
    }
    write(&path, &settings)?;
    let _ = fs::remove_file(&legacy);
    Ok(Loaded {
        settings: Arc::new(settings),
        error: None,
    })
}

fn cached(app: &AppHandle, fresh: bool) -> Result<(Arc<Settings>, Option<String>), String> {
    let cache = app.state::<Cache>();
    let mut slot = cache.0.lock().map_err(|e| e.to_string())?;
    if fresh || slot.is_none() {
        *slot = Some(load(app)?);
    }
    let loaded = slot.as_ref().expect("just loaded");
    Ok((loaded.settings.clone(), loaded.error.clone()))
}

/// Settings for a command to work from: parsed on first use, then reused.
pub fn settings(app: &AppHandle) -> Result<Arc<Settings>, String> {
    Ok(cached(app, false)?.0)
}

/// Read, change and write under one lock, so two changes racing (a zoom
/// gesture, say) can't leave the older one on disk.
pub fn update<F>(app: &AppHandle, edit: F) -> Result<(), String>
where
    F: FnOnce(&mut Settings) -> Result<(), String>,
{
    let cache = app.state::<Cache>();
    let mut slot = cache.0.lock().map_err(|e| e.to_string())?;
    if slot.is_none() {
        *slot = Some(load(app)?);
    }
    let loaded = slot.as_ref().expect("just loaded");
    if let Some(error) = &loaded.error {
        return Err(format!("{error} — settings were not changed"));
    }
    let mut next = (*loaded.settings).clone();
    edit(&mut next)?;
    write(&store_path(app)?, &next)?;
    *slot = Some(Loaded {
        settings: Arc::new(next),
        error: None,
    });
    Ok(())
}

/// The settings document, plus the parse error if the file couldn't be read —
/// in which case shipped defaults are in force and nothing will be written
/// over it.
#[derive(Serialize)]
pub struct SettingsRead {
    settings: Arc<Settings>,
    error: Option<String>,
}

/// `reload: true` re-reads the file first, which is how a hand-edit takes
/// effect (the frontend asks on window focus).
#[tauri::command]
pub fn get_settings(app: AppHandle, reload: Option<bool>) -> Result<SettingsRead, String> {
    let (settings, error) = cached(&app, reload.unwrap_or(false))?;
    Ok(SettingsRead { settings, error })
}

/// Appearance is owned by the frontend, which sends the whole block — the file
/// is the source of truth, `localStorage` is only its pre-paint mirror.
#[tauri::command]
pub fn set_appearance(app: AppHandle, appearance: Appearance) -> Result<(), String> {
    update(&app, |s| {
        s.appearance = appearance;
        Ok(())
    })
}
