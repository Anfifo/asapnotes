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
    /// Personal `.gitignore`-syntax patterns applied to every walk, matched
    /// against the path inside each project (or the notes root). A project's
    /// `.asapnotes.json` `files` list is appended after these — one ordered
    /// list, last match wins, so the project file is the override.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub files: Vec<String>,
    /// Where "New virtual folder" creates its backing folders. Absent means
    /// `virtual` in app data. A machine path, so it lives here and never in a
    /// project file.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub virtual_folders_root: Option<String>,
    /// Overrides for the app-level shortcuts, action id → chord. Only
    /// overrides are stored — the defaults (and what the ids mean) are the
    /// frontend's action table, so absent means shipped behavior.
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub keybinds: BTreeMap<String, String>,
    /// The global summon hotkey; absent means the shipped default.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summon_hotkey: Option<String>,
    /// Registry type id a deliberate "New note" creates; absent means markdown.
    /// Capture — the blank note a summon lands in — is always markdown whatever
    /// this says, because a canvas is not a place to start typing.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_note_type: Option<String>,
    /// Note id of a canvas the window opens on at launch, instead of the last
    /// active tab. Absent means the tab that was up stays up.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub open_at_launch: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: VERSION,
            appearance: Appearance::default(),
            projects: BTreeMap::new(),
            note_types: default_note_types(),
            files: Vec::new(),
            virtual_folders_root: None,
            keybinds: BTreeMap::new(),
            summon_hotkey: None,
            default_note_type: None,
            open_at_launch: None,
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
    /// Where a note type's color lands on an explorer row: `full` (icon and
    /// extension, the default) or `icon` (extension stays in the muted ink).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub explorer_tint: Option<String>,
    /// Popup text size (menus, context menus, palette rows) as a percentage
    /// of the default; the frontend scales its size token by it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub popup_scale: Option<f64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ExplorerAppearance {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pinned: Option<bool>,
    /// Height of the current-project panel; absent means size-to-content.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pane: Option<f64>,
    /// Panels closed from their header; the View menu reopens them.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hide_recent: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hide_notes: Option<bool>,
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
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct NoteType {
    pub id: String,
    pub name: String,
    /// Without a leading dot, matched case-insensitively.
    pub extensions: Vec<String>,
    /// Id of an editing surface the app implements.
    pub view: String,
    /// Id of a glyph the app ships; unknown ids fall back to the plain file.
    pub icon: Option<String>,
    /// Id of a tint the app defines per theme (`blue`, `amber`, `rose`, …), or
    /// a literal `#rrggbb` for someone who accepts it won't adapt to themes.
    pub color: Option<String>,
    /// Affordance names from the app's closed set; anything else is ignored.
    pub features: Vec<String>,
    /// Whether the walks show this type uninvited. An unlisted type keeps its
    /// view, icon and color and stays openable — a `!` pattern (personal or
    /// per-project) pulls it back in with everything intact. Absent means
    /// listed, so a hand-edited registry keeps behaving as it always has.
    #[serde(default = "listed_default", skip_serializing_if = "is_true")]
    pub listed: bool,
}

fn listed_default() -> bool {
    true
}

fn is_true(b: &bool) -> bool {
    *b
}

/// The shipped registry. Written into `settings.json` on first launch so it is
/// there to be edited, and the union of these extensions is the note allowlist
/// on both sides of the IPC boundary — one list, not two kept in sync.
///
/// One type per icon/color family rather than one catch-all "plain text",
/// so the explorer can tell a data file from a log from a config — the
/// extension union is the same either way. Only the authored-prose types are
/// `listed` by default: config, data and log files exist beside notes without
/// being notes, so they stay out of the walks until a pattern opts them in.
fn default_note_types() -> Vec<NoteType> {
    let strings = |v: &[&str]| v.iter().map(|s| (*s).to_string()).collect::<Vec<_>>();
    let plain =
        |id: &str, name: &str, exts: &[&str], icon: &str, color: Option<&str>, listed| NoteType {
            id: id.into(),
            name: name.into(),
            extensions: strings(exts),
            view: "text".into(),
            icon: Some(icon.into()),
            color: color.map(Into::into),
            features: Vec::new(),
            listed,
        };
    vec![
        NoteType {
            id: "markdown".into(),
            name: "Markdown".into(),
            extensions: strings(&["md", "markdown"]),
            view: "markdown".into(),
            icon: Some("file-text".into()),
            color: Some("blue".into()),
            features: strings(&["live-preview", "preview", "mentions", "format", "images"]),
            listed: true,
        },
        plain("text", "Plain text", &["txt", "text"], "file", None, true),
        plain("json", "JSON", &["json"], "file-json", Some("amber"), false),
        plain(
            "yaml",
            "YAML",
            &["yaml", "yml"],
            "file-code",
            Some("rose"),
            false,
        ),
        plain(
            "config",
            "Config",
            &["toml", "ini", "cfg"],
            "file-code",
            Some("purple"),
            false,
        ),
        plain(
            "csv",
            "CSV",
            &["csv"],
            "file-spreadsheet",
            Some("green"),
            false,
        ),
        plain("xml", "XML", &["xml"], "file-code", Some("orange"), false),
        plain("log", "Log", &["log"], "file-terminal", Some("gray"), false),
        plain("latex", "LaTeX", &["tex"], "file-text", Some("teal"), true),
        NoteType {
            id: "canvas".into(),
            name: "Canvas".into(),
            extensions: strings(&["canvas"]),
            view: "canvas".into(),
            icon: Some("file-canvas".into()),
            color: Some("amber".into()),
            // What a canvas implements today: pasted and dropped pictures as
            // file nodes, and drawn ink strokes. A feature name is something
            // the app implements, not something it plans.
            features: strings(&["images", "ink"]),
            listed: true,
        },
    ]
}

/// The registry as shipped 2026-08-14 with the freeform canvas: the canvas
/// type declared `images` but not `ink` — strokes didn't exist yet. Composed
/// from the frozen [`v4_note_types`], so this snapshot cannot drift either.
fn v5_note_types() -> Vec<NoteType> {
    let mut types = v4_note_types();
    for t in &mut types {
        if t.id == "canvas" {
            t.features = vec!["images".into()];
        }
    }
    types
}

/// The registry as shipped earlier on 2026-08-14: the canvas type had arrived
/// but declared no features, because nothing on a canvas took an image yet.
/// Composed from [`v3_note_types`] rather than spelled out — that snapshot is
/// itself frozen, so this one cannot drift either, which is the property the
/// literal snapshots are there to guarantee.
fn v4_note_types() -> Vec<NoteType> {
    let strings = |v: &[&str]| v.iter().map(|s| (*s).to_string()).collect::<Vec<_>>();
    let mut types = v3_note_types();
    types.push(NoteType {
        id: "canvas".into(),
        name: "Canvas".into(),
        extensions: strings(&["canvas"]),
        view: "canvas".into(),
        icon: Some("file-canvas".into()),
        color: Some("amber".into()),
        features: Vec::new(),
        listed: true,
    });
    types
}

/// The registry as shipped 2026-08-13: nine types with `listed` flags, no
/// canvas — the view didn't exist yet. Frozen literally like the snapshots
/// below (deriving it from the live defaults would drift the moment they
/// change), so `load` can upgrade untouched defaults without touching a
/// hand-edit.
fn v3_note_types() -> Vec<NoteType> {
    let strings = |v: &[&str]| v.iter().map(|s| (*s).to_string()).collect::<Vec<_>>();
    let plain =
        |id: &str, name: &str, exts: &[&str], icon: &str, color: Option<&str>, listed| NoteType {
            id: id.into(),
            name: name.into(),
            extensions: strings(exts),
            view: "text".into(),
            icon: Some(icon.into()),
            color: color.map(Into::into),
            features: Vec::new(),
            listed,
        };
    vec![
        NoteType {
            id: "markdown".into(),
            name: "Markdown".into(),
            extensions: strings(&["md", "markdown"]),
            view: "markdown".into(),
            icon: Some("file-text".into()),
            color: Some("blue".into()),
            features: strings(&["live-preview", "preview", "mentions", "format", "images"]),
            listed: true,
        },
        plain("text", "Plain text", &["txt", "text"], "file", None, true),
        plain("json", "JSON", &["json"], "file-json", Some("amber"), false),
        plain(
            "yaml",
            "YAML",
            &["yaml", "yml"],
            "file-code",
            Some("rose"),
            false,
        ),
        plain(
            "config",
            "Config",
            &["toml", "ini", "cfg"],
            "file-code",
            Some("purple"),
            false,
        ),
        plain(
            "csv",
            "CSV",
            &["csv"],
            "file-spreadsheet",
            Some("green"),
            false,
        ),
        plain("xml", "XML", &["xml"], "file-code", Some("orange"), false),
        plain("log", "Log", &["log"], "file-terminal", Some("gray"), false),
        plain("latex", "LaTeX", &["tex"], "file-text", Some("teal"), true),
    ]
}

/// The registry as shipped 2026-08-12: nine types, everything listed —
/// `listed` didn't exist yet, so a file from that era parses to exactly this.
/// A frozen snapshot like [`v1_note_types`] (literal on purpose — deriving it
/// from the live defaults would drift the moment they change), kept so `load`
/// can upgrade untouched defaults without touching a hand-edited registry.
fn v2_note_types() -> Vec<NoteType> {
    let strings = |v: &[&str]| v.iter().map(|s| (*s).to_string()).collect::<Vec<_>>();
    let plain = |id: &str, name: &str, exts: &[&str], icon: &str, color: Option<&str>| NoteType {
        id: id.into(),
        name: name.into(),
        extensions: strings(exts),
        view: "text".into(),
        icon: Some(icon.into()),
        color: color.map(Into::into),
        features: Vec::new(),
        listed: true,
    };
    vec![
        NoteType {
            id: "markdown".into(),
            name: "Markdown".into(),
            extensions: strings(&["md", "markdown"]),
            view: "markdown".into(),
            icon: Some("file-text".into()),
            color: Some("blue".into()),
            features: strings(&["live-preview", "preview", "mentions", "format", "images"]),
            listed: true,
        },
        plain("text", "Plain text", &["txt", "text"], "file", None),
        plain("json", "JSON", &["json"], "file-json", Some("amber")),
        plain("yaml", "YAML", &["yaml", "yml"], "file-code", Some("rose")),
        plain(
            "config",
            "Config",
            &["toml", "ini", "cfg"],
            "file-code",
            Some("purple"),
        ),
        plain("csv", "CSV", &["csv"], "file-spreadsheet", Some("green")),
        plain("xml", "XML", &["xml"], "file-code", Some("orange")),
        plain("log", "Log", &["log"], "file-terminal", Some("gray")),
        plain("latex", "LaTeX", &["tex"], "file-text", Some("teal")),
    ]
}

/// The registry as first shipped: two types, no colors. Kept only so `load`
/// can tell "still on the shipped defaults" from "hand-edited" — the former is
/// upgraded in place, the latter is never touched.
fn v1_note_types() -> Vec<NoteType> {
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
            listed: true,
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
            listed: true,
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

    /// Whether a walk shows this file uninvited: its type exists *and* wants
    /// listing. Everything else about an unlisted type keeps working —
    /// `is_note` still claims it, so it opens, saves and drafts; only the
    /// default visibility differs, and patterns can re-include it.
    pub fn is_listed(&self, file: &str) -> bool {
        self.type_for(file).is_some_and(|t| t.listed)
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
            Ok(mut settings) => {
                // A file still carrying a shipped registry verbatim (either
                // generation) is upgraded to the current one; any hand-edit
                // means the whole list belongs to the user. A failed write
                // only postpones this — the in-memory upgrade already
                // happened and will be retried.
                if settings.note_types == v1_note_types()
                    || settings.note_types == v2_note_types()
                    || settings.note_types == v3_note_types()
                    || settings.note_types == v4_note_types()
                    || settings.note_types == v5_note_types()
                {
                    settings.note_types = default_note_types();
                    let _ = write(&path, &settings);
                }
                Loaded {
                    settings: Arc::new(settings),
                    error: None,
                }
            }
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

/// Keybind overrides, sent whole — the frontend owns the action table and
/// which entries diverge from it.
#[tauri::command]
pub fn set_keybinds(app: AppHandle, keybinds: BTreeMap<String, String>) -> Result<(), String> {
    update(&app, |s| {
        s.keybinds = keybinds;
        Ok(())
    })
}

/// Which registry type "New note" creates. `None` (or an id no type claims)
/// means markdown; the id is checked here so a stale setting can't leave the
/// verb creating a file the app has no view for.
#[tauri::command]
pub fn set_default_note_type(app: AppHandle, id: Option<String>) -> Result<(), String> {
    update(&app, |s| {
        s.default_note_type = match id {
            Some(id) if s.note_types.iter().any(|t| t.id == id) => Some(id),
            Some(id) => return Err(format!("no note type with id \"{id}\"")),
            None => None,
        };
        Ok(())
    })
}

/// The canvas the window opens on at launch, or `None` to go back to the last
/// active tab. Only a note the registry opens as a canvas qualifies — the point
/// of the setting is a surface to land on, not any file at all.
#[tauri::command]
pub fn set_open_at_launch(app: AppHandle, note: Option<String>) -> Result<(), String> {
    update(&app, |s| {
        s.open_at_launch = match note {
            Some(note) if s.type_for(&note).is_some_and(|t| t.view == "canvas") => Some(note),
            Some(note) => return Err(format!("\"{note}\" is not a canvas")),
            None => None,
        };
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unlisted_types_stay_notes() {
        let s = Settings::default();
        // Config-ish types: openable, savable — just not shown uninvited.
        assert!(s.is_note("data.json"));
        assert!(!s.is_listed("data.json"));
        assert!(s.is_note("app.toml"));
        assert!(!s.is_listed("app.toml"));
        // The authored-prose types list as always.
        assert!(s.is_listed("note.md"));
        assert!(s.is_listed("note.txt"));
        assert!(s.is_listed("paper.tex"));
        // Unknown extension: not a note at all.
        assert!(!s.is_note("main.rs"));
        assert!(!s.is_listed("main.rs"));
    }

    #[test]
    fn registry_without_listed_field_parses_as_listed() {
        // A registry entry written before `listed` existed must keep its old
        // behavior — absent means listed, so only shipped defaults hide types.
        let json = r#"{"id":"json","name":"JSON","extensions":["json"],"view":"text"}"#;
        let t: NoteType = serde_json::from_str(json).expect("parses");
        assert!(t.listed);
    }

    #[test]
    fn v2_era_registry_matches_the_migration_snapshot() {
        // What `load` sees for an untouched 2026-08-12 settings.json: the
        // then-shipped registry serialized without `listed`, parsed today.
        let data = serde_json::to_string(&v2_note_types()).expect("serializes");
        assert!(!data.contains("listed"), "listed:true must not serialize");
        let parsed: Vec<NoteType> = serde_json::from_str(&data).expect("parses");
        assert_eq!(parsed, v2_note_types());
        // And the upgrade is a real change, so migration isn't a no-op.
        assert_ne!(v2_note_types(), default_note_types());
    }

    #[test]
    fn v3_era_registry_round_trips_and_upgrades() {
        // An untouched 2026-08-13 settings.json parses back to the snapshot…
        let data = serde_json::to_string(&v3_note_types()).expect("serializes");
        let parsed: Vec<NoteType> = serde_json::from_str(&data).expect("parses");
        assert_eq!(parsed, v3_note_types());
        // …and the canvas entry makes the upgrade a real change.
        assert_ne!(v3_note_types(), default_note_types());
    }

    #[test]
    fn v4_era_registry_round_trips_and_upgrades() {
        // An untouched settings.json from the first canvas build parses back to
        // the snapshot…
        let data = serde_json::to_string(&v4_note_types()).expect("serializes");
        let parsed: Vec<NoteType> = serde_json::from_str(&data).expect("parses");
        assert_eq!(parsed, v4_note_types());
        // …and differs from today's only in what canvas declares, so the
        // upgrade is exactly the feature and nothing else.
        assert_ne!(v4_note_types(), default_note_types());
        let strip = |types: Vec<NoteType>| {
            types
                .into_iter()
                .map(|mut t| {
                    t.features.clear();
                    t
                })
                .collect::<Vec<_>>()
        };
        assert_eq!(strip(v4_note_types()), strip(default_note_types()));
    }

    #[test]
    fn v5_era_registry_round_trips_and_upgrades() {
        // An untouched settings.json from the freeform-canvas build parses
        // back to the snapshot…
        let data = serde_json::to_string(&v5_note_types()).expect("serializes");
        let parsed: Vec<NoteType> = serde_json::from_str(&data).expect("parses");
        assert_eq!(parsed, v5_note_types());
        // …and differs from today's only in what canvas declares, so the
        // upgrade is exactly the `ink` feature and nothing else.
        assert_ne!(v5_note_types(), default_note_types());
        let strip = |types: Vec<NoteType>| {
            types
                .into_iter()
                .map(|mut t| {
                    t.features.clear();
                    t
                })
                .collect::<Vec<_>>()
        };
        assert_eq!(strip(v5_note_types()), strip(default_note_types()));
    }

    #[test]
    fn canvas_type_is_a_listed_note_that_takes_images_and_ink() {
        let s = Settings::default();
        assert!(s.is_note("board.canvas"));
        assert!(s.is_listed("board.canvas"));
        assert_eq!(
            s.type_for("board.canvas").map(|t| t.view.as_str()),
            Some("canvas")
        );
        let features = s
            .type_for("board.canvas")
            .map(|t| t.features.clone())
            .unwrap_or_default();
        assert!(features.contains(&"images".to_string()));
        assert!(features.contains(&"ink".to_string()));
    }
}
