//! The corpus core: which files are notes, where they live, what is in them —
//! with no Tauri in it.
//!
//! Two callers reach the same code. The app comes through [`crate::notes`],
//! which passes the two roots `AppHandle` hands it; the MCP helper binary
//! (`src/bin/asapnotes_mcp.rs`) resolves the same two directories itself. That
//! split is the whole reason this layer exists: the project model — the notes
//! root, per-project locations, mounts, and the `files` pattern rules — decides
//! what a caller may *see*, so a second implementation of it would be an
//! access-boundary bug rather than a display bug. One implementation, two
//! callers.
//!
//! A `tauri::` import anywhere under this module is a bug, and
//! [`tests::no_tauri_in_the_core`] fails the build if one appears.

pub mod control;
pub mod edits;
pub mod grants;
pub mod ids;
pub mod log;
pub mod search;
pub mod sections;
pub mod store;
pub mod tools;
pub mod walk;

#[cfg(test)]
pub mod testing;
#[cfg(test)]
mod tests;

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// The two directories every corpus question resolves against.
///
/// The hazard these exist to make visible: if the helper resolves a different
/// pair than the app, it serves a different corpus and *nothing looks wrong*.
/// `doctor` on the helper prints them for exactly that reason.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Roots {
    /// `Documents/asapnotes` — note files, and the projects that live in it.
    pub notes: PathBuf,
    /// App data — `settings.json`, drafts, history, the MCP call log.
    pub data: PathBuf,
}

impl Roots {
    pub fn new(notes: impl Into<PathBuf>, data: impl Into<PathBuf>) -> Self {
        Self {
            notes: notes.into(),
            data: data.into(),
        }
    }

    /// Create both directories. The app has always done this on first touch of
    /// the notes root; a helper doing a read-only call gets the same, because a
    /// missing notes root and an empty one are the same corpus.
    pub fn ensure(&self) -> Result<(), String> {
        fs::create_dir_all(&self.notes).map_err(|e| e.to_string())?;
        fs::create_dir_all(&self.data).map_err(|e| e.to_string())
    }

    /// `settings.json` — the personal file both callers must agree on.
    pub fn settings_file(&self) -> PathBuf {
        self.data.join("settings.json")
    }
}

/// Milliseconds since the epoch for a path, `None` if it doesn't exist.
pub fn mtime_ms(path: &Path) -> Option<u64> {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
