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

use crate::project_config::{self, Rules, Verdict};
use crate::settings::{self, Mount, Project, Settings};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager};

const ASSETS_DIR: &str = "assets";
const IMAGE_EXTS: [&str; 7] = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];
/// Directories never walked when listing or scanning folders.
const SKIP_DIRS: [&str; 5] = ["node_modules", "target", "dist", "build", "out"];
const MAX_DEPTH: u32 = 12;

#[derive(Serialize)]
pub struct FileInfo {
    pub name: String,
    pub modified_ms: u64,
}

fn notes_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .document_dir()
        .map_err(|e| e.to_string())?
        .join("asapnotes");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn drafts_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("drafts");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn valid_segment(s: &str) -> bool {
    !s.is_empty() && !s.contains('\\') && !s.starts_with('.')
}

/// Note ids come from the frontend as relative paths (`note.md` or
/// `project/…/note.md`); reject anything that could escape its base, or name a
/// file that is not a note — registry allowlist, or a project's re-include.
fn checked_name<'a>(app: &AppHandle, s: &Settings, name: &'a str) -> Result<&'a str, String> {
    let segments: Vec<&str> = name.split('/').collect();
    let file = segments.last().copied().unwrap_or("");
    let ok = (1..=MAX_DEPTH as usize).contains(&segments.len())
        && segments.iter().all(|s| valid_segment(s))
        && (segments.len() == 1 || segments[0] != ASSETS_DIR)
        && (s.is_note(file) || re_included(app, s, name));
    if ok {
        Ok(name)
    } else {
        Err(format!("invalid note name: {name}"))
    }
}

/// The floor under re-inclusion: a `!` pattern waives the type allowlist but
/// never pulls in an executable type or a file over the search size cap — a
/// pattern arriving in a pulled config must not make the app touch something
/// it would otherwise refuse to.
fn floor_ok(name: &str, len: u64) -> bool {
    let ext = name
        .rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .unwrap_or_default();
    !EXEC_EXTS.contains(&ext.as_str()) && len <= MAX_SEARCH_BYTES
}

/// Whether a project's `files` rules pull this id in past the registry
/// allowlist — `!src/**/*.rs` making `.rs` files notes. Like the listing walk,
/// but by id: a re-included file has to be openable, savable and draftable,
/// not just listed.
fn re_included(app: &AppHandle, s: &Settings, name: &str) -> bool {
    // Top-level notes belong to no project, so no project's rules apply.
    let Some((project, rest)) = name.split_once('/') else {
        return false;
    };
    let Ok(root) = notes_root(app) else {
        return false;
    };
    let (rules, _) = project_config::rules_for(&project_base(&root, s, project));
    if rules.verdict(rest, false) != Verdict::Include {
        return false;
    }
    // A file being created here doesn't exist yet; it enters at size zero.
    let len = base_of(app, s, name)
        .ok()
        .and_then(|(base, sub)| fs::metadata(base.join(sub)).ok())
        .map(|m| m.len())
        .unwrap_or(0);
    floor_ok(name, len)
}

/// Where a project's own files live: its registered location, else the
/// notes-root subfolder that carries its name.
fn project_base(root: &Path, s: &Settings, project: &str) -> PathBuf {
    match s.projects.get(project).and_then(|p| p.path.as_deref()) {
        Some(dir) => PathBuf::from(dir),
        None => root.join(project),
    }
}

/// The mount owning a project-relative path, and what is left of that path
/// below it. Longest mount point first, and a mount whose name a real folder
/// has taken over is inert: a file that exists on disk must never be invisible
/// behind a mount, so the real folder wins and the mount reads as conflicted.
fn mount_of<'a, 'b>(own: &Path, entry: &'a Project, rest: &'b str) -> Option<(&'a Mount, &'b str)> {
    entry.sorted_mounts().into_iter().find_map(|m| {
        let sub = rest
            .strip_prefix(&m.at)
            .and_then(|s| s.strip_prefix('/'))
            .filter(|s| !s.is_empty())?;
        (!own.join(&m.at).is_dir()).then_some((m, sub))
    })
}

/// Base directory and remainder for a note id — the forward half of one ordered
/// resolution rule, whose inverse is `noteIdOf` on the frontend. Both directions
/// read the same table in the same order.
fn base_of<'a>(app: &AppHandle, s: &Settings, name: &'a str) -> Result<(PathBuf, &'a str), String> {
    let root = notes_root(app)?;
    let Some((project, rest)) = name.split_once('/') else {
        return Ok((root, name));
    };
    let Some(entry) = s.projects.get(project) else {
        return Ok((root, name));
    };
    let own = project_base(&root, s, project);
    match mount_of(&own, entry, rest) {
        Some((mount, sub)) => Ok((PathBuf::from(&mount.path), sub)),
        None => Ok((own, rest)),
    }
}

/// Absolute path of a note id.
fn resolve_note(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let s = settings::settings(app)?;
    let name = checked_name(app, &s, name)?;
    let (base, rest) = base_of(app, &s, name)?;
    Ok(base.join(rest))
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

fn modified_ms(entry: &fs::DirEntry) -> u64 {
    entry
        .metadata()
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Whether a walk lists this file. `rel` is its path relative to the project's
/// location, which is what the `files` rules match against; when they don't
/// match, the registry allowlist decides. A re-include past the allowlist is
/// subject to the floor, which needs the file's size.
fn listed(s: &Settings, rules: &Rules, rel: &str, name: &str, entry: &fs::DirEntry) -> bool {
    match rules.verdict(rel, false) {
        Verdict::Exclude => false,
        Verdict::Include => {
            s.is_note(name) || floor_ok(name, entry.metadata().map(|m| m.len()).unwrap_or(0))
        }
        Verdict::Default => s.is_note(name),
    }
}

fn collect_md(
    s: &Settings,
    rules: &Rules,
    dir: &Path,
    prefix: &str,
    out: &mut Vec<FileInfo>,
) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_file = entry.file_type().map(|t| t.is_file()).unwrap_or(false);
        if is_file && listed(s, rules, &name, &name, &entry) {
            out.push(FileInfo {
                name: format!("{prefix}{name}"),
                modified_ms: modified_ms(&entry),
            });
        }
    }
    Ok(())
}

fn project_dirs(root: &Path) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir && valid_segment(&name) && name != ASSETS_DIR {
            out.push(name);
        }
    }
    out.sort();
    Ok(out)
}

/// List all note files in `base`: top level plus one project-folder level.
fn list_tree(s: &Settings, base: &Path) -> Result<Vec<FileInfo>, String> {
    let mut out = Vec::new();
    // Top-level notes belong to no project, so no project's rules apply.
    collect_md(s, &Rules::default(), base, "", &mut out)?;
    for project in project_dirs(base)? {
        let dir = base.join(&project);
        let (rules, _) = project_config::rules_for(&dir);
        collect_md(s, &rules, &dir, &format!("{project}/"), &mut out)?;
    }
    out.sort_by_key(|f| std::cmp::Reverse(f.modified_ms));
    Ok(out)
}

fn skip_dir(name: &str) -> bool {
    name.starts_with('.') || SKIP_DIRS.contains(&name.to_ascii_lowercase().as_str())
}

/// Recursively collect note files. Tolerant by design: unreadable directories
/// are skipped, not fatal — one broken linked folder must not take down the
/// whole note list. `prefix` accumulates the id, `rel` the project-relative
/// path the `files` rules match against — they differ for a mount, whose ids
/// start at `project/` but whose rules-space starts at `<at>/`.
fn collect_md_deep(
    s: &Settings,
    rules: &Rules,
    dir: &Path,
    prefix: &str,
    rel: &str,
    depth: u32,
    out: &mut Vec<FileInfo>,
) {
    if depth > MAX_DEPTH {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_file() {
            if listed(s, rules, &format!("{rel}{name}"), &name, &entry) {
                out.push(FileInfo {
                    name: format!("{prefix}{name}"),
                    modified_ms: modified_ms(&entry),
                });
            }
        } else if file_type.is_dir() && valid_segment(&name) {
            // The rules may prune a folder the walk would enter, or force one
            // the default skip list would not — someone's notes genuinely
            // living in `build/`. Nothing resurrects below a pruned folder,
            // as in `.gitignore`; dot-folders stay out either way, because
            // `valid_segment` keeps ids from ever expressing them.
            let descend = match rules.verdict(&format!("{rel}{name}"), true) {
                Verdict::Exclude => false,
                Verdict::Include => true,
                Verdict::Default => !skip_dir(&name),
            };
            if descend {
                collect_md_deep(
                    s,
                    rules,
                    &entry.path(),
                    &format!("{prefix}{name}/"),
                    &format!("{rel}{name}/"),
                    depth + 1,
                    out,
                );
            }
        }
    }
}

/// One folder walked besides the notes root: the id prefix its files get, the
/// project-relative prefix its paths have in rules-space, and the owning
/// project's `files` rules — which follow the project into its mounts, so a
/// mount is not a way around the project's exclusions.
struct WalkRoot {
    prefix: String,
    rel: String,
    dir: PathBuf,
    rules: Arc<Rules>,
}

/// Every folder walked besides the notes root: projects living elsewhere, and
/// every mount. One list, because a walk that knows about one and not the
/// other lists a note nowhere — and in search that reads as "no results"
/// rather than as a folder nobody looked in.
fn outside_roots(app: &AppHandle, s: &Settings) -> Result<Vec<WalkRoot>, String> {
    let root = notes_root(app)?;
    let mut out = Vec::new();
    for (name, entry) in &s.projects {
        if entry.path.is_none() && entry.mounts.is_empty() {
            continue;
        }
        let own = project_base(&root, s, name);
        let rules = Arc::new(project_config::rules_for(&own).0);
        if entry.path.is_some() {
            out.push(WalkRoot {
                prefix: format!("{name}/"),
                rel: String::new(),
                dir: own.clone(),
                rules: rules.clone(),
            });
        }
        for m in &entry.mounts {
            // Conflicted: the real folder of that name is walked with the
            // project, and resolution sends its ids there too.
            if !own.join(&m.at).is_dir() {
                out.push(WalkRoot {
                    prefix: format!("{name}/{}/", m.at),
                    rel: format!("{}/", m.at),
                    dir: PathBuf::from(&m.path),
                    rules: rules.clone(),
                });
            }
        }
    }
    Ok(out)
}

/// Depth already spent by an id prefix, so `MAX_DEPTH` bounds the whole id
/// rather than only the part below the walk's starting point.
fn prefix_depth(prefix: &str) -> u32 {
    prefix.matches('/').count() as u32
}

/// `deep: false` skips the walk of folders outside the notes root (which can be
/// slow) so the first paint after launch isn't held up by it; a deep call
/// follows.
#[tauri::command]
pub fn list_notes(app: AppHandle, deep: Option<bool>) -> Result<Vec<FileInfo>, String> {
    let s = settings::settings(&app)?;
    let mut out = list_tree(&s, &notes_root(&app)?)?;
    if deep.unwrap_or(true) {
        for r in outside_roots(&app, &s)? {
            collect_md_deep(
                &s,
                &r.rules,
                &r.dir,
                &r.prefix,
                &r.rel,
                prefix_depth(&r.prefix),
                &mut out,
            );
        }
        out.sort_by_key(|f| std::cmp::Reverse(f.modified_ms));
    }
    Ok(out)
}

/// One matching line. Deliberately no match offsets: the frontend re-finds the
/// needle in `text` with JS string indices, which is the only indexing that
/// agrees with how it will slice the string for highlighting.
#[derive(Serialize)]
pub struct SearchHit {
    /// Note id, same shape `list_notes` returns.
    pub note: String,
    /// 1-based line number, for the jump-to on click.
    pub line: u32,
    pub text: String,
}

/// Every note id paired with its absolute path — the same corpus `list_notes`
/// enumerates, but resolved once instead of per note.
fn note_paths(app: &AppHandle) -> Result<Vec<(String, PathBuf)>, String> {
    let s = settings::settings(app)?;
    let root = notes_root(app)?;
    let mut out: Vec<(String, PathBuf)> = list_tree(&s, &root)?
        .into_iter()
        .map(|f| {
            let path = root.join(&f.name);
            (f.name, path)
        })
        .collect();
    for r in outside_roots(app, &s)? {
        let mut found = Vec::new();
        collect_md_deep(
            &s,
            &r.rules,
            &r.dir,
            "",
            &r.rel,
            prefix_depth(&r.prefix),
            &mut found,
        );
        out.extend(
            found
                .into_iter()
                .map(|f| (format!("{}{}", r.prefix, f.name), r.dir.join(&f.name))),
        );
    }
    Ok(out)
}

/// Longest line kept whole; past this a window around the match is returned so
/// one minified file can't push megabytes through the IPC boundary.
const MAX_HIT_CHARS: usize = 300;
/// Files above this are assumed not to be prose and skipped.
const MAX_SEARCH_BYTES: u64 = 2 * 1024 * 1024;

/// Case-insensitive literal search over every note's contents.
///
/// A plain scan, no index: the corpus is a few hundred small markdown files,
/// so reading them costs less than keeping a derived index honest against the
/// other tools that edit these files.
#[tauri::command]
pub fn search_notes(
    app: AppHandle,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<SearchHit>, String> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(Vec::new());
    }
    let limit = limit.unwrap_or(500);
    let mut out = Vec::new();
    for (note, path) in note_paths(&app)? {
        if out.len() >= limit {
            break;
        }
        if fs::metadata(&path).map(|m| m.len()).unwrap_or(0) > MAX_SEARCH_BYTES {
            continue;
        }
        // Unreadable file: skip, same tolerance as the listing walk.
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        for (i, line) in content.lines().enumerate() {
            if out.len() >= limit {
                break;
            }
            let Some(at) = line.to_lowercase().find(&needle) else {
                continue;
            };
            out.push(SearchHit {
                note: note.clone(),
                line: i as u32 + 1,
                text: excerpt(line, at),
            });
        }
    }
    Ok(out)
}

/// Trim a long line down to a window around `at` (a byte offset into `line`),
/// always cutting on a char boundary.
fn excerpt(line: &str, at: usize) -> String {
    let line = line.trim_end();
    if line.chars().count() <= MAX_HIT_CHARS {
        return line.to_string();
    }
    // Keep a little context before the match so it doesn't hug the left edge.
    let start = line[..at]
        .char_indices()
        .rev()
        .nth(40)
        .map(|(i, _)| i)
        .unwrap_or(0);
    let tail = &line[start..];
    let end = tail
        .char_indices()
        .nth(MAX_HIT_CHARS)
        .map(|(i, _)| i)
        .unwrap_or(tail.len());
    let mut s = String::new();
    if start > 0 {
        s.push('…');
    }
    s.push_str(&tail[..end]);
    if end < tail.len() {
        s.push('…');
    }
    s
}

/// Notes-root subfolders plus the registered projects that live elsewhere.
/// Registered entries without a location need no mention: their folder is under
/// the notes root, so the walk above already found them.
#[tauri::command]
pub fn list_projects(app: AppHandle) -> Result<Vec<String>, String> {
    let mut out = project_dirs(&notes_root(&app)?)?;
    out.extend(
        settings::settings(&app)?
            .located_projects()
            .map(|(n, _)| n.clone()),
    );
    out.sort();
    out.dedup();
    Ok(out)
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
    fs::write(path, content).map_err(|e| e.to_string())
}

/// Move a note to the recycle bin (recoverable — notes are user-owned files,
/// never hard-deleted) and discard its shadow draft.
#[tauri::command]
pub fn delete_note(app: AppHandle, name: String) -> Result<(), String> {
    trash::delete(resolve_note(&app, &name)?).map_err(|e| e.to_string())?;
    let s = settings::settings(&app)?;
    let draft = drafts_dir(&app)?.join(checked_name(&app, &s, &name)?);
    if draft.exists() {
        let _ = fs::remove_file(draft);
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
    let to_path = resolve_note(&app, &to)?;
    if to_path.exists() {
        return Err(format!("a note named {to} already exists"));
    }
    if let Some(parent) = to_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // `rename` fails across volumes, which linked folders and mounts make an
    // ordinary case rather than an exotic one.
    let from_path = resolve_note(&app, &from)?;
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
    if !path.is_dir() {
        return Err(format!("no folder at {dir}"));
    }
    trash::delete(&path).map_err(|e| e.to_string())?;
    // Drafts are app-managed shadow copies, removed outright like
    // `delete_note` removes one note's draft.
    let _ = fs::remove_dir_all(drafts_dir(&app)?.join(&dir));
    Ok(())
}

#[tauri::command]
pub fn list_drafts(app: AppHandle) -> Result<Vec<FileInfo>, String> {
    // Deep walk: drafts mirror ids like `project/docs/x.md`. Default rules on
    // purpose — matching each draft against its project's `files` rules would
    // mean a config read per id segment, and what it would buy (listing a
    // draft of a re-included non-allowlist file) is a known gap in TODO.md.
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
fn assets_dir_for(app: &AppHandle, note: Option<&str>) -> Result<PathBuf, String> {
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

fn unique_asset(dir: &Path, stem: &str, ext: &str) -> (PathBuf, String) {
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
    let (rules, _) = project_config::rules_for(dir);
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
/// clash is gone. `external` means the backing folder lives outside the
/// virtual-folders home — a folder the user owns elsewhere, which deletion
/// warnings call out by path.
#[derive(Serialize)]
pub struct MountInfo {
    pub project: String,
    pub at: String,
    pub path: String,
    pub conflicted: bool,
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

/// Shared validation for attaching a mount at `at`, however its backing folder
/// comes to exist: the project is real, the name is usable, no real folder
/// sits at it, and no other mount overlaps it. Returns the normalized `at`.
fn checked_mount_at(root: &Path, s: &Settings, project: &str, at: &str) -> Result<String, String> {
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
    if project_base(root, s, project).join(&at).is_dir() {
        return Err(format!("{project} already has a folder of its own at {at}"));
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
    // Drafts are app-managed shadow copies, removed outright like
    // `delete_note` removes one note's draft.
    let _ = fs::remove_dir_all(drafts_dir(&app)?.join(&project).join(&at));
    remove_mount(app, project, at)
}
