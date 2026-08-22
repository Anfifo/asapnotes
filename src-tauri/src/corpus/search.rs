//! Finding things — the part of this surface that gets used most.
//!
//! Two ways in, because they answer different questions and cost very different
//! amounts. [`find_notes`] matches note *ids* and reads no file at all, so
//! "where is my meeting note" is nearly free; [`search`] reads contents.
//!
//! Content search is still a plain scan, no index: the corpus is a few hundred
//! small files, and an index would have to be kept honest against every other
//! tool that edits these files — which is the whole point of the store being
//! plain markdown. What makes it quick enough is narrowing before reading:
//! a project filter drops most files without opening them, a whole-file check
//! skips the per-line pass on files that can't match, and a per-note cap stops
//! one long file from eating the whole budget.

use super::ids::MAX_SEARCH_BYTES;
use super::sections;
use super::walk::{note_paths, FileInfo};
use super::Roots;
use crate::settings::Settings;
use serde::Serialize;
use std::fs;

/// Longest line kept whole; past this a window around the match is returned so
/// one minified file can't push megabytes through the boundary.
const MAX_HIT_CHARS: usize = 300;

/// One matching line. Deliberately no match offsets: the frontend re-finds the
/// needle in `text` with JS string indices, which is the only indexing that
/// agrees with how it will slice the string for highlighting.
#[derive(Debug, Clone, Serialize)]
pub struct SearchHit {
    /// Note id, same shape the listing returns.
    pub note: String,
    /// 1-based line number, for the jump-to on click.
    pub line: u32,
    pub text: String,
    /// Heading path this line falls under. Only computed when asked for — it
    /// costs an outline parse per matching file, which the app's own search
    /// has no use for, and absent it serializes away entirely.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub section: Option<String>,
}

/// Which notes a caller may be shown; `None` is the whole corpus.
///
/// Consult it *before* counting a hit. Filtering after the cap lets notes the
/// caller cannot see spend the limit — one hidden project sorting early in the
/// walk starves every visible one, and the answer comes back looking like a
/// nearly empty corpus rather than like a refusal.
pub type Visible<'a> = Option<&'a dyn Fn(&str) -> bool>;

/// What to look for and how much to bring back.
#[derive(Debug, Clone)]
pub struct Query {
    pub needle: String,
    /// Total hits across all notes.
    pub limit: usize,
    /// Restrict to one project. The big win for a scoped caller: files outside
    /// it are never opened.
    pub project: Option<String>,
    /// Cap per note, so one long file can't fill the whole result.
    pub per_note: Option<usize>,
    /// Attach each hit's heading path.
    pub sections: bool,
}

impl Query {
    pub fn new(needle: impl Into<String>) -> Self {
        Self {
            needle: needle.into(),
            limit: 500,
            project: None,
            per_note: None,
            sections: false,
        }
    }
}

/// Whether a note id belongs to `project` — its first segment, which is what
/// [`super::ids::project_of`] reads. A top-level note belongs to none, so a
/// project-scoped search never returns one.
fn in_project(note: &str, project: &str) -> bool {
    note.split_once('/').map(|(p, _)| p) == Some(project)
}

/// Case-insensitive literal search over note contents.
pub fn search(
    roots: &Roots,
    s: &Settings,
    q: &Query,
    visible: Visible,
) -> Result<Vec<SearchHit>, String> {
    let needle = q.needle.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for (note, path) in note_paths(roots, s)? {
        if out.len() >= q.limit {
            break;
        }
        // Before the file is opened and before anything is counted: a note the
        // caller may not be shown must not spend the limit.
        if visible.is_some_and(|allow| !allow(&note)) {
            continue;
        }
        if let Some(project) = &q.project {
            if !in_project(&note, project) {
                continue;
            }
        }
        if fs::metadata(&path).map(|m| m.len()).unwrap_or(0) > MAX_SEARCH_BYTES {
            continue;
        }
        // Unreadable file: skip, same tolerance as the listing walk.
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        // Lowercasing is per character, so doing it once for the file and once
        // per line agree — and most files don't match at all, which is the
        // pass this buys back.
        if !content.to_lowercase().contains(&needle) {
            continue;
        }
        let headings = q.sections.then(|| sections::outline(&content));
        let mut in_note = 0usize;
        for (i, line) in content.lines().enumerate() {
            if out.len() >= q.limit || q.per_note.is_some_and(|cap| in_note >= cap) {
                break;
            }
            let Some(at) = line.to_lowercase().find(&needle) else {
                continue;
            };
            let line_no = i as u32 + 1;
            in_note += 1;
            out.push(SearchHit {
                note: note.clone(),
                line: line_no,
                text: excerpt(line, at),
                section: headings
                    .as_ref()
                    .map(|h| sections::heading_at(h, line_no).to_string()),
            });
        }
    }
    Ok(out)
}

/// Notes whose *id* contains `pattern`, case-insensitively. No file is opened,
/// so this is the cheap half of finding things: name it and go.
///
/// Ordered by how well the name answers: the file name itself beating a match
/// that only landed in a folder along the way, and an exact stem beating a
/// partial one. Ties fall back to most recently modified, which is the order
/// the listing already uses.
pub fn find_notes(
    roots: &Roots,
    s: &Settings,
    pattern: &str,
    limit: usize,
    visible: Visible,
) -> Result<Vec<FileInfo>, String> {
    let needle = pattern.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(Vec::new());
    }
    let mut scored: Vec<(u8, FileInfo)> = super::walk::list_notes(roots, s, true)?
        .into_iter()
        .filter_map(|f| {
            // Same rule as `search`: dropped before the ranking, because the
            // cap is a `take` at the end and a hidden note would eat a slot.
            if visible.is_some_and(|allow| !allow(&f.name)) {
                return None;
            }
            let id = f.name.to_lowercase();
            if !id.contains(&needle) {
                return None;
            }
            let file = id.rsplit('/').next().unwrap_or(&id).to_string();
            let stem = file.rsplit_once('.').map(|(s, _)| s).unwrap_or(&file);
            // Lower sorts first.
            let rank = if stem == needle {
                0
            } else if file.contains(&needle) {
                1
            } else {
                2
            };
            Some((rank, f))
        })
        .collect();
    scored.sort_by(|a, b| {
        a.0.cmp(&b.0)
            .then(b.1.modified_ms.cmp(&a.1.modified_ms))
            .then(a.1.name.cmp(&b.1.name))
    });
    Ok(scored.into_iter().take(limit).map(|(_, f)| f).collect())
}

/// Trim a long line down to a window around `at` (a byte offset into `line`),
/// always cutting on a char boundary.
fn excerpt(line: &str, at: usize) -> String {
    let line = line.trim_end();
    if line.chars().count() <= MAX_HIT_CHARS {
        return line.to_string();
    }
    // `at` was found in a lowercased copy of the line, and case folding can
    // change a character's byte length, so the offset may not land on a
    // boundary of the original — walk back to one rather than panic.
    let mut at = at.min(line.len());
    while at > 0 && !line.is_char_boundary(at) {
        at -= 1;
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
