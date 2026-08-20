//! The listing walks: every file this corpus calls a note, and the projects
//! they sit in.
//!
//! One walk answers listing, search and the scan counts, because a walk that
//! knows about one folder and not another lists a note nowhere — and in search
//! that reads as "no results" rather than as a folder nobody looked in.

use super::ids::{floor_ok, project_base, valid_segment, ASSETS_DIR, MAX_DEPTH};
use super::Roots;
use crate::project_config::{self, Rules, Verdict};
use crate::settings::Settings;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::UNIX_EPOCH;

/// Directories never walked when listing or scanning folders.
pub const SKIP_DIRS: [&str; 8] = [
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    "bin",
    "obj",
    "logs",
];

#[derive(Debug, Clone, Serialize)]
pub struct FileInfo {
    pub name: String,
    pub modified_ms: u64,
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

/// Whether a walk lists this file. `rel` is its path relative to the project's
/// location, which is what the `files` rules match against; when they don't
/// match, the registry allowlist decides. A re-include past the allowlist is
/// subject to the floor, which needs the file's size.
pub fn listed(s: &Settings, rules: &Rules, rel: &str, name: &str, len: u64) -> bool {
    // Dot-files never list: ids can't express them (`valid_segment`), so a
    // listed row would only error on open. Same rule directories already have.
    if name.starts_with('.') {
        return false;
    }
    match rules.verdict(rel, false) {
        Verdict::Exclude => false,
        Verdict::Include => s.is_note(name) || floor_ok(name, len),
        // Only types that ask to be listed show uninvited (`is_listed`) — the
        // config/data/log types exist for icons and openability, not for the
        // walks; an `!` pattern above is the opt-in. Generated lockfiles are
        // the one machine-written *file* the extension allowlist can't
        // express; a project's `!` rule can pull one back in.
        Verdict::Default => s.is_listed(name) && !name.eq_ignore_ascii_case("package-lock.json"),
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
        let len = entry.metadata().map(|m| m.len()).unwrap_or(0);
        if is_file && listed(s, rules, &name, &name, len) {
            out.push(FileInfo {
                name: format!("{prefix}{name}"),
                modified_ms: modified_ms(&entry),
            });
        }
    }
    Ok(())
}

pub fn project_dirs(root: &Path) -> Result<Vec<String>, String> {
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

/// List note files in `base`: the top level, then each project folder — one
/// level in when `deep` is false, all the way down when it is true.
///
/// The shallow pass exists for the first paint only. Everything else walks a
/// project's folders in full, because everything else in the app already assumes
/// they can be there: the working convention keeps dated entries in
/// `decisions/`, "New folder" makes real ones, and a project's `files` rules
/// re-include paths like `src/**/*.rs`. A walk that stopped one level in left
/// those files addressable by id and findable by nothing.
fn list_tree(s: &Settings, base: &Path, deep: bool) -> Result<Vec<FileInfo>, String> {
    let mut out = Vec::new();
    // Top-level notes belong to no project — only the personal layer applies.
    let (personal, _) = project_config::personal_rules(&s.files);
    collect_md(s, &personal, base, "", &mut out)?;
    for project in project_dirs(base)? {
        let dir = base.join(&project);
        let rules = project_config::walk_rules(&s.files, &dir);
        let prefix = format!("{project}/");
        if deep {
            // Depth starts at 1: the project folder is already one segment of
            // the id, so `MAX_DEPTH` bounds the whole id and not just the part
            // below here.
            collect_md_deep(s, &rules, &dir, &prefix, "", 1, &mut out);
        } else {
            collect_md(s, &rules, &dir, &prefix, &mut out)?;
        }
    }
    out.sort_by_key(|f| std::cmp::Reverse(f.modified_ms));
    Ok(out)
}

pub fn skip_dir(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    // `.egg-info` folders are Python packaging metadata — generated output
    // whose files (`SOURCES.txt`, `requires.txt`, …) all pass the allowlist.
    name.starts_with('.') || lower.ends_with(".egg-info") || SKIP_DIRS.contains(&lower.as_str())
}

/// Recursively collect note files. Tolerant by design: unreadable directories
/// are skipped, not fatal — one broken linked folder must not take down the
/// whole note list. `prefix` accumulates the id, `rel` the project-relative
/// path the `files` rules match against — they differ for a mount, whose ids
/// start at `project/` but whose rules-space starts at `<at>/`.
pub fn collect_md_deep(
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
            let len = entry.metadata().map(|m| m.len()).unwrap_or(0);
            if listed(s, rules, &format!("{rel}{name}"), &name, len) {
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
pub struct WalkRoot {
    pub prefix: String,
    pub rel: String,
    pub dir: PathBuf,
    pub rules: Arc<Rules>,
}

/// Every folder walked besides the notes root: projects living elsewhere, and
/// every mount. One list, because a walk that knows about one and not the
/// other lists a note nowhere.
pub fn outside_roots(roots: &Roots, s: &Settings) -> Vec<WalkRoot> {
    let mut out = Vec::new();
    for (name, entry) in &s.projects {
        if entry.path.is_none() && entry.mounts.is_empty() {
            continue;
        }
        let own = project_base(&roots.notes, s, name);
        let rules = Arc::new(project_config::walk_rules(&s.files, &own));
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
    out
}

/// Depth already spent by an id prefix, so `MAX_DEPTH` bounds the whole id
/// rather than only the part below the walk's starting point.
fn prefix_depth(prefix: &str) -> u32 {
    prefix.matches('/').count() as u32
}

/// `deep: false` is the first-paint walk: one level into each project in the
/// notes root, and none of the folders outside it (which can be slow). The deep
/// call that follows lists everything.
pub fn list_notes(roots: &Roots, s: &Settings, deep: bool) -> Result<Vec<FileInfo>, String> {
    let mut out = list_tree(s, &roots.notes, deep)?;
    if deep {
        for r in outside_roots(roots, s) {
            collect_md_deep(
                s,
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

/// Every note id paired with its absolute path — the same corpus [`list_notes`]
/// enumerates, but resolved once instead of per note.
pub fn note_paths(roots: &Roots, s: &Settings) -> Result<Vec<(String, PathBuf)>, String> {
    let mut out: Vec<(String, PathBuf)> = list_tree(s, &roots.notes, true)?
        .into_iter()
        .map(|f| {
            let path = roots.notes.join(&f.name);
            (f.name, path)
        })
        .collect();
    for r in outside_roots(roots, s) {
        let mut found = Vec::new();
        collect_md_deep(
            s,
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

/// A project heading as the explorer sees it. `missing` means its registered
/// folder is gone from disk (removed outside the app, unplugged drive) — the
/// walks list nothing there, so without the flag it would read as an empty
/// project. A notes-root project can't be missing: it exists because its
/// folder was just listed.
#[derive(Debug, Clone, Serialize)]
pub struct ProjectInfo {
    pub name: String,
    pub missing: bool,
}

/// Notes-root subfolders plus the registered projects that live elsewhere.
/// Registered entries without a location need no mention: their folder is under
/// the notes root, so the walk above already found them.
pub fn list_projects(roots: &Roots, s: &Settings) -> Result<Vec<ProjectInfo>, String> {
    let mut out: Vec<ProjectInfo> = project_dirs(&roots.notes)?
        .into_iter()
        .map(|name| ProjectInfo {
            name,
            missing: false,
        })
        .collect();
    for (name, dir) in s.located_projects() {
        if !out.iter().any(|p| &p.name == name) {
            out.push(ProjectInfo {
                name: name.clone(),
                missing: !Path::new(dir).is_dir(),
            });
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}
