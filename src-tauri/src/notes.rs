//! Filesystem commands for notes, projects, shadow drafts, and pasted assets.
//!
//! Layout of the notes root (`Documents/asapnotes`): note files (any extension
//! the note-type registry claims; `.md` is the default) at the top level belong
//! to no project; each first-level subfolder is a project; `assets/`
//! holds pasted images and is not a project. A note's id everywhere is its
//! root-relative path (`note.md` or `project/note.md`).
//!
//! A registered project extends this: an entry in [`crate::settings`] gives a
//! project a location anywhere on disk, plus any number of *mounts* — folders
//! attached into it at a project-relative name. Its notes keep the same id
//! shape — `name/rel/path/note.md`, any depth — and the id decides where the
//! file lives: the deepest mount point prefixing it wins, else the project's
//! own location, else the notes root. [`base_of`] is that rule, and `noteIdOf`
//! in `src/App.tsx` is its inverse — the two have to agree, or one file
//! acquires two ids, hence two shadow drafts and two tabs that can overwrite
//! each other. Every folder the app resolves ids from is kept disjoint from
//! every other ([`check_location`]) for the same reason.
//!
//! Which files count as notes is, by default, the registry allowlist minus the
//! skipped directories; a project's `.asapnotes.json` overrides that with
//! ordered `files` patterns ([`crate::project_config`]), which every walk here
//! — listing, search, scan counts — and the id checks read the same way.
//!
//! Drafts live in app data, mirror the same relative paths, and hold unsaved
//! editor state: a draft named like an existing note is its unsaved edits, any
//! other draft is an unsaved untitled note. `Ctrl+S` on the frontend writes the
//! note and deletes the draft.

use crate::corpus::log as mcp_log;
use crate::corpus::search::{self, Query, SearchHit};
use crate::corpus::walk::{self, collect_md_deep, project_dirs, skip_dir, FileInfo, ProjectInfo};
use crate::corpus::{grants, ids, tools, Roots};
use crate::history;
use crate::project_config::{self, Rules};
use crate::settings::{self, Mount, Project, Settings};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager};

pub(crate) use crate::corpus::ids::{
    project_base, valid_segment, ASSETS_DIR, MAX_DEPTH, MAX_SEARCH_BYTES,
};

const IMAGE_EXTS: [&str; 7] = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];

/// This process's corpus roots. Every command starts here, and what the roots
/// then *mean* — which files are notes, where an id lands, what a project's
/// rules admit — lives in [`crate::corpus`], which the MCP helper binary shares
/// verbatim. That sharing is the point: those rules decide what a caller may
/// see, so a second implementation of them would be an access-boundary bug.
fn roots(app: &AppHandle) -> Result<Roots, String> {
    crate::app_paths::roots(app)
}

fn notes_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(roots(app)?.notes)
}

fn drafts_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = roots(app)?.data.join("drafts");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn now_ms() -> u64 {
    crate::corpus::now_ms()
}

fn checked_name<'a>(app: &AppHandle, s: &Settings, name: &'a str) -> Result<&'a str, String> {
    ids::checked_name(&roots(app)?, s, name)
}

fn base_of<'a>(app: &AppHandle, s: &Settings, name: &'a str) -> Result<(PathBuf, &'a str), String> {
    Ok(ids::base_of(&roots(app)?, s, name))
}

/// Absolute path of a note id.
fn resolve_note(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let s = settings::settings(app)?;
    ids::resolve(&roots(app)?, &s, name)
}

/// Resolve a note id inside `base`, creating the project folder if needed.
fn note_path(app: &AppHandle, s: &Settings, base: &Path, name: &str) -> Result<PathBuf, String> {
    let name = checked_name(app, s, name)?;
    let path = base.join(name);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    Ok(path)
}

/// `deep: false` skips the walk of folders outside the notes root (which can be
/// slow) so the first paint after launch isn't held up by it; a deep call
/// follows.
#[tauri::command]
pub fn list_notes(app: AppHandle, deep: Option<bool>) -> Result<Vec<FileInfo>, String> {
    let s = settings::settings(&app)?;
    walk::list_notes(&roots(&app)?, &s, deep.unwrap_or(true))
}

/// Every note id paired with its absolute path — the same corpus [`list_notes`]
/// enumerates, but resolved once instead of per note.
pub(crate) fn note_paths(app: &AppHandle) -> Result<Vec<(String, PathBuf)>, String> {
    let s = settings::settings(app)?;
    walk::note_paths(&roots(app)?, &s)
}

/// Case-insensitive literal search over every note's contents.
#[tauri::command]
pub fn search_notes(
    app: AppHandle,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<SearchHit>, String> {
    let s = settings::settings(&app)?;
    let mut q = Query::new(query);
    if let Some(limit) = limit {
        q.limit = limit;
    }
    // The app shows the user their own corpus — no visibility boundary here.
    search::search(&roots(&app)?, &s, &q, None)
}

/// Notes-root subfolders plus the registered projects that live elsewhere.
#[tauri::command]
pub fn list_projects(app: AppHandle) -> Result<Vec<ProjectInfo>, String> {
    let s = settings::settings(&app)?;
    walk::list_projects(&roots(&app)?, &s)
}

/// Tell the sidecar where the app is: the project of the active note, and the
/// notes root this process resolved.
///
/// The project half only matters under `mcp.writeScope: "current"`, where it is
/// what confines an agent's writes to whatever the user is actually working on.
/// The root half always matters — it is what stops the helper from having to
/// guess, and a helper that guesses a different notes root serves a different
/// corpus while looking perfectly healthy.
#[tauri::command]
pub fn set_mcp_current_project(app: AppHandle, project: Option<String>) -> Result<(), String> {
    grants::publish(&roots(&app)?, project, helper_path().as_deref())
}

/// What the sidecar can see, and what it last changed — the read behind
/// Settings' MCP section.
///
/// "Status" for a stdio server the app does not spawn can't honestly mean
/// "connected": nothing here knows whether a client is attached. What it can
/// mean is the last thing that actually happened, which is a fact on hand.
#[tauri::command]
pub fn mcp_status(app: AppHandle) -> Result<serde_json::Value, String> {
    let roots = roots(&app)?;
    let mut status = tools::dispatch(&roots, "doctor", &serde_json::json!({}))?;
    status["recentCalls"] =
        serde_json::to_value(mcp_log::tail(&roots, 20)).map_err(|e| e.to_string())?;
    let helper = helper_path();
    status["helperExists"] = serde_json::json!(helper.as_ref().is_some_and(|p| p.exists()));
    status["helperPath"] = serde_json::json!(helper.map(|p| p.to_string_lossy().into_owned()));
    status["serverPath"] =
        serde_json::json!(server_path().map(|p| p.to_string_lossy().into_owned()));
    Ok(status)
}

/// Where the helper binary is, so Settings can print a path a client config can
/// paste verbatim rather than a build command.
///
/// It sits beside the app executable because it is a second `[[bin]]` of this
/// same crate, and the bundler ships every binary the crate builds — which is
/// also why shipping it needs no bundle configuration of its own.
///
/// In a dev tree nothing is beside the executable, so the path won't exist and
/// `helperExists` is false. The panel has to tell the two apart: offering a
/// path that isn't there is worse than offering none.
pub(crate) fn helper_path() -> Option<PathBuf> {
    let name = if cfg!(windows) {
        "asapnotes-mcp.exe"
    } else {
        "asapnotes-mcp"
    };
    Some(std::env::current_exe().ok()?.parent()?.join(name))
}

/// The stdio server's entry point, when it is findable. In a source tree the
/// app's executable sits three folders below the repository root, so the `mcp`
/// package is a known hop away; an installed build does not carry that package,
/// and returning `None` there is what lets the panel print a placeholder rather
/// than a path that does not exist.
fn server_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let repo = exe.parent()?.parent()?.parent()?.parent()?;
    let entry = repo.join("mcp").join("dist").join("src").join("index.js");
    entry.exists().then_some(entry)
}

#[tauri::command]
pub fn notes_root_path(app: AppHandle) -> Result<String, String> {
    Ok(notes_root(&app)?.to_string_lossy().into_owned())
}

/// Parse problems in any project's `.asapnotes.json`. The walks fall back to
/// default rules rather than failing the whole listing over one typo, so a
/// broken hand-editable file has to be reported out of band — the frontend
/// asks on window focus, the same signal that re-reads `settings.json`.
#[tauri::command]
pub fn project_config_errors(app: AppHandle) -> Result<Vec<String>, String> {
    let root = notes_root(&app)?;
    let s = settings::settings(&app)?;
    let mut out = Vec::new();
    // The personal pattern layer reports here too: a bad pattern is skipped in
    // the walks, so this channel is the only place it becomes visible.
    if let (_, Some(e)) = project_config::personal_rules(&s.files) {
        out.push(format!("settings.json files: {e}"));
    }
    for project in project_dirs(&root)? {
        if let (_, Some(e)) = project_config::rules_for(&root.join(&project)) {
            out.push(e);
        }
    }
    for (_, dir) in s.located_projects() {
        if let (_, Some(e)) = project_config::rules_for(Path::new(dir)) {
            out.push(e);
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn read_note(app: AppHandle, name: String) -> Result<String, String> {
    fs::read_to_string(resolve_note(&app, &name)?).map_err(|e| e.to_string())
}

/// The read-only file view refuses what it couldn't show anyway, with the
/// reason as the error.
const MAX_LENS_BYTES: u64 = 2_000_000;

/// A referenced file's text, for the read-only file view: any real file the
/// project map points at, inside the corpus or out. Read-only by
/// construction — there is no write twin.
#[tauri::command]
pub fn read_file_text(path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    if !p.is_absolute() {
        return Err(format!("not an absolute path: {path}"));
    }
    let meta = fs::metadata(&p).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("not a file".into());
    }
    if meta.len() > MAX_LENS_BYTES {
        return Err("it's too large to view here".into());
    }
    let bytes = fs::read(&p).map_err(|e| e.to_string())?;
    // A NUL early on is the honest binary signal — rendering mojibake would
    // only pretend the view works on such files.
    if bytes.iter().take(8192).any(|&b| b == 0) {
        return Err("it isn't text".into());
    }
    // A UTF-8 BOM is encoding plumbing, not content — shown, it reads as a
    // stray invisible character on the first line.
    let text = String::from_utf8_lossy(&bytes);
    Ok(text.strip_prefix('\u{feff}').unwrap_or(&text).to_owned())
}

/// Modification time of a note's file (ms), `None` if it doesn't exist —
/// the frontend's external-change detection compares this against the mtime
/// it saw at load.
#[tauri::command]
pub fn note_mtime(app: AppHandle, name: String) -> Result<Option<u64>, String> {
    Ok(fs::metadata(resolve_note(&app, &name)?)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64))
}

#[tauri::command]
pub fn save_note(app: AppHandle, name: String, content: String) -> Result<(), String> {
    let path = resolve_note(&app, &name)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // History is best-effort around the save: its errors are swallowed,
    // because a broken snapshot store must never block writing the note.
    let s = settings::settings(&app)?;
    let track = history::tracked(&s, &name) && content.len() as u64 <= MAX_SEARCH_BYTES;
    let store = track.then(|| history::store_dir(&app).ok()).flatten();
    if let Some(store) = &store {
        // A note the store has never seen: its pre-save disk content is the
        // "before" this save diffs against, so even the first save after
        // shipping doesn't render as everything-added.
        if !history::has_any(store, &name) {
            if let (Ok(old), Ok(meta)) = (fs::read_to_string(&path), fs::metadata(&path)) {
                if meta.len() <= MAX_SEARCH_BYTES {
                    let at = meta
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or_else(|| now_ms().saturating_sub(1));
                    let _ = history::record(store, &name, &old, history::Origin::App, at);
                }
            }
        }
    }
    fs::write(&path, &content).map_err(|e| e.to_string())?;
    if let Some(store) = &store {
        let _ = history::record(store, &name, &content, history::Origin::App, now_ms());
    }
    Ok(())
}

/// Move a note to the recycle bin (recoverable — notes are user-owned files,
/// never hard-deleted) and discard its shadow draft.
#[tauri::command]
pub fn delete_note(app: AppHandle, name: String) -> Result<(), String> {
    let path = resolve_note(&app, &name)?;
    // A file already gone (removed outside the app) counts as already
    // deleted: skip the trash call — it errors on a missing path — but still
    // clean the draft and snapshots, and return Ok so the tab closes.
    if path.exists() {
        trash::delete(path).map_err(|e| e.to_string())?;
    }
    let s = settings::settings(&app)?;
    let draft = drafts_dir(&app)?.join(checked_name(&app, &s, &name)?);
    if draft.exists() {
        let _ = fs::remove_file(draft);
    }
    // Snapshots are app-internal state, not user content: hard-removed with
    // the note, like the draft.
    if let Ok(store) = history::store_dir(&app) {
        let _ = fs::remove_dir_all(store.join(&name));
    }
    Ok(())
}

/// Show a note in File Explorer (context menu "Reveal").
#[tauri::command]
pub fn reveal_note(app: AppHandle, name: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let path = resolve_note(&app, &name)?;
    app.opener()
        .reveal_item_in_dir(path)
        .map_err(|e| e.to_string())
}

/// Show any real file in File Explorer — referenced files on the project map
/// live outside the corpus, so this takes a path where `reveal_note` takes a
/// note id.
#[tauri::command]
pub fn reveal_path(app: AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let p = PathBuf::from(&path);
    if !p.is_absolute() || !p.exists() {
        return Err(format!("not an existing absolute path: {path}"));
    }
    app.opener()
        .reveal_item_in_dir(p)
        .map_err(|e| e.to_string())
}

/// Extensions never launched from note text — revealed in Explorer instead,
/// so a Ctrl+Click can't start a program.
const EXEC_EXTS: [&str; 17] = [
    "exe", "bat", "cmd", "com", "scr", "ps1", "msi", "vbs", "vbe", "js", "jse", "wsf", "wsh",
    "hta", "lnk", "reg", "msc",
];

/// Open a target from a Ctrl+Clicked link or the explorer's folder menu:
/// http(s)/mailto URLs go to the default handler, existing absolute paths open
/// with their default app — a folder opens in File Explorer, executable types
/// are revealed rather than run. Everything else is rejected.
#[tauri::command]
pub fn open_external(app: AppHandle, target: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let lower = target.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:")
    {
        return app
            .opener()
            .open_url(target, None::<&str>)
            .map_err(|e| e.to_string());
    }
    let path = PathBuf::from(&target);
    if !path.is_absolute() || !path.exists() {
        return Err(format!("not an existing absolute path: {target}"));
    }
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if EXEC_EXTS.contains(&ext.as_str()) {
        return app
            .opener()
            .reveal_item_in_dir(path)
            .map_err(|e| e.to_string());
    }
    app.opener()
        .open_path(target, None::<&str>)
        .map_err(|e| e.to_string())
}

/// Move/rename a note between projects (or in/out of no project); its shadow
/// draft, if any, moves with it.
#[tauri::command]
pub fn move_note(app: AppHandle, from: String, to: String) -> Result<(), String> {
    let from_path = resolve_note(&app, &from)?;
    // Deleted outside the app while its tab stayed open: the buffer (or the
    // draft) is the only copy, and saving is what puts a file back to rename.
    if !from_path.exists() {
        return Err("its file is gone — save first to recreate it".into());
    }
    let to_path = resolve_note(&app, &to)?;
    if to_path.exists() {
        return Err(format!("a note named {to} already exists"));
    }
    if let Some(parent) = to_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // `rename` fails across volumes, which linked folders and mounts make an
    // ordinary case rather than an exotic one.
    if fs::rename(&from_path, &to_path).is_err() {
        fs::copy(&from_path, &to_path).map_err(|e| e.to_string())?;
        fs::remove_file(&from_path).map_err(|e| e.to_string())?;
    }
    let s = settings::settings(&app)?;
    let drafts = drafts_dir(&app)?;
    let draft_from = drafts.join(checked_name(&app, &s, &from)?);
    if draft_from.exists() {
        let draft_to = note_path(&app, &s, &drafts, &to)?;
        let _ = fs::rename(draft_from, draft_to);
    }
    // History travels with the note, like the draft. The store lives on one
    // volume, so a plain rename is enough.
    if let Ok(store) = history::store_dir(&app) {
        let hist_from = store.join(&from);
        if hist_from.is_dir() {
            let hist_to = store.join(&to);
            if let Some(parent) = hist_to.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let _ = fs::rename(hist_from, hist_to);
        }
    }
    Ok(())
}

/// Create a real folder inside a project, resolved the way note ids are — so a
/// folder created under a mount lands in the mount's own directory. Top-level
/// folders are projects and have their own creation flow.
#[tauri::command]
pub fn create_folder(app: AppHandle, dir: String) -> Result<(), String> {
    let s = settings::settings(&app)?;
    let segments: Vec<&str> = dir.split('/').collect();
    // A folder only ever holds notes below it, so its own depth stops one
    // segment short of the id budget.
    if !(2..MAX_DEPTH as usize).contains(&segments.len())
        || !segments.iter().all(|s| valid_segment(s))
        || segments[0] == ASSETS_DIR
    {
        return Err(format!("invalid folder name: {dir}"));
    }
    let (project, rest) = dir.split_once('/').expect("two segments checked");
    // A real folder at a mount's name would hide the mount everywhere (the
    // real folder wins); refuse here, where the reason can be explained.
    if s.projects
        .get(project)
        .is_some_and(|e| e.mounts.iter().any(|m| m.at == rest))
    {
        return Err(format!(
            "{project} already has a folder attached at {rest} — a real folder there would hide it"
        ));
    }
    let (base, sub) = base_of(&app, &s, &dir)?;
    let path = base.join(sub);
    if path.exists() {
        return Err(format!("{dir} already exists"));
    }
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

/// Move a folder and everything in it to the recycle bin (never a hard
/// delete — same rule as `delete_note`); shadow drafts filed under its ids go
/// with it. Top-level folders are projects and are not deletable here.
#[tauri::command]
pub fn delete_folder(app: AppHandle, dir: String) -> Result<(), String> {
    let root = notes_root(&app)?;
    let s = settings::settings(&app)?;
    let segments: Vec<&str> = dir.split('/').collect();
    if !(2..MAX_DEPTH as usize).contains(&segments.len())
        || !segments.iter().all(|s| valid_segment(s))
        || segments[0] == ASSETS_DIR
    {
        return Err(format!("invalid folder name: {dir}"));
    }
    let (project, rest) = dir.split_once('/').expect("two segments checked");
    // The mount point itself is a virtual folder and deleting it means
    // `delete_mount` — except a conflicted mount, which is inert: the real
    // folder that took its name is what's visible, so it is what's deleted.
    if s.projects
        .get(project)
        .is_some_and(|e| e.mounts.iter().any(|m| m.at == rest))
        && !project_base(&root, &s, project).join(rest).is_dir()
    {
        return Err(format!(
            "{dir} is a virtual folder — delete or detach it instead"
        ));
    }
    let (base, sub) = base_of(&app, &s, &dir)?;
    let path = base.join(sub);
    // Already gone (removed outside the app) counts as already deleted — the
    // drafts and snapshots below still want cleaning either way.
    if path.exists() {
        trash::delete(&path).map_err(|e| e.to_string())?;
    }
    // Drafts and snapshots are app-managed shadow copies, removed outright
    // like `delete_note` removes one note's.
    let _ = fs::remove_dir_all(drafts_dir(&app)?.join(&dir));
    if let Ok(store) = history::store_dir(&app) {
        let _ = fs::remove_dir_all(store.join(&dir));
    }
    Ok(())
}

#[tauri::command]
pub fn list_drafts(app: AppHandle) -> Result<Vec<FileInfo>, String> {
    // Deep walk: drafts mirror ids like `project/docs/x.md`. Default rules on
    // purpose — matching each draft against its project's `files` rules would
    // mean a config read per id segment, and what it would buy (listing a
    // draft of a re-included non-allowlist file) is a known gap in TODO.md.
    // Unlisted types share that gap: their drafts don't list either.
    let s = settings::settings(&app)?;
    let mut out = Vec::new();
    collect_md_deep(
        &s,
        &Rules::default(),
        &drafts_dir(&app)?,
        "",
        "",
        0,
        &mut out,
    );
    out.sort_by_key(|f| std::cmp::Reverse(f.modified_ms));
    Ok(out)
}

#[tauri::command]
pub fn read_draft(app: AppHandle, id: String) -> Result<String, String> {
    let s = settings::settings(&app)?;
    fs::read_to_string(drafts_dir(&app)?.join(checked_name(&app, &s, &id)?))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_draft(app: AppHandle, id: String, content: String) -> Result<(), String> {
    let s = settings::settings(&app)?;
    let path = note_path(&app, &s, &drafts_dir(&app)?, &id)?;
    fs::write(path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_draft(app: AppHandle, id: String) -> Result<(), String> {
    let s = settings::settings(&app)?;
    let path = drafts_dir(&app)?.join(checked_name(&app, &s, &id)?);
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Discarding is different from cleaning up: a discarded draft is the only
/// copy of that content, so it goes to the recycle bin like every other
/// deletion, while `delete_draft` stays the silent removal for content that
/// is safe elsewhere (a just-saved note's draft).
#[tauri::command]
pub fn discard_draft(app: AppHandle, id: String) -> Result<(), String> {
    let s = settings::settings(&app)?;
    let path = drafts_dir(&app)?.join(checked_name(&app, &s, &id)?);
    if path.exists() {
        trash::delete(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// A named note's unsaved edits, marked the way the changes lens marks an
/// external edit: the file on disk is the "before", the draft the "after" —
/// or the live buffer, when the caller holds one fresher than the draft.
/// A file that is gone reads as empty, so every line shows as added. The
/// file's line endings are normalised to the editor's, or a CRLF file would
/// read as rewritten whole.
#[tauri::command]
pub fn draft_lens(
    app: AppHandle,
    name: String,
    content: Option<String>,
) -> Result<history::NoteLens, String> {
    let s = settings::settings(&app)?;
    let old = fs::read_to_string(resolve_note(&app, &name)?)
        .unwrap_or_default()
        .replace("\r\n", "\n");
    let text = match content {
        Some(text) => text,
        None => fs::read_to_string(drafts_dir(&app)?.join(checked_name(&app, &s, &name)?))
            .map_err(|e| e.to_string())?,
    };
    let (added, dels, added_n, removed_n) = history::lens_marks(&old, &text);
    Ok(history::NoteLens {
        note: name,
        text,
        added,
        dels,
        added_n,
        removed_n,
        at_ms: now_ms(),
        own_edits_since: false,
    })
}

fn assets_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = notes_root(app)?.join(ASSETS_DIR);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Where pasted images for a note go: a folder outside the notes root keeps its
/// images in its own `assets/`, because a linked or attached folder owns its
/// files and travels with them; everything under the notes root shares the root
/// `assets/`. Keyed on where the note actually resolved, since a mounted note
/// falls outside its project's own folder.
pub(crate) fn assets_dir_for(app: &AppHandle, note: Option<&str>) -> Result<PathBuf, String> {
    let root = notes_root(app)?;
    let Some(note) = note else {
        return assets_dir(app);
    };
    let s = settings::settings(app)?;
    let (base, _) = base_of(app, &s, note)?;
    if !disjoint(&root, &base) {
        return assets_dir(app);
    }
    let dir = base.join(ASSETS_DIR);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub(crate) fn unique_asset(dir: &Path, stem: &str, ext: &str) -> (PathBuf, String) {
    let mut file = format!("{stem}.{ext}");
    let mut n = 2;
    while dir.join(&file).exists() {
        file = format!("{stem}-{n}.{ext}");
        n += 1;
    }
    (dir.join(&file), format!("{ASSETS_DIR}/{file}"))
}

/// Undo `encodeURIComponent` on a header value — HTTP headers are ASCII-only,
/// project names are not.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Save a pasted image. The bytes arrive as the raw IPC body; the file
/// extension and the (percent-encoded) id of the note being edited ride in
/// headers. Returns the asset path relative to that note's base,
/// e.g. `assets/img-123.png`.
#[tauri::command]
pub fn save_asset(app: AppHandle, request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw image bytes".into());
    };
    let ext = request
        .headers()
        .get("ext")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("png")
        .to_ascii_lowercase();
    if !IMAGE_EXTS.contains(&ext.as_str()) {
        return Err(format!("unsupported image type: {ext}"));
    }
    let note = request
        .headers()
        .get("note")
        .and_then(|v| v.to_str().ok())
        .map(percent_decode);
    let dir = assets_dir_for(&app, note.as_deref())?;
    let (path, rel) = unique_asset(&dir, &format!("img-{}", now_ms()), &ext);
    fs::write(path, bytes).map_err(|e| e.to_string())?;
    Ok(rel)
}

/// Copy an image dropped from the filesystem into `assets/`. Returns the asset
/// path relative to the base of the note being edited.
#[tauri::command]
pub fn import_asset(app: AppHandle, src: String, note: Option<String>) -> Result<String, String> {
    let src = PathBuf::from(src);
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !src.is_file() || !IMAGE_EXTS.contains(&ext.as_str()) {
        return Err("not an image file".into());
    }
    let stem: String = src
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("img")
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
        .take(40)
        .collect();
    let stem = if stem.is_empty() { "img".into() } else { stem };
    let dir = assets_dir_for(&app, note.as_deref())?;
    let (path, rel) = unique_asset(&dir, &format!("{stem}-{}", now_ms()), &ext);
    fs::copy(&src, path).map_err(|e| e.to_string())?;
    Ok(rel)
}

// --- Scan a folder for projects to register ---

#[derive(Serialize)]
pub struct ProjectCandidate {
    pub name: String,
    pub path: String,
    pub md_count: usize,
}

/// "README or similar" — the file that marks a folder as a project.
fn is_readme(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower == "readme.md" || lower == "index.md"
}

fn count_md(s: &Settings, dir: &Path) -> usize {
    // A candidate's own `.asapnotes.json` counts, so the scan sheet's number
    // matches what linking the folder would actually list.
    let rules = project_config::walk_rules(&s.files, dir);
    let mut files = Vec::new();
    collect_md_deep(s, &rules, dir, "", "", 0, &mut files);
    files.len()
}

/// Depth-first hunt for project folders. A folder with a README becomes a
/// candidate and is not descended into further — nested READMEs (docs inside a
/// repo) belong to the outer project.
fn scan_dir(s: &Settings, dir: &Path, depth: u32, out: &mut Vec<ProjectCandidate>) {
    if depth > MAX_DEPTH || out.len() >= 200 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let entries: Vec<_> = entries.flatten().collect();
    let has_readme = entries.iter().any(|e| {
        e.file_type().map(|t| t.is_file()).unwrap_or(false)
            && is_readme(&e.file_name().to_string_lossy())
    });
    if has_readme {
        let name = dir
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        if valid_segment(&name) && name != ASSETS_DIR {
            out.push(ProjectCandidate {
                name,
                path: dir.to_string_lossy().into_owned(),
                md_count: count_md(s, dir),
            });
        }
        return;
    }
    for entry in entries {
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir && valid_segment(&name) && !skip_dir(&name) {
            scan_dir(s, &entry.path(), depth + 1, out);
        }
    }
}

#[tauri::command]
pub fn scan_projects(app: AppHandle, dir: String) -> Result<Vec<ProjectCandidate>, String> {
    let root = PathBuf::from(&dir);
    if !root.is_dir() {
        return Err(format!("not a folder: {dir}"));
    }
    let s = settings::settings(&app)?;
    let mut out = Vec::new();
    scan_dir(&s, &root, 0, &mut out);
    Ok(out)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedProject {
    pub name: String,
    pub path: String,
    /// Root the project at its docs folder instead of the folder itself.
    #[serde(default)]
    pub use_docs: bool,
}

/// A repo's notes root: `docs/` if present, else `documentation/`, else a
/// freshly created `docs/`.
fn docs_root(base: &Path) -> Result<PathBuf, String> {
    for sub in ["docs", "documentation"] {
        let dir = base.join(sub);
        if dir.is_dir() {
            return Ok(dir);
        }
    }
    let dir = base.join("docs");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// A project name has to be free in both places a project can come from: a
/// notes-root subfolder and a registry entry. One check, because from here on
/// those are one kind of thing that differs only in where it lives.
fn check_new_project(root: &Path, s: &Settings, name: &str) -> Result<(), String> {
    if !valid_segment(name) || name == ASSETS_DIR {
        return Err(format!("invalid project name: {name}"));
    }
    if root.join(name).is_dir() || s.projects.contains_key(name) {
        return Err(format!("a project named {name} already exists"));
    }
    Ok(())
}

/// Whether two folders are unrelated — neither one contains the other. Nesting
/// is what gives a file two ids (one reached through each folder), and two ids
/// mean two shadow drafts and two tabs that overwrite each other. Compared
/// case-insensitively, like the filesystem underneath.
fn disjoint(a: &Path, b: &Path) -> bool {
    let norm = |p: &Path| {
        p.to_string_lossy()
            .to_lowercase()
            .replace('\\', "/")
            .trim_end_matches('/')
            .to_string()
    };
    let (a, b) = (norm(a), norm(b));
    a != b && !a.starts_with(&format!("{b}/")) && !b.starts_with(&format!("{a}/"))
}

/// Refuse a folder overlapping one the app already resolves ids from: the notes
/// root, another project's location, or a mount. `replacing` is the project
/// whose own location is being repointed, which it is allowed to overlap.
fn check_location(
    root: &Path,
    s: &Settings,
    path: &Path,
    replacing: Option<&str>,
) -> Result<(), String> {
    let shown = path.display();
    if !disjoint(root, path) {
        return Err(format!(
            "{shown} overlaps the notes folder — its subfolders are projects already, so every \
             file under it would end up with two names and two sets of unsaved edits"
        ));
    }
    for (name, entry) in &s.projects {
        if Some(name.as_str()) != replacing {
            if let Some(dir) = entry.path.as_deref() {
                if !disjoint(Path::new(dir), path) {
                    return Err(format!(
                        "{shown} overlaps the project {name}, so its files would end up with two names"
                    ));
                }
            }
        }
        for m in &entry.mounts {
            if !disjoint(Path::new(&m.path), path) {
                return Err(format!(
                    "{shown} overlaps {}, already attached to {name}, so its files would end up \
                     with two names",
                    m.at
                ));
            }
        }
    }
    Ok(())
}

/// Validate a folder about to hold a project and return the location to
/// record — the folder itself, or its docs root.
fn project_location(
    app: &AppHandle,
    root: &Path,
    s: &Settings,
    path: &str,
    use_docs: bool,
    replacing: Option<&str>,
) -> Result<String, String> {
    if !Path::new(path).is_dir() {
        return Err(format!("not a folder: {path}"));
    }
    check_location(root, s, Path::new(path), replacing)?;
    // Preview must be able to load this folder's images via the asset
    // protocol; the static scope only covers the root assets dir. Scoped to
    // the whole picked folder, not just docs/ — links may climb out of it.
    let _ = app.asset_protocol_scope().allow_directory(path, true);
    if use_docs {
        Ok(docs_root(Path::new(path))?.to_string_lossy().into_owned())
    } else {
        Ok(path.to_string())
    }
}

/// What a picked folder offers a project about to live there: whether it is a
/// repository (so the docs-folder option is worth showing) and which docs
/// folder that option would use.
#[derive(Serialize)]
pub struct FolderInfo {
    pub has_git: bool,
    /// An existing `docs`/`documentation`, else the `docs` that would be made.
    pub docs: String,
}

#[tauri::command]
pub fn folder_info(path: String) -> Result<FolderInfo, String> {
    let dir = PathBuf::from(&path);
    if !dir.is_dir() {
        return Err(format!("not a folder: {path}"));
    }
    Ok(FolderInfo {
        // A file in worktrees and submodules, a directory otherwise.
        has_git: dir.join(".git").exists(),
        docs: ["docs", "documentation"]
            .into_iter()
            .find(|sub| dir.join(sub).is_dir())
            .unwrap_or("docs")
            .to_string(),
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewProject {
    pub name: String,
    /// Folder to link in place. Absent means a new subfolder of the notes
    /// root, which needs no registry entry — a first-level subfolder is a
    /// project whether or not anything registered it.
    pub path: Option<String>,
    #[serde(default)]
    pub use_docs: bool,
}

/// Create a project, wherever it lives. The two locations differ only in
/// whether the registry has to remember one: a notes-root project is a folder,
/// a project elsewhere is a folder plus an entry pointing at it.
#[tauri::command]
pub fn create_project(app: AppHandle, project: NewProject) -> Result<(), String> {
    let root = notes_root(&app)?;
    let s = settings::settings(&app)?;
    check_new_project(&root, &s, &project.name)?;
    let Some(path) = project.path else {
        return fs::create_dir_all(root.join(&project.name)).map_err(|e| e.to_string());
    };
    let path = project_location(&app, &root, &s, &path, project.use_docs, None)?;
    settings::update(&app, |s| {
        s.projects.insert(
            project.name,
            Project {
                path: Some(path),
                ..Project::default()
            },
        );
        Ok(())
    })
}

/// Link folders found by a scan, in bulk.
#[tauri::command]
pub fn link_projects(app: AppHandle, projects: Vec<LinkedProject>) -> Result<(), String> {
    let root = notes_root(&app)?;
    let s = settings::settings(&app)?;
    // Validate and resolve every location first, so a bad one in the batch
    // leaves the settings file untouched.
    let mut entries = Vec::new();
    for p in projects {
        check_new_project(&root, &s, &p.name)?;
        entries.push((
            p.name,
            project_location(&app, &root, &s, &p.path, p.use_docs, None)?,
        ));
    }
    settings::update(&app, |s| {
        for (name, path) in entries {
            // The batch itself can carry a duplicate name; the check above only
            // saw the names already registered.
            if s.projects.contains_key(&name) {
                return Err(format!("a project named {name} already exists"));
            }
            s.projects.insert(
                name,
                Project {
                    path: Some(path),
                    ..Project::default()
                },
            );
        }
        Ok(())
    })
}

/// Repoint a linked project at a different folder (Settings). Only its location
/// changes — whatever else its entry carries stays.
#[tauri::command]
pub fn set_project_path(app: AppHandle, name: String, path: String) -> Result<(), String> {
    let root = notes_root(&app)?;
    let s = settings::settings(&app)?;
    // Repointing takes the same location rules as creating: this is a project
    // moving, not a different kind of thing.
    let path = project_location(&app, &root, &s, &path, false, Some(&name))?;
    settings::update(&app, |s| {
        let project = s
            .projects
            .get_mut(&name)
            .ok_or_else(|| format!("no project named {name} has a folder of its own"))?;
        project.path = Some(path);
        Ok(())
    })
}

/// Forget a project's registry entry (Settings). Its folder and files are left
/// exactly where they are.
#[tauri::command]
pub fn unlink_project(app: AppHandle, name: String) -> Result<(), String> {
    settings::update(&app, |s| {
        s.projects.remove(&name);
        Ok(())
    })
}

// --- Mounts: folders attached into a project ---

/// How deep a mount point may sit inside its project. An id is
/// `project/<at>/…/file` and `MAX_DEPTH` caps the whole of it, so a deep mount
/// point would push ordinary files under it past the limit — refused here,
/// where the reason can be explained, rather than at open time, where it can't.
const MAX_MOUNT_AT: usize = 4;

/// A mount as the explorer sees it. `conflicted` means a real folder has taken
/// its name over: the real folder wins, and the mount lists nothing until the
/// clash is gone. `missing` means the backing folder is gone from disk
/// (removed outside the app, unplugged drive) — the walks list nothing there,
/// so without the flag it would read as an empty folder. `external` means the
/// backing folder lives outside the virtual-folders home — a folder the user
/// owns elsewhere, which deletion warnings call out by path.
#[derive(Serialize)]
pub struct MountInfo {
    pub project: String,
    pub at: String,
    pub path: String,
    pub conflicted: bool,
    pub missing: bool,
    pub external: bool,
}

#[tauri::command]
pub fn list_mounts(app: AppHandle) -> Result<Vec<MountInfo>, String> {
    let root = notes_root(&app)?;
    let s = settings::settings(&app)?;
    let home = virtual_folders_root(&app, &s)?;
    let mut out = Vec::new();
    for (name, entry) in &s.projects {
        let own = project_base(&root, &s, name);
        for m in &entry.mounts {
            out.push(MountInfo {
                project: name.clone(),
                at: m.at.clone(),
                path: m.path.clone(),
                conflicted: own.join(&m.at).is_dir(),
                missing: !Path::new(&m.path).is_dir(),
                external: !Path::new(&m.path).starts_with(&home),
            });
        }
    }
    Ok(out)
}

/// Whether one mount point is the other or sits inside it. Nested mount points
/// would make a file below the inner one reachable through both.
fn nested_at(a: &str, b: &str) -> bool {
    a == b || a.strip_prefix(b).is_some_and(|rest| rest.starts_with('/'))
}

/// Shared validation for the *name* a mount is attached at: the project is
/// real, the name is usable, and no other mount overlaps it. Returns the
/// normalized `at`. Says nothing about a real folder of that name — only
/// [`folder_to_virtual`] wants that, because there the folder is the point.
fn checked_mount_name(
    root: &Path,
    s: &Settings,
    project: &str,
    at: &str,
) -> Result<String, String> {
    if !root.join(project).is_dir() && !s.projects.contains_key(project) {
        return Err(format!("no project named {project}"));
    }
    let at = at.trim_matches('/').to_string();
    let segments: Vec<&str> = at.split('/').collect();
    if !(1..=MAX_MOUNT_AT).contains(&segments.len())
        || !segments
            .iter()
            .all(|s| valid_segment(s) && *s != ASSETS_DIR)
    {
        return Err(format!("{at} isn't a usable folder name inside {project}"));
    }
    if let Some(entry) = s.projects.get(project) {
        if let Some(m) = entry
            .mounts
            .iter()
            .find(|m| nested_at(&at, &m.at) || nested_at(&m.at, &at))
        {
            return Err(format!(
                "{project} already has a folder attached at {}",
                m.at
            ));
        }
    }
    Ok(at)
}

/// [`checked_mount_name`] plus the rule every *attach* path needs: no real
/// folder may already sit at `at`. A real folder wins over a mount of its
/// name, so attaching one there would attach something invisible.
fn checked_mount_at(root: &Path, s: &Settings, project: &str, at: &str) -> Result<String, String> {
    let at = checked_mount_name(root, s, project, at)?;
    if project_base(root, s, project).join(&at).is_dir() {
        return Err(format!("{project} already has a folder of its own at {at}"));
    }
    Ok(at)
}

/// Grant the asset scope and record the mount — the shared tail of both
/// attach paths.
fn register_mount(
    app: &AppHandle,
    project: String,
    at: String,
    path: String,
) -> Result<(), String> {
    // Preview loads a mounted note's images through the asset protocol, whose
    // static scope only covers the root assets dir. Re-granted at startup.
    let _ = app.asset_protocol_scope().allow_directory(&path, true);
    settings::update(app, |s| {
        s.projects
            .entry(project)
            .or_default()
            .mounts
            .push(Mount { at, path });
        Ok(())
    })
}

/// Attach an existing folder into a project at a project-relative name
/// ("associate virtual folder") — the folder is picked; making a brand-new one
/// is `create_virtual_folder`.
#[tauri::command]
pub fn add_mount(app: AppHandle, project: String, at: String, path: String) -> Result<(), String> {
    let root = notes_root(&app)?;
    let s = settings::settings(&app)?;
    let at = checked_mount_at(&root, &s, &project, &at)?;
    if !Path::new(&path).is_dir() {
        return Err(format!("not a folder: {path}"));
    }
    check_location(&root, &s, Path::new(&path), None)?;
    register_mount(&app, project, at, path)
}

/// Where "New virtual folder" creates its backing folders: the personal
/// `virtualFoldersRoot` setting, else `virtual` in app data — a machine-local
/// home like the drafts dir. Never the installation folder, which updates
/// replace and installs may make read-only.
fn virtual_folders_root(app: &AppHandle, s: &Settings) -> Result<PathBuf, String> {
    match s.virtual_folders_root.as_deref() {
        Some(dir) => Ok(PathBuf::from(dir)),
        None => Ok(app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("virtual")),
    }
}

/// Create the backing folder for a brand-new virtual folder and attach it —
/// "new" as against "associate" (`add_mount`), which picks a folder that
/// already exists. The folder is created under the virtual-folders home at
/// `<project>/<at>`, never inside the project itself: virtual means the
/// contents live elsewhere.
#[tauri::command]
pub fn create_virtual_folder(app: AppHandle, project: String, at: String) -> Result<(), String> {
    let root = notes_root(&app)?;
    let s = settings::settings(&app)?;
    let at = checked_mount_at(&root, &s, &project, &at)?;
    let path = virtual_folders_root(&app, &s)?.join(&project).join(&at);
    // Checked like any picked folder: a hand-edited home could sit anywhere.
    check_location(&root, &s, &path, None)?;
    // An existing folder here is a detached virtual folder of the same name —
    // detaching leaves files in place, so creating it again revives them.
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    register_mount(&app, project, at, path.to_string_lossy().into_owned())
}

/// Detach a folder from a project. The folder and its files stay exactly where
/// they are; drafts filed under its ids are orphaned, the same trade unlinking
/// a project already makes.
#[tauri::command]
pub fn remove_mount(app: AppHandle, project: String, at: String) -> Result<(), String> {
    settings::update(&app, |s| {
        let entry = s
            .projects
            .get_mut(&project)
            .ok_or_else(|| format!("no project named {project}"))?;
        entry.mounts.retain(|m| m.at != at);
        // An entry that carried nothing but this mount is noise in the file:
        // a notes-root project exists because its folder does.
        if entry.path.is_none() && entry.mounts.is_empty() && entry.mcp.is_none() {
            s.projects.remove(&project);
        }
        Ok(())
    })
}

/// Delete a virtual folder outright: move its backing folder to the recycle
/// bin (never a hard delete — same rule as `delete_note`), then detach it.
/// Plain detach (`remove_mount`) stays as the keep-the-files option.
#[tauri::command]
pub fn delete_mount(app: AppHandle, project: String, at: String) -> Result<(), String> {
    let s = settings::settings(&app)?;
    let mount = s
        .projects
        .get(&project)
        .and_then(|e| e.mounts.iter().find(|m| m.at == at))
        .ok_or_else(|| format!("no folder attached at {at} in {project}"))?;
    // A backing folder already gone by other means shouldn't block the detach.
    if Path::new(&mount.path).exists() {
        trash::delete(&mount.path).map_err(|e| e.to_string())?;
    }
    // Drafts and snapshots are app-managed shadow copies, removed outright
    // like `delete_note` removes one note's.
    let _ = fs::remove_dir_all(drafts_dir(&app)?.join(&project).join(&at));
    if let Ok(store) = history::store_dir(&app) {
        let _ = fs::remove_dir_all(store.join(&project).join(&at));
    }
    remove_mount(app, project, at)
}

/// Copy a folder and everything in it; `fs` has no directory copy. Nothing is
/// removed here, so a failure part-way leaves the source whole.
fn copy_dir(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(from).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let target = to.join(entry.file_name());
        if entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), &target).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Move a folder and everything in it. `rename` fails across volumes, which a
/// project on one drive and the virtual-folders home in app data make an
/// ordinary case rather than an exotic one — so fall back to copy-then-remove,
/// the same trade [`move_note`] makes for a single file.
fn move_dir(from: &Path, to: &Path) -> Result<(), String> {
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    if fs::rename(from, to).is_ok() {
        return Ok(());
    }
    copy_dir(from, to)?;
    fs::remove_dir_all(from).map_err(|e| e.to_string())
}

/// Convert a virtual folder into a real one, in place: its files move into the
/// project's own folder under the same name, and the mount goes away.
///
/// Keeping the name is what makes this cheap. An id is `project/<at>/…` either
/// way — resolved through the mount before, through the real folder after — so
/// no note changes id, and drafts, history, open tabs and the change ledger
/// need no migration at all. Moving the files somewhere *else* in the project
/// would re-root every id under it; that is a different feature, and this one
/// deliberately isn't it.
#[tauri::command]
pub fn folder_to_real(app: AppHandle, project: String, at: String) -> Result<(), String> {
    let root = notes_root(&app)?;
    let s = settings::settings(&app)?;
    let from = s
        .projects
        .get(&project)
        .and_then(|e| e.mounts.iter().find(|m| m.at == at))
        .map(|m| PathBuf::from(&m.path))
        .ok_or_else(|| format!("no folder attached at {at} in {project}"))?;
    if !from.is_dir() {
        return Err(format!(
            "its files are gone from {} — detach it instead",
            from.display()
        ));
    }
    let to = project_base(&root, &s, &project).join(&at);
    // Also the conflicted case: a real folder of that name already took over,
    // and merging two sets of files is not something to do quietly.
    if to.exists() {
        return Err(format!("{project} already has a real folder at {at}"));
    }
    // Move first, detach after: a real folder wins over a mount of its name, so
    // ids resolve through the mount until the files land and through the folder
    // from the moment they do. A failure in between leaves the mount standing.
    move_dir(&from, &to)?;
    remove_mount(app, project, at)
}

/// Convert a real folder into a virtual one, in place: its files move to the
/// virtual-folders home at `<project>/<at>` — where `create_virtual_folder`
/// puts a new one — and a mount takes over its name. The inverse of
/// [`folder_to_real`], and cheap for the same reason: the name stays, so no id
/// moves. Answers with where the files now live — the destination is the app's
/// choice rather than a picked folder, so the caller has something to say.
#[tauri::command]
pub fn folder_to_virtual(app: AppHandle, project: String, at: String) -> Result<String, String> {
    let root = notes_root(&app)?;
    let s = settings::settings(&app)?;
    // Not `checked_mount_at`: the real folder at `at` is the one being
    // converted, not a clash with it.
    let at = checked_mount_name(&root, &s, &project, &at)?;
    let from = project_base(&root, &s, &project).join(&at);
    if !from.is_dir() {
        return Err(format!("no folder at {at} in {project}"));
    }
    let to = virtual_folders_root(&app, &s)?.join(&project).join(&at);
    // Files already there are a virtual folder of this name that was detached
    // (detaching leaves them in place); merging the two sets would mix them
    // with no way back.
    if to.exists() {
        return Err(format!(
            "{} already holds the files of a detached virtual folder of that name",
            to.display()
        ));
    }
    // Checked like any picked folder: a hand-edited home could sit anywhere.
    check_location(&root, &s, &to, None)?;
    // Register first: while the real folder is still there the mount is inert,
    // so a move that fails leaves the folder exactly as it was — real, whole
    // and visible.
    let path = to.to_string_lossy().into_owned();
    register_mount(&app, project.clone(), at.clone(), path.clone())?;
    move_dir(&from, &to).inspect_err(|_| {
        // Without its files the entry is a mount pointing at nothing, which the
        // user would have to detach by hand.
        let _ = remove_mount(app, project, at);
    })?;
    Ok(path)
}
