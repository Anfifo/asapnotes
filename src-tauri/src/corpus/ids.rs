//! Note ids and where they land on disk.
//!
//! A note's id is its root-relative path (`note.md`, `project/sub/note.md`).
//! [`base_of`] is the forward half of one ordered resolution rule whose inverse
//! is `noteIdOf` in `src/App.tsx` — the two have to agree, or one file acquires
//! two ids, hence two shadow drafts and two tabs that overwrite each other.

use super::Roots;
use crate::project_config::{self, Verdict};
use crate::settings::{Mount, Project, Settings};
use std::fs;
use std::path::{Path, PathBuf};

pub const ASSETS_DIR: &str = "assets";
pub const MAX_DEPTH: u32 = 12;

/// Files above this are assumed not to be prose: never searched, never
/// re-included past the type allowlist.
pub const MAX_SEARCH_BYTES: u64 = 2 * 1024 * 1024;

/// Extensions a `!` re-include may never pull in, whatever a project's config
/// asks for.
pub const EXEC_EXTS: [&str; 17] = [
    "exe", "bat", "cmd", "com", "scr", "ps1", "msi", "vbs", "vbe", "js", "jse", "wsf", "wsh",
    "hta", "lnk", "reg", "msc",
];

pub fn valid_segment(s: &str) -> bool {
    !s.is_empty() && !s.contains('\\') && !s.starts_with('.')
}

/// The floor under re-inclusion: a `!` pattern waives the type allowlist but
/// never pulls in an executable type or a file over the search size cap — a
/// pattern arriving in a pulled config must not make the app touch something
/// it would otherwise refuse to.
pub fn floor_ok(name: &str, len: u64) -> bool {
    let ext = name
        .rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .unwrap_or_default();
    !EXEC_EXTS.contains(&ext.as_str()) && len <= MAX_SEARCH_BYTES
}

/// Note ids arrive from outside — the frontend, or an MCP client — as relative
/// paths; reject anything that could escape its base, or name a file that is
/// not a note (registry allowlist, or a project's re-include).
pub fn checked_name<'a>(roots: &Roots, s: &Settings, name: &'a str) -> Result<&'a str, String> {
    let segments: Vec<&str> = name.split('/').collect();
    let file = segments.last().copied().unwrap_or("");
    let ok = (1..=MAX_DEPTH as usize).contains(&segments.len())
        && segments.iter().all(|s| valid_segment(s))
        && (segments.len() == 1 || segments[0] != ASSETS_DIR)
        && (s.is_note(file) || re_included(roots, s, name));
    if ok {
        Ok(name)
    } else {
        Err(format!("invalid note name: {name}"))
    }
}

/// Whether a project's `files` rules pull this id in past the registry
/// allowlist — `!src/**/*.rs` making `.rs` files notes. Like the listing walk,
/// but by id: a re-included file has to be openable, savable and draftable,
/// not just listed.
fn re_included(roots: &Roots, s: &Settings, name: &str) -> bool {
    // Top-level notes belong to no project, so no project's rules apply.
    let Some((project, rest)) = name.split_once('/') else {
        return false;
    };
    let rules = project_config::walk_rules(&s.files, &project_base(&roots.notes, s, project));
    if rules.verdict(rest, false) != Verdict::Include {
        return false;
    }
    // A file being created here doesn't exist yet; it enters at size zero.
    let (base, sub) = base_of(roots, s, name);
    let len = fs::metadata(base.join(sub)).map(|m| m.len()).unwrap_or(0);
    floor_ok(name, len)
}

/// Where a project's own files live: its registered location, else the
/// notes-root subfolder that carries its name.
pub fn project_base(root: &Path, s: &Settings, project: &str) -> PathBuf {
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

/// Base directory and remainder for a note id — the forward half of the
/// resolution rule. Both directions read the same table in the same order.
pub fn base_of<'a>(roots: &Roots, s: &Settings, name: &'a str) -> (PathBuf, &'a str) {
    let Some((project, rest)) = name.split_once('/') else {
        return (roots.notes.clone(), name);
    };
    let Some(entry) = s.projects.get(project) else {
        return (roots.notes.clone(), name);
    };
    let own = project_base(&roots.notes, s, project);
    match mount_of(&own, entry, rest) {
        Some((mount, sub)) => (PathBuf::from(&mount.path), sub),
        None => (own, rest),
    }
}

/// Absolute path of a note id, after checking the id is one this corpus admits.
pub fn resolve(roots: &Roots, s: &Settings, name: &str) -> Result<PathBuf, String> {
    let name = checked_name(roots, s, name)?;
    let (base, rest) = base_of(roots, s, name);
    Ok(base.join(rest))
}

/// The project a note id belongs to — its first segment — or `None` for a
/// top-level note, which belongs to no project. Every grant check starts here.
pub fn project_of(name: &str) -> Option<&str> {
    name.split_once('/').map(|(project, _)| project)
}
