//! Writing into notes, one section at a time.
//!
//! There is deliberately **no whole-file write**. Section-addressed writes plus
//! append cover what an agent actually needs, and a replace-the-file call is
//! the one shape that can silently destroy work the agent never read. If it
//! ever turns out to be needed, `expect_unchanged` becomes a *required*
//! argument on it, not an optional one.
//!
//! `expect_unchanged` is how a targeted write survives a concurrent human edit:
//! the caller passes back the mtime it got from its read, and a file that has
//! moved on refuses the write instead of clobbering it. It is opt-in, so a
//! fire-and-forget append stays one call.

use super::grants::{self, State};
use super::ids;
use super::sections::{self, Section};
use super::{mtime_ms, Roots};
use crate::settings::Settings;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    pub note: String,
    /// Heading path that was written, `""` for the preamble or a whole-note
    /// append.
    pub section: String,
    /// Whether the file did not exist before this call.
    pub created: bool,
    /// What was there before — so a caller can see what it replaced, and undo
    /// it by writing this back.
    pub replaced: String,
    /// The note's mtime after the write: the value to pass as the next
    /// `expect_unchanged`.
    pub mtime_ms: u64,
}

/// Refused because the file moved since the caller read it. Carries the current
/// mtime so the retry needs one call, not two.
pub fn stale(note: &str, expected: u64, actual: Option<u64>) -> String {
    match actual {
        Some(now) => format!(
            "{note} changed since you read it (you expected mtime {expected}, it is {now}) — \
             re-read it and try again"
        ),
        None => format!("{note} no longer exists (you expected mtime {expected})"),
    }
}

/// Resolve a note id for writing: shape, then grant, then scope pin.
///
/// Shape first, because that check is purely syntactic — it leaks nothing about
/// which projects exist, and answering `"../escape.md"` with "that project is
/// read-only" would be both confusing and beside the point. Everything after it
/// goes through [`grants::check_write`], which keeps the order that matters: an
/// `off` project answers "no such note" before it will admit the id was even
/// well-formed.
fn writable_path(
    roots: &Roots,
    s: &Settings,
    state: &State,
    note: &str,
) -> Result<PathBuf, String> {
    let name = ids::checked_name(roots, s, note)?;
    grants::check_write(s, state, name).map_err(|d| d.to_string())?;
    let (base, rest) = ids::base_of(roots, s, name);
    Ok(base.join(rest))
}

fn check_expected(note: &str, path: &std::path::Path, expect: Option<u64>) -> Result<(), String> {
    let Some(expected) = expect else {
        return Ok(());
    };
    let actual = mtime_ms(path);
    if actual == Some(expected) {
        Ok(())
    } else {
        Err(stale(note, expected, actual))
    }
}

/// A section body, spaced the way the rest of these files are: a blank line
/// under the heading, one trailing newline, and a blank line before whatever
/// follows — so a write can't glue a heading to the paragraph above it, and an
/// agent that forgets the surrounding newlines still produces a clean file.
///
/// The preamble takes no leading blank line, having no heading to sit under.
fn body_for(content: &str, followed: bool, under_heading: bool) -> String {
    let trimmed = content.trim_matches(['\n', '\r']);
    if trimmed.is_empty() {
        return if under_heading {
            "\n".into()
        } else {
            String::new()
        };
    }
    let mut out = String::new();
    if under_heading {
        out.push('\n');
    }
    out.push_str(trimmed);
    out.push('\n');
    if followed {
        out.push('\n');
    }
    out
}

/// Replace one section's body. The heading line itself is **kept** — a caller
/// addressing "Decisions" means the text under that heading, and having to
/// re-send the heading in every write is the shape that eventually deletes one.
/// The extent still runs through the section's subsections, so replacing a
/// level-2 section replaces the level-3s inside it.
pub fn write_section(
    roots: &Roots,
    s: &Settings,
    state: &State,
    note: &str,
    section: &str,
    content: &str,
    expect_unchanged: Option<u64>,
) -> Result<WriteResult, String> {
    let path = writable_path(roots, s, state, note)?;
    check_expected(note, &path, expect_unchanged)?;
    let doc = fs::read_to_string(&path).map_err(|_| format!("no such note: {note}"))?;
    let found: Section = sections::resolve(&doc, section).map_err(|e| e.to_string())?;
    let replaced = found.body_text(&doc).to_string();
    let followed = found.end < doc.len();
    let mut next = String::with_capacity(doc.len() + content.len());
    next.push_str(&doc[..found.body]);
    next.push_str(&body_for(content, followed, !found.path.is_empty()));
    next.push_str(&doc[found.end..]);
    fs::write(&path, &next).map_err(|e| e.to_string())?;
    Ok(WriteResult {
        note: note.to_string(),
        section: found.path,
        created: false,
        replaced,
        mtime_ms: mtime_ms(&path).unwrap_or(0),
    })
}

/// Write a new note. Refused when the id is taken, so creating can never
/// overwrite; `append` is the call that adds to a note that exists.
pub fn create(
    roots: &Roots,
    s: &Settings,
    state: &State,
    note: &str,
    content: &str,
) -> Result<WriteResult, String> {
    let path = writable_path(roots, s, state, note)?;
    if path.exists() {
        return Err(format!("{note} already exists"));
    }
    let body = content.trim_end_matches(['\n', '\r']);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(
        &path,
        if body.is_empty() {
            String::new()
        } else {
            format!("{body}\n")
        },
    )
    .map_err(|e| e.to_string())?;
    Ok(WriteResult {
        note: note.to_string(),
        section: String::new(),
        created: true,
        replaced: String::new(),
        mtime_ms: mtime_ms(&path).unwrap_or(0),
    })
}

/// Move a note to another id, with both ends write-checked. History moves
/// with it, as it does for a move in the app; links to it are not rewritten,
/// the same as there. Refused while the app holds unsaved edits for the note,
/// because the app would later save them back to the old id.
pub fn move_note(
    roots: &Roots,
    s: &Settings,
    state: &State,
    from: &str,
    to: &str,
) -> Result<(), String> {
    let from_path = writable_path(roots, s, state, from)?;
    let to_path = writable_path(roots, s, state, to)?;
    if !from_path.is_file() {
        return Err(format!("no such note: {from}"));
    }
    if to_path.exists() {
        return Err(format!("{to} already exists"));
    }
    if roots.data.join("drafts").join(from).exists() {
        return Err(format!(
            "{from} has unsaved edits open in asapnotes; save it there first"
        ));
    }
    if let Some(parent) = to_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // `rename` fails across volumes, which linked folders and mounts make an
    // ordinary case.
    if fs::rename(&from_path, &to_path).is_err() {
        fs::copy(&from_path, &to_path).map_err(|e| e.to_string())?;
        fs::remove_file(&from_path).map_err(|e| e.to_string())?;
    }
    let history = roots.data.join("history");
    if history.join(from).is_dir() {
        let target = history.join(to);
        if let Some(parent) = target.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::rename(history.join(from), target);
    }
    Ok(())
}

/// Add to the end of a note, or to the end of one of its sections.
///
/// **Creation rides here**: an id whose file does not exist yet is created, so
/// adding a note is one call rather than two. It still has to be an id this
/// corpus admits — inside a `write`-granted project, and a path the project's
/// `files` rules would list — so an agent cannot use it to drop a file
/// anywhere on disk.
pub fn append(
    roots: &Roots,
    s: &Settings,
    state: &State,
    note: &str,
    content: &str,
    section: Option<&str>,
    expect_unchanged: Option<u64>,
) -> Result<WriteResult, String> {
    let path = writable_path(roots, s, state, note)?;
    check_expected(note, &path, expect_unchanged)?;
    let existing = fs::read_to_string(&path).ok();
    let created = existing.is_none();
    let doc = existing.unwrap_or_default();
    let addition = content.trim_end_matches(['\n', '\r']);

    let (at, section_path) = match section.map(str::trim).filter(|p| !p.is_empty()) {
        Some(path) => {
            let found = sections::resolve(&doc, path).map_err(|e| e.to_string())?;
            (found.end, found.path)
        }
        None => (doc.len(), String::new()),
    };
    // Land on a fresh line, with a blank one between this and whatever was
    // already there — appended notes are separate thoughts, not a continuation
    // of somebody's last sentence.
    let before = &doc[..at];
    let mut lead = String::new();
    if !before.is_empty() {
        if !before.ends_with('\n') {
            lead.push('\n');
        }
        if !before.ends_with("\n\n") {
            lead.push('\n');
        }
    }
    let followed = at < doc.len();
    let mut next = String::with_capacity(doc.len() + addition.len() + 4);
    next.push_str(before);
    next.push_str(&lead);
    next.push_str(addition);
    next.push('\n');
    if followed {
        next.push('\n');
    }
    next.push_str(&doc[at..]);

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, &next).map_err(|e| e.to_string())?;
    Ok(WriteResult {
        note: note.to_string(),
        section: section_path,
        created,
        replaced: String::new(),
        mtime_ms: mtime_ms(&path).unwrap_or(0),
    })
}
