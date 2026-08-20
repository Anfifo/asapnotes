//! Section addressing: naming a piece of a note by its heading path.
//!
//! This is the token economy of the MCP surface. A listing carries heading
//! trees rather than content, a read takes a section rather than a whole file,
//! and a write replaces one section's body — so an agent that wants two
//! paragraphs out of a long note never has to carry the note.
//!
//! A section is named by its heading text, or by a `/`-joined tail of its
//! ancestor path when the text alone is ambiguous:
//!
//! ```text
//! "Decisions"              the only heading with that text
//! "Design/Decisions"       the "Decisions" under "Design"
//! ""                       the preamble, before any heading
//! ```
//!
//! Matching is case-insensitive and exact per segment. Nothing matched, or more
//! than one matched, is an **error that lists the candidates** — never a guess,
//! because a guess writes to the wrong part of somebody's file.
//!
//! Two deliberate limits, both so the rule stays predictable: headings are ATX
//! only (`# text`), since the setext form is a *trailing* underline and would
//! make a heading's identity depend on the line after it; and a `#` inside a
//! fenced code block is not a heading, or a note *about* markdown would address
//! itself wrongly.

use std::fmt;

/// Heading paths listed back on a miss. Long enough to be useful on a real
/// note, short enough that a wrong guess can't cost a whole context window.
const MAX_CANDIDATES: usize = 40;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Heading {
    /// 1..=6.
    pub depth: u32,
    /// The heading's own text, markers and closing `#`s stripped.
    pub text: String,
    /// Ancestors and own text, `/`-joined. The name a caller addresses.
    pub path: String,
    /// 1-based line of the heading itself.
    pub line: u32,
    /// Byte offset of the start of the heading line.
    pub start: usize,
    /// Byte offset just past the heading line — where its body begins.
    pub body: usize,
    /// Byte offset just past the section, which runs to the next heading of the
    /// same or shallower depth. A section therefore contains its subsections,
    /// and replacing one replaces them.
    pub end: usize,
}

/// One addressed extent of a note. The preamble is a section too, with an empty
/// path and no heading line of its own.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Section {
    pub path: String,
    pub depth: u32,
    pub line: u32,
    /// Heading line start; equals `body` for the preamble.
    pub start: usize,
    pub body: usize,
    pub end: usize,
}

impl Section {
    /// The section including its own heading line.
    pub fn text<'a>(&self, doc: &'a str) -> &'a str {
        &doc[self.start..self.end]
    }

    /// Everything under the heading, not counting the heading line.
    pub fn body_text<'a>(&self, doc: &'a str) -> &'a str {
        &doc[self.body..self.end]
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SectionError {
    NotFound {
        query: String,
        candidates: Vec<String>,
    },
    Ambiguous {
        query: String,
        candidates: Vec<String>,
    },
}

impl fmt::Display for SectionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // The candidates are the useful half of both messages: an agent that
        // guessed wrong can fix the call from the error alone.
        match self {
            SectionError::NotFound { query, candidates } => {
                write!(
                    f,
                    "no section \"{query}\"; this note has: {}",
                    list(candidates)
                )
            }
            SectionError::Ambiguous { query, candidates } => write!(
                f,
                "\"{query}\" matches more than one section — name one of: {}",
                list(candidates)
            ),
        }
    }
}

impl SectionError {
    pub fn candidates(&self) -> &[String] {
        match self {
            SectionError::NotFound { candidates, .. } => candidates,
            SectionError::Ambiguous { candidates, .. } => candidates,
        }
    }
}

fn list(candidates: &[String]) -> String {
    if candidates.is_empty() {
        return "no headings at all".into();
    }
    let shown: Vec<String> = candidates
        .iter()
        .take(MAX_CANDIDATES)
        .map(|c| format!("\"{c}\""))
        .collect();
    let mut out = shown.join(", ");
    if candidates.len() > MAX_CANDIDATES {
        out.push_str(&format!(" (+{} more)", candidates.len() - MAX_CANDIDATES));
    }
    out
}

/// A fence opener's marker char and run length, if this line is one.
fn fence(line: &str) -> Option<(char, usize)> {
    let trimmed = line.trim_start();
    // More than three leading spaces makes it an indented code block, not a
    // fence — and either way it is not a heading.
    if line.len() - trimmed.len() > 3 {
        return None;
    }
    let marker = trimmed.chars().next()?;
    if marker != '`' && marker != '~' {
        return None;
    }
    let run = trimmed.chars().take_while(|c| *c == marker).count();
    (run >= 3).then_some((marker, run))
}

/// Heading depth and text, if this line is an ATX heading.
fn atx(line: &str) -> Option<(u32, String)> {
    let trimmed = line.trim_start();
    if line.len() - trimmed.len() > 3 {
        return None;
    }
    let depth = trimmed.chars().take_while(|c| *c == '#').count();
    if !(1..=6).contains(&depth) {
        return None;
    }
    let rest = &trimmed[depth..];
    // `#hashtag` is not a heading: the marker run has to be followed by space
    // or end the line.
    if !rest.is_empty() && !rest.starts_with(' ') && !rest.starts_with('\t') {
        return None;
    }
    // A closing run of `#`s is decoration, not part of the text.
    let text = rest.trim().trim_end_matches('#').trim().to_string();
    Some((depth as u32, text))
}

/// Every heading in the note, in document order, each with the extent it owns.
pub fn outline(doc: &str) -> Vec<Heading> {
    let mut out: Vec<Heading> = Vec::new();
    // (depth, text) of the ancestors currently open.
    let mut stack: Vec<(u32, String)> = Vec::new();
    let mut open_fence: Option<(char, usize)> = None;
    let mut offset = 0usize;

    for (i, line) in doc.split_inclusive('\n').enumerate() {
        let bare = line.strip_suffix('\n').unwrap_or(line);
        let bare = bare.strip_suffix('\r').unwrap_or(bare);
        let next = offset + line.len();

        if let Some((marker, run)) = open_fence {
            // Only a run of the same marker, at least as long, closes a fence.
            if let Some((m, r)) = fence(bare) {
                if m == marker && r >= run && bare.trim().chars().all(|c| c == marker) {
                    open_fence = None;
                }
            }
            offset = next;
            continue;
        }
        if let Some(f) = fence(bare) {
            open_fence = Some(f);
            offset = next;
            continue;
        }

        if let Some((depth, text)) = atx(bare) {
            // Every still-open section of this depth or deeper ends where this
            // heading starts.
            close_open(&mut out, depth, offset);
            while stack.last().map(|(d, _)| *d >= depth).unwrap_or(false) {
                stack.pop();
            }
            let path = stack
                .iter()
                .map(|(_, t)| t.as_str())
                .chain(std::iter::once(text.as_str()))
                .collect::<Vec<_>>()
                .join("/");
            stack.push((depth, text.clone()));
            out.push(Heading {
                depth,
                text,
                path,
                line: i as u32 + 1,
                start: offset,
                body: next,
                end: usize::MAX,
            });
        }
        offset = next;
    }
    for h in out.iter_mut().filter(|h| h.end == usize::MAX) {
        h.end = doc.len();
    }
    out
}

/// Close still-open sections that a heading of `depth` ends. `usize::MAX` is
/// the "not closed yet" marker the walk above leaves behind.
fn close_open(out: &mut [Heading], depth: u32, at: usize) {
    for h in out.iter_mut() {
        if h.end == usize::MAX && h.depth >= depth {
            h.end = at;
        }
    }
}

/// Whether a heading's full path answers to `query`: the whole path, or a tail
/// of it cut at a `/` boundary. Case-insensitive, exact otherwise — a prefix
/// match would make `"Design"` silently address `"Design notes"`.
fn matches(path: &str, query: &str) -> bool {
    if path.eq_ignore_ascii_case(query) {
        return true;
    }
    path.len() > query.len()
        && path[path.len() - query.len()..].eq_ignore_ascii_case(query)
        && path.as_bytes()[path.len() - query.len() - 1] == b'/'
}

/// The preamble: everything before the first heading. Always addressable, even
/// when it is empty, because that is where a note with no headings keeps its
/// whole content.
pub fn preamble(doc: &str, headings: &[Heading]) -> Section {
    let end = headings.first().map(|h| h.start).unwrap_or(doc.len());
    Section {
        path: String::new(),
        depth: 0,
        line: 1,
        start: 0,
        body: 0,
        end,
    }
}

/// Resolve a heading path against a note. `""` is the preamble.
pub fn resolve(doc: &str, query: &str) -> Result<Section, SectionError> {
    let headings = outline(doc);
    resolve_in(doc, &headings, query)
}

/// Resolve against an outline already computed — the listing has one in hand.
pub fn resolve_in(doc: &str, headings: &[Heading], query: &str) -> Result<Section, SectionError> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(preamble(doc, headings));
    }
    let hits: Vec<&Heading> = headings
        .iter()
        .filter(|h| matches(&h.path, query))
        .collect();
    let all = || headings.iter().map(|h| h.path.clone()).collect::<Vec<_>>();
    match hits.len() {
        0 => Err(SectionError::NotFound {
            query: query.to_string(),
            candidates: all(),
        }),
        1 => {
            let h = hits[0];
            Ok(Section {
                path: h.path.clone(),
                depth: h.depth,
                line: h.line,
                start: h.start,
                body: h.body,
                end: h.end,
            })
        }
        _ => Err(SectionError::Ambiguous {
            query: query.to_string(),
            candidates: hits.iter().map(|h| h.path.clone()).collect(),
        }),
    }
}

/// The heading path a 1-based line falls under — the innermost section
/// containing it, or `""` for a line in the preamble. This is what makes a
/// search hit say *where* it is without the caller reading the note.
pub fn heading_at(headings: &[Heading], line: u32) -> &str {
    headings
        .iter()
        .rev()
        .find(|h| h.line <= line)
        .map(|h| h.path.as_str())
        .unwrap_or("")
}
