//! Filesystem commands for notes, projects, shadow drafts, and pasted assets.
//!
//! Layout of the notes root (`Documents/asapnotes`): `.md` files at the top
//! level are the "inbox"; each first-level subfolder is a project; `assets/`
//! holds pasted images and is not a project. A note's id everywhere is its
//! root-relative path (`note.md` or `project/note.md`).
//!
//! External projects extend this: a mapping (name → absolute folder path,
//! stored in app data) makes any folder on disk a project. Its notes keep the
//! same id shape — `name/rel/path/note.md`, any depth — and the id's first
//! segment decides where the file lives: an external mapping wins, everything
//! else resolves under the notes root.
//!
//! Drafts live in app data, mirror the same relative paths, and hold unsaved
//! editor state: a draft named like an existing note is its unsaved edits, any
//! other draft is an unsaved untitled note. `Ctrl+S` on the frontend writes the
//! note and deletes the draft.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager};

const ASSETS_DIR: &str = "assets";
const IMAGE_EXTS: [&str; 7] = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];
/// Directories never walked when listing or scanning external folders.
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
/// `project/…/note.md`); reject anything that could escape its base.
fn checked_name(name: &str) -> Result<&str, String> {
    let segments: Vec<&str> = name.split('/').collect();
    let file = segments.last().copied().unwrap_or("");
    let ok = (1..=MAX_DEPTH as usize).contains(&segments.len())
        && segments.iter().all(|s| valid_segment(s))
        && file.ends_with(".md")
        && file.len() > ".md".len()
        && (segments.len() == 1 || segments[0] != ASSETS_DIR);
    if ok {
        Ok(name)
    } else {
        Err(format!("invalid note name: {name}"))
    }
}

// --- External project mappings (name → absolute folder path) ---

fn external_store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("external_projects.json"))
}

pub fn external_map(app: &AppHandle) -> Result<BTreeMap<String, String>, String> {
    let path = external_store_path(app)?;
    if !path.exists() {
        return Ok(BTreeMap::new());
    }
    let data = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&data).map_err(|e| e.to_string())
}

fn save_external_map(app: &AppHandle, map: &BTreeMap<String, String>) -> Result<(), String> {
    let data = serde_json::to_string_pretty(map).map_err(|e| e.to_string())?;
    fs::write(external_store_path(app)?, data).map_err(|e| e.to_string())
}

/// Absolute path of a note id: an external mapping on the first segment wins,
/// everything else lives under the notes root.
fn resolve_note(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let name = checked_name(name)?;
    if let Some((project, rest)) = name.split_once('/') {
        if let Some(dir) = external_map(app)?.get(project) {
            return Ok(Path::new(dir).join(rest));
        }
    }
    Ok(notes_root(app)?.join(name))
}

/// Resolve a note id inside `base`, creating the project folder if needed.
fn note_path(base: &Path, name: &str) -> Result<PathBuf, String> {
    let name = checked_name(name)?;
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

fn collect_md(dir: &Path, prefix: &str, out: &mut Vec<FileInfo>) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_file = entry.file_type().map(|t| t.is_file()).unwrap_or(false);
        if is_file && name.ends_with(".md") {
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

/// List all `.md` files in `base`: top level plus one project-folder level.
fn list_tree(base: &Path) -> Result<Vec<FileInfo>, String> {
    let mut out = Vec::new();
    collect_md(base, "", &mut out)?;
    for project in project_dirs(base)? {
        collect_md(&base.join(&project), &format!("{project}/"), &mut out)?;
    }
    out.sort_by_key(|f| std::cmp::Reverse(f.modified_ms));
    Ok(out)
}

fn skip_dir(name: &str) -> bool {
    name.starts_with('.') || SKIP_DIRS.contains(&name.to_ascii_lowercase().as_str())
}

/// Recursively collect `.md` files. Tolerant by design: unreadable directories
/// are skipped, not fatal — one broken external folder must not take down the
/// whole note list.
fn collect_md_deep(dir: &Path, prefix: &str, depth: u32, out: &mut Vec<FileInfo>) {
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
        if file_type.is_file() && name.ends_with(".md") {
            out.push(FileInfo {
                name: format!("{prefix}{name}"),
                modified_ms: modified_ms(&entry),
            });
        } else if file_type.is_dir() && valid_segment(&name) && !skip_dir(&name) {
            collect_md_deep(&entry.path(), &format!("{prefix}{name}/"), depth + 1, out);
        }
    }
}

#[tauri::command]
pub fn list_notes(app: AppHandle) -> Result<Vec<FileInfo>, String> {
    let mut out = list_tree(&notes_root(&app)?)?;
    for (name, dir) in external_map(&app)? {
        collect_md_deep(Path::new(&dir), &format!("{name}/"), 0, &mut out);
    }
    out.sort_by_key(|f| std::cmp::Reverse(f.modified_ms));
    Ok(out)
}

#[tauri::command]
pub fn list_projects(app: AppHandle) -> Result<Vec<String>, String> {
    let mut out = project_dirs(&notes_root(&app)?)?;
    out.extend(external_map(&app)?.into_keys());
    out.sort();
    out.dedup();
    Ok(out)
}

#[tauri::command]
pub fn notes_root_path(app: AppHandle) -> Result<String, String> {
    Ok(notes_root(&app)?.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn read_note(app: AppHandle, name: String) -> Result<String, String> {
    fs::read_to_string(resolve_note(&app, &name)?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_note(app: AppHandle, name: String, content: String) -> Result<(), String> {
    let path = resolve_note(&app, &name)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, content).map_err(|e| e.to_string())
}

/// Move/rename a note between projects (or to/from the inbox); its shadow
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
    fs::rename(resolve_note(&app, &from)?, to_path).map_err(|e| e.to_string())?;
    let drafts = drafts_dir(&app)?;
    let draft_from = drafts.join(checked_name(&from)?);
    if draft_from.exists() {
        let draft_to = note_path(&drafts, &to)?;
        let _ = fs::rename(draft_from, draft_to);
    }
    Ok(())
}

#[tauri::command]
pub fn list_drafts(app: AppHandle) -> Result<Vec<FileInfo>, String> {
    // Deep walk: drafts of external notes mirror ids like `project/docs/x.md`.
    let mut out = Vec::new();
    collect_md_deep(&drafts_dir(&app)?, "", 0, &mut out);
    out.sort_by_key(|f| std::cmp::Reverse(f.modified_ms));
    Ok(out)
}

#[tauri::command]
pub fn read_draft(app: AppHandle, id: String) -> Result<String, String> {
    fs::read_to_string(drafts_dir(&app)?.join(checked_name(&id)?)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_draft(app: AppHandle, id: String, content: String) -> Result<(), String> {
    let path = note_path(&drafts_dir(&app)?, &id)?;
    fs::write(path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_draft(app: AppHandle, id: String) -> Result<(), String> {
    let path = drafts_dir(&app)?.join(checked_name(&id)?);
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

/// Where pasted images for a note go: an external project keeps its images in
/// its own `assets/` (the folder owns its files); everything else shares the
/// root `assets/`.
fn assets_dir_for(app: &AppHandle, project: Option<&str>) -> Result<PathBuf, String> {
    if let Some(project) = project {
        if let Some(base) = external_map(app)?.get(project) {
            let dir = Path::new(base).join(ASSETS_DIR);
            fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            return Ok(dir);
        }
    }
    assets_dir(app)
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
/// extension and (percent-encoded) owning project ride in headers. Returns the
/// asset path relative to the project base, e.g. `assets/img-123.png`.
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
    let project = request
        .headers()
        .get("project")
        .and_then(|v| v.to_str().ok())
        .map(percent_decode);
    let dir = assets_dir_for(&app, project.as_deref())?;
    let (path, rel) = unique_asset(&dir, &format!("img-{}", now_ms()), &ext);
    fs::write(path, bytes).map_err(|e| e.to_string())?;
    Ok(rel)
}

/// Copy an image dropped from the filesystem into `assets/`. Returns the
/// asset path relative to the project base.
#[tauri::command]
pub fn import_asset(
    app: AppHandle,
    src: String,
    project: Option<String>,
) -> Result<String, String> {
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
    let dir = assets_dir_for(&app, project.as_deref())?;
    let (path, rel) = unique_asset(&dir, &format!("{stem}-{}", now_ms()), &ext);
    fs::copy(&src, path).map_err(|e| e.to_string())?;
    Ok(rel)
}

// --- Scan a folder for external projects ---

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

fn count_md(dir: &Path) -> usize {
    let mut files = Vec::new();
    collect_md_deep(dir, "", 0, &mut files);
    files.len()
}

/// Depth-first hunt for project folders. A folder with a README becomes a
/// candidate and is not descended into further — nested READMEs (docs inside a
/// repo) belong to the outer project.
fn scan_dir(dir: &Path, depth: u32, out: &mut Vec<ProjectCandidate>) {
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
                md_count: count_md(dir),
            });
        }
        return;
    }
    for entry in entries {
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir && valid_segment(&name) && !skip_dir(&name) {
            scan_dir(&entry.path(), depth + 1, out);
        }
    }
}

#[tauri::command]
pub fn scan_projects(dir: String) -> Result<Vec<ProjectCandidate>, String> {
    let root = PathBuf::from(&dir);
    if !root.is_dir() {
        return Err(format!("not a folder: {dir}"));
    }
    let mut out = Vec::new();
    scan_dir(&root, 0, &mut out);
    Ok(out)
}

#[derive(Deserialize)]
pub struct NewExternalProject {
    pub name: String,
    pub path: String,
}

#[tauri::command]
pub fn add_external_projects(
    app: AppHandle,
    projects: Vec<NewExternalProject>,
) -> Result<(), String> {
    let root = notes_root(&app)?;
    let mut map = external_map(&app)?;
    for p in projects {
        if !valid_segment(&p.name) || p.name == ASSETS_DIR {
            return Err(format!("invalid project name: {}", p.name));
        }
        if map.contains_key(&p.name) || root.join(&p.name).is_dir() {
            return Err(format!("a project named {} already exists", p.name));
        }
        if !Path::new(&p.path).is_dir() {
            return Err(format!("not a folder: {}", p.path));
        }
        // Preview must be able to load this folder's images via the asset
        // protocol; the static scope only covers the root assets dir.
        let _ = app.asset_protocol_scope().allow_directory(&p.path, true);
        map.insert(p.name, p.path);
    }
    save_external_map(&app, &map)
}

#[tauri::command]
pub fn remove_external_project(app: AppHandle, name: String) -> Result<(), String> {
    let mut map = external_map(&app)?;
    map.remove(&name);
    save_external_map(&app, &map)
}

#[tauri::command]
pub fn list_external_projects(app: AppHandle) -> Result<BTreeMap<String, String>, String> {
    external_map(&app)
}
