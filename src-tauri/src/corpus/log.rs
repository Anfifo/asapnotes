//! The sidecar's own record of what it changed.
//!
//! The snapshot store tags a change `app` or `external`, and a helper binary
//! writing a file directly is correctly an *external* edit. That is true but
//! thin: it says the app didn't do it, not who did or what they meant. This log
//! carries what an origin tag never could — which tool, which note, which
//! section — so the changes view can later badge an external edit as coming
//! from here by matching note and time.
//!
//! **Writes only.** A log of every read would be a surveillance record of the
//! user's own corpus, and it answers no question the user asked.

use super::{now_ms, Roots};
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;

pub const LOG_FILE: &str = "mcp-calls.jsonl";

/// Soft cap. The log is append-only in spirit, but a file that grows without
/// bound on a machine the user never looks at is a footprint problem, and this
/// is a resident tray app whose one promise is being quiet. Past the cap the
/// oldest half goes.
const MAX_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub at_ms: u64,
    /// Wire name of the tool that ran.
    pub tool: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub section: Option<String>,
    /// One line a human can read in the changes view.
    pub summary: String,
}

impl Entry {
    pub fn new(tool: &str, summary: impl Into<String>) -> Self {
        Self {
            at_ms: now_ms(),
            tool: tool.to_string(),
            note: None,
            section: None,
            summary: summary.into(),
        }
    }

    pub fn on(mut self, note: &str, section: &str) -> Self {
        self.note = Some(note.to_string());
        self.section = (!section.is_empty()).then(|| section.to_string());
        self
    }
}

/// Append one line. Best-effort by design: a log that can't be written must
/// never be the reason a write the user asked for fails.
pub fn record(roots: &Roots, entry: &Entry) {
    let _ = try_record(roots, entry);
}

fn try_record(roots: &Roots, entry: &Entry) -> Result<(), String> {
    let path = roots.data.join(LOG_FILE);
    fs::create_dir_all(&roots.data).map_err(|e| e.to_string())?;
    if fs::metadata(&path).map(|m| m.len()).unwrap_or(0) > MAX_BYTES {
        trim(roots)?;
    }
    let line = serde_json::to_string(entry).map_err(|e| e.to_string())?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    writeln!(file, "{line}").map_err(|e| e.to_string())
}

fn trim(roots: &Roots) -> Result<(), String> {
    let path = roots.data.join(LOG_FILE);
    let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let lines: Vec<&str> = data.lines().collect();
    let keep = lines.split_at(lines.len() / 2).1.join("\n");
    fs::write(&path, format!("{keep}\n")).map_err(|e| e.to_string())
}

/// The most recent entries, newest first. A malformed line is skipped rather
/// than failing the read — this file is appended to by a process that may be
/// killed mid-write, so a torn last line is expected, not exceptional.
pub fn tail(roots: &Roots, limit: usize) -> Vec<Entry> {
    let Ok(data) = fs::read_to_string(roots.data.join(LOG_FILE)) else {
        return Vec::new();
    };
    let mut out: Vec<Entry> = data
        .lines()
        .rev()
        .filter_map(|line| serde_json::from_str(line).ok())
        .take(limit)
        .collect();
    out.sort_by_key(|e| std::cmp::Reverse(e.at_ms));
    out
}
