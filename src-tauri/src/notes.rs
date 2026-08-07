//! Filesystem commands for notes, projects, shadow drafts, and pasted assets.
//!
//! Layout of the notes root (`Documents/asapnotes`): `.md` files at the top
//! level are the "inbox"; each first-level subfolder is a project; `assets/`
//! holds pasted images and is not a project. A note's id everywhere is its
//! root-relative path (`note.md` or `project/note.md`), one folder deep.
//!
//! Drafts live in app data, mirror the same relative paths, and hold unsaved
//! editor state: a draft named like an existing note is its unsaved edits, any
//! other draft is an unsaved untitled note. `Ctrl+S` on the frontend writes the
//! note and deletes the draft.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager};

const ASSETS_DIR: &str = "assets";
const IMAGE_EXTS: [&str; 7] = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];

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

/// Note ids come from the frontend as root-relative paths, at most one project
/// folder deep; reject anything that could escape the root.
fn checked_name(name: &str) -> Result<&str, String> {
    let segments: Vec<&str> = name.split('/').collect();
    let file = segments.last().copied().unwrap_or("");
    let ok = (1..=2).contains(&segments.len())
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

#[tauri::command]
pub fn list_notes(app: AppHandle) -> Result<Vec<FileInfo>, String> {
    list_tree(&notes_root(&app)?)
}

#[tauri::command]
pub fn list_projects(app: AppHandle) -> Result<Vec<String>, String> {
    project_dirs(&notes_root(&app)?)
}

#[tauri::command]
pub fn notes_root_path(app: AppHandle) -> Result<String, String> {
    Ok(notes_root(&app)?.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn read_note(app: AppHandle, name: String) -> Result<String, String> {
    fs::read_to_string(notes_root(&app)?.join(checked_name(&name)?)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_note(app: AppHandle, name: String, content: String) -> Result<(), String> {
    let path = note_path(&notes_root(&app)?, &name)?;
    fs::write(path, content).map_err(|e| e.to_string())
}

/// Move/rename a note between projects (or to/from the inbox); its shadow
/// draft, if any, moves with it.
#[tauri::command]
pub fn move_note(app: AppHandle, from: String, to: String) -> Result<(), String> {
    let root = notes_root(&app)?;
    let to_path = note_path(&root, &to)?;
    if to_path.exists() {
        return Err(format!("a note named {to} already exists"));
    }
    fs::rename(root.join(checked_name(&from)?), to_path).map_err(|e| e.to_string())?;
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
    list_tree(&drafts_dir(&app)?)
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

fn unique_asset(dir: &Path, stem: &str, ext: &str) -> (PathBuf, String) {
    let mut file = format!("{stem}.{ext}");
    let mut n = 2;
    while dir.join(&file).exists() {
        file = format!("{stem}-{n}.{ext}");
        n += 1;
    }
    (dir.join(&file), format!("{ASSETS_DIR}/{file}"))
}

/// Save a pasted image. The bytes arrive as the raw IPC body; the file
/// extension rides in an `ext` header. Returns the root-relative asset path.
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
    let dir = assets_dir(&app)?;
    let (path, rel) = unique_asset(&dir, &format!("img-{}", now_ms()), &ext);
    fs::write(path, bytes).map_err(|e| e.to_string())?;
    Ok(rel)
}

/// Copy an image dropped from the filesystem into `assets/`. Returns the
/// root-relative asset path.
#[tauri::command]
pub fn import_asset(app: AppHandle, src: String) -> Result<String, String> {
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
    let dir = assets_dir(&app)?;
    let (path, rel) = unique_asset(&dir, &format!("{stem}-{}", now_ms()), &ext);
    fs::copy(&src, path).map_err(|e| e.to_string())?;
    Ok(rel)
}
