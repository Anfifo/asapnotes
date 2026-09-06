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

use crate::corpus::store;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
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
    /// this says, because capture means start typing.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_note_type: Option<String>,
    /// Which layout the project map opens in: `clusters`, `constellation` or
    /// `ledger`. Absent means constellation. One preference for every map — a
    /// person reads all their maps the same way.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub map_view: Option<String>,
    /// Double-clicking a referenced non-markdown file on the map opens it
    /// with the system default app instead of the in-app read-only view.
    /// Absent means the in-app view.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub open_files_externally: Option<bool>,
    /// Folder the meeting dialog offers first — wherever the last meeting
    /// went. Absent means the notes root.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meeting_folder: Option<String>,
    /// Named sets of projects, workspace name → project names. A view over the
    /// registry: nothing on disk moves, a project may sit in any number of
    /// sets, and "Default" — every project — is implicit, so an absent map
    /// means the switcher offers nothing but Default. Personal because the
    /// grouping is this person's, not the project's.
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub workspaces: BTreeMap<String, Vec<String>>,
    /// The workspace the app is on; absent means Default.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_workspace: Option<String>,
    /// What the MCP sidecar may reach. Defaults live in [`Mcp`]'s accessors, so
    /// an absent block behaves exactly like a written-out block of defaults.
    #[serde(skip_serializing_if = "Mcp::is_default")]
    pub mcp: Mcp,
}

/// Sidecar access, the whole of it. Every field here is a thing an agent must
/// not be able to change about itself, which is why the settings write tool
/// refuses this block outright rather than validating field by field.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Mcp {
    /// Grant for projects that live in the notes root, and for top-level notes.
    /// Absent means `read`: the notes root is the app's own folder, so reading
    /// it is what a sidecar is for, while writing still has to be asked for.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes_root: Option<String>,
    /// Grant for projects linked from elsewhere on disk. Absent means `off` —
    /// a linked project is somebody's repository, and the project model already
    /// treats it as the untrusted side.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub linked: Option<String>,
    /// `any` (absent) or `current`: whether writes are confined to the project
    /// the app is currently on.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub write_scope: Option<String>,
    /// Access to `settings.json` itself. Absent means `off`, because this file
    /// names every machine path on the box — turning it on is a deliberate act.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub settings: Option<String>,
}

impl Mcp {
    fn is_default(&self) -> bool {
        self == &Mcp::default()
    }
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
            map_view: None,
            open_files_externally: None,
            meeting_folder: None,
            workspaces: BTreeMap::new(),
            current_workspace: None,
            mcp: Mcp::default(),
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
    /// Notes panel closed from its header; the View menu reopens it.
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
    ]
}

/// The registry as shipped 2026-08-16 through 2026-08-24, when the app had a
/// canvas view: the canvas type declaring pictures and ink. The view left on
/// 2026-08-25, so a file on this snapshot upgrades to a registry without it —
/// and a `.canvas` file stops being a note. Composed from the frozen
/// [`v5_note_types`], so this snapshot cannot drift either.
fn v6_note_types() -> Vec<NoteType> {
    let mut types = v5_note_types();
    for t in &mut types {
        if t.id == "canvas" {
            t.features = vec!["images".into(), "ink".into()];
        }
    }
    types
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
/// canvas — which is also today's registry, the canvas having come and gone in
/// between. Frozen literally like the snapshots below (deriving it from the
/// live defaults would drift the moment they change), so `load` can upgrade
/// untouched defaults without touching a hand-edit.
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

/// A shipped registry, verbatim, upgraded to the current one; any hand-edit
/// means the whole list belongs to the user and nothing is touched. `true` when
/// something changed, which is the caller's cue to write the file back.
pub(crate) fn upgrade_registry(settings: &mut Settings) -> bool {
    let shipped = [
        v1_note_types(),
        v2_note_types(),
        v3_note_types(),
        v4_note_types(),
        v5_note_types(),
        v6_note_types(),
    ]
    .contains(&settings.note_types);
    if !shipped || settings.note_types == default_note_types() {
        return false;
    }
    settings.note_types = default_note_types();
    true
}

/// Loaded state, as this process holds it. A parse failure keeps the app
/// running on shipped defaults and carries the message to the frontend, rather
/// than letting one typo in a hand-editable file take the app down; writes are
/// refused while it is set, so the file the user has to fix is never
/// overwritten.
struct Loaded {
    settings: Arc<Settings>,
    error: Option<String>,
}

/// Parsed settings in app state, filled on first use and replaced on write.
#[derive(Default)]
pub struct Cache(Mutex<Option<Loaded>>);

/// Reading and writing the file is [`crate::corpus::store`]'s job — the helper
/// binary has to do exactly the same thing without an `AppHandle`, and two
/// implementations of "which settings.json" is the one bug in this area that
/// fails silently.
fn load(app: &AppHandle) -> Result<Loaded, String> {
    let loaded = store::load(&crate::app_paths::roots(app)?)?;
    Ok(Loaded {
        settings: Arc::new(loaded.settings),
        error: loaded.error,
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
    store::write(&crate::app_paths::roots(app)?.settings_file(), &next)?;
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

/// Which layout the project map opens in. The default is stored as absent, so
/// the file never holds shipped behavior; anything but the three names is
/// refused here rather than read back as the default and mistaken for a bug.
#[tauri::command]
pub fn set_map_view(app: AppHandle, view: String) -> Result<(), String> {
    update(&app, |s| {
        s.map_view = match view.as_str() {
            "constellation" => None,
            "clusters" | "ledger" => Some(view),
            other => return Err(format!("not a map view: {other}")),
        };
        Ok(())
    })
}

/// Where the meeting dialog points first: the folder the last meeting note
/// went to. The notes root is the default and is stored as absent. Not
/// validated against existing folders — a folder that has since been removed
/// just makes the dialog offer a name the user can change.
#[tauri::command]
pub fn set_meeting_folder(app: AppHandle, folder: Option<String>) -> Result<(), String> {
    update(&app, |s| {
        s.meeting_folder = folder.filter(|f| !f.is_empty());
        Ok(())
    })
}

/// The workspace table, replaced whole — the editing surface holds all of it,
/// so rename, add and remove are one write each. Names are trimmed; an empty
/// one, or "Default" (the implicit all-projects workspace), is refused rather
/// than stored. Project names are not checked against the registry: a project
/// can be unlinked and come back, and a name matching nothing shows nothing.
#[tauri::command]
pub fn set_workspaces(
    app: AppHandle,
    workspaces: BTreeMap<String, Vec<String>>,
) -> Result<(), String> {
    update(&app, |s| {
        let mut next = BTreeMap::new();
        for (name, mut projects) in workspaces {
            let name = name.trim().to_string();
            if name.is_empty() {
                return Err("a workspace needs a name".to_string());
            }
            if name.eq_ignore_ascii_case("default") {
                return Err("\"Default\" is every project and can't be redefined".to_string());
            }
            projects.sort();
            projects.dedup();
            next.insert(name, projects);
        }
        // A workspace that is gone can't stay current.
        if s.current_workspace
            .as_ref()
            .is_some_and(|c| !next.contains_key(c))
        {
            s.current_workspace = None;
        }
        s.workspaces = next;
        Ok(())
    })
}

/// Which workspace the app is on; `None` is Default. A name the table doesn't
/// hold is refused, so the file never points at nothing.
#[tauri::command]
pub fn set_current_workspace(app: AppHandle, name: Option<String>) -> Result<(), String> {
    update(&app, |s| {
        if let Some(n) = &name {
            if !s.workspaces.contains_key(n) {
                return Err(format!("no workspace named \"{n}\""));
            }
        }
        s.current_workspace = name;
        Ok(())
    })
}

/// Whether referenced non-markdown files open with the system default app
/// instead of the in-app read-only view. Off is the default, so off is stored
/// as absent — the file never holds shipped behavior.
#[tauri::command]
pub fn set_open_files_externally(app: AppHandle, on: bool) -> Result<(), String> {
    update(&app, |s| {
        s.open_files_externally = on.then_some(true);
        Ok(())
    })
}

/// The three grant words. Refused here rather than stored, because everything
/// downstream reads an unknown value as `off` — so a typo arriving from the UI
/// would silently hide a project instead of reporting a bug.
fn checked_grant(grant: &str) -> Result<Option<String>, String> {
    match grant {
        "off" | "read" | "write" => Ok(Some(grant.to_string())),
        other => Err(format!("not an MCP grant: {other}")),
    }
}

/// What a sidecar may do with one project. Stored explicitly even when it
/// matches the default for where the project lives: a grant someone set is
/// worth reading back in the file, and an explicit value can't move under a
/// changed default.
#[tauri::command]
pub fn set_mcp_grant(app: AppHandle, project: String, grant: String) -> Result<(), String> {
    let value = checked_grant(&grant)?;
    update(&app, |s| {
        s.projects.entry(project).or_default().mcp = value;
        Ok(())
    })
}

/// Whether writes are confined to the project the app is currently on.
/// `any` is shipped behavior, so it is stored as absent.
#[tauri::command]
pub fn set_mcp_write_scope(app: AppHandle, scope: String) -> Result<(), String> {
    let value = match scope.as_str() {
        "any" => None,
        "current" => Some("current".to_string()),
        other => return Err(format!("not a write scope: {other}")),
    };
    update(&app, |s| {
        s.mcp.write_scope = value;
        Ok(())
    })
}

/// Access to `settings.json` itself. Separate from the per-project grants
/// because it is a different kind of decision: this file names every project
/// location on the machine.
#[tauri::command]
pub fn set_mcp_settings_access(app: AppHandle, grant: String) -> Result<(), String> {
    let value = checked_grant(&grant)?;
    update(&app, |s| {
        s.mcp.settings = value;
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
    fn workspaces_are_absent_until_defined() {
        // Default writes nothing about workspaces, so an untouched file stays
        // as it was; a written table and the current name read back as-is.
        let data = serde_json::to_string(&Settings::default()).expect("serializes");
        assert!(!data.contains("workspaces"));
        assert!(!data.contains("currentWorkspace"));
        let json = r#"{"workspaces":{"Work":["acme","asapnotes"]},"currentWorkspace":"Work"}"#;
        let s: Settings = serde_json::from_str(json).expect("parses");
        assert_eq!(s.workspaces["Work"], vec!["acme", "asapnotes"]);
        assert_eq!(s.current_workspace.as_deref(), Some("Work"));
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
    fn v3_era_registry_is_todays_registry() {
        // An untouched 2026-08-13 settings.json parses back to the snapshot…
        let data = serde_json::to_string(&v3_note_types()).expect("serializes");
        let parsed: Vec<NoteType> = serde_json::from_str(&data).expect("parses");
        assert_eq!(parsed, v3_note_types());
        // …which is exactly what ships now: the canvas type came and went, and
        // a file from before it needs no upgrade at all.
        assert_eq!(v3_note_types(), default_note_types());
        let mut s = Settings::default();
        assert!(!upgrade_registry(&mut s));
    }

    /// The three canvas-era snapshots differ from today's registry by the
    /// canvas entry alone, so each upgrades by losing exactly that entry.
    fn upgrades_by_dropping_canvas(types: Vec<NoteType>) {
        let data = serde_json::to_string(&types).expect("serializes");
        let parsed: Vec<NoteType> = serde_json::from_str(&data).expect("parses");
        assert_eq!(parsed, types);
        assert_ne!(types, default_note_types());
        let without: Vec<NoteType> = types.iter().filter(|t| t.id != "canvas").cloned().collect();
        assert_eq!(without, default_note_types());
        let mut s = Settings {
            note_types: types,
            ..Settings::default()
        };
        assert!(upgrade_registry(&mut s));
        assert_eq!(s.note_types, default_note_types());
    }

    #[test]
    fn v4_era_registry_round_trips_and_upgrades() {
        upgrades_by_dropping_canvas(v4_note_types());
    }

    #[test]
    fn v5_era_registry_round_trips_and_upgrades() {
        upgrades_by_dropping_canvas(v5_note_types());
    }

    #[test]
    fn v6_era_registry_round_trips_and_upgrades() {
        upgrades_by_dropping_canvas(v6_note_types());
    }

    #[test]
    fn a_hand_edited_registry_is_never_upgraded() {
        let mut s = Settings::default();
        s.note_types.push(NoteType {
            id: "canvas".into(),
            name: "My boards".into(),
            extensions: vec!["canvas".into()],
            view: "text".into(),
            icon: None,
            color: None,
            features: Vec::new(),
            listed: true,
        });
        let before = s.note_types.clone();
        assert!(!upgrade_registry(&mut s));
        assert_eq!(s.note_types, before);
    }

    #[test]
    fn no_shipped_type_claims_canvas_files() {
        let s = Settings::default();
        assert!(!s.is_note("board.canvas"));
        assert!(s.type_for("board.canvas").is_none());
    }
}
