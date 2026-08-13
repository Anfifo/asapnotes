//! Snapshot store behind the recent-changes view: `history/` in app data,
//! mirroring note ids the way `drafts/` does.
//!
//! Full copies, never diffs — diffs are computed on demand, so the store stays
//! dumb and any snapshot can be pruned without re-basing the ones after it.
//! Only markdown notes are captured; the other registry types are data files
//! whose churn is not what the view is for.
//!
//! Capture rides signals the app already has — a save, the window regaining
//! focus — so the store costs nothing at idle: no watcher, no timer. Every
//! snapshot carries an origin: `app` is the user's own save, recorded silently
//! because a diff needs the last app-known state as its "before"; `external`
//! is content the focus scan found changed on disk, which is what the view
//! shows. The invariant everything here stands on: once a note has been seen,
//! the store holds its last-known content — that is what makes the scan an
//! mtime compare instead of a corpus read, and what gives every external
//! snapshot a predecessor to diff against.

use crate::settings::{self, Settings};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

/// Retention. One prune pass enforces all three, amortized to the first focus
/// of the day; a note's latest snapshot is never pruned, because "last-known
/// content" is the invariant the scan and the diffs stand on.
const KEEP_DAYS: u64 = 30;
const KEEP_PER_NOTE: usize = 25;
const MAX_STORE_BYTES: u64 = 50 * 1024 * 1024;

const DAY_MS: u64 = 24 * 60 * 60 * 1000;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Origin {
    App,
    External,
}

impl Origin {
    fn as_str(self) -> &'static str {
        match self {
            Origin::App => "app",
            Origin::External => "external",
        }
    }

    fn parse(s: &str) -> Option<Self> {
        match s {
            "app" => Some(Origin::App),
            "external" => Some(Origin::External),
            _ => None,
        }
    }
}

/// Whether history tracks this note id: registry types with the markdown view
/// only. Everything else (json/yaml/csv/…) is never snapshotted.
pub fn tracked(s: &Settings, note: &str) -> bool {
    let file = note.rsplit('/').next().unwrap_or(note);
    s.type_for(file).is_some_and(|t| t.view == "markdown")
}

pub fn store_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("history");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

struct Snapshot {
    ts: u64,
    origin: Origin,
    path: PathBuf,
}

/// `<timestamp>-<origin>.md`, zero-padded so name order is time order.
fn snapshot_name(ts: u64, origin: Origin) -> String {
    format!("{ts:013}-{}.md", origin.as_str())
}

fn parse_snapshot(name: &str) -> Option<(u64, Origin)> {
    let stem = name.strip_suffix(".md")?;
    let (ts, origin) = stem.split_once('-')?;
    Some((ts.parse().ok()?, Origin::parse(origin)?))
}

/// A note's snapshots, oldest first. A missing dir is an empty history.
fn snapshots(dir: &Path) -> Vec<Snapshot> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out: Vec<Snapshot> = entries
        .flatten()
        .filter_map(|e| {
            let (ts, origin) = parse_snapshot(&e.file_name().to_string_lossy())?;
            Some(Snapshot {
                ts,
                origin,
                path: e.path(),
            })
        })
        .collect();
    out.sort_by_key(|s| s.ts);
    out
}

pub fn has_any(store: &Path, note: &str) -> bool {
    !snapshots(&store.join(note)).is_empty()
}

/// Append a snapshot unless it would duplicate the latest one — a touched but
/// identical file is common, and a no-op snapshot would burn retention budget
/// on nothing. Timestamps only ever move forward: a colliding `ts` is bumped
/// past the latest, so name order stays time order. Returns whether anything
/// was written.
pub fn record(
    store: &Path,
    note: &str,
    content: &str,
    origin: Origin,
    ts: u64,
) -> Result<bool, String> {
    let dir = store.join(note);
    let mut ts = ts;
    if let Some(last) = snapshots(&dir).last() {
        if fs::read_to_string(&last.path).ok().as_deref() == Some(content) {
            return Ok(false);
        }
        ts = ts.max(last.ts + 1);
    }
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::write(dir.join(snapshot_name(ts, origin)), content).map_err(|e| e.to_string())?;
    Ok(true)
}

fn ms(t: SystemTime) -> u64 {
    t.duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}

fn now_ms() -> u64 {
    ms(SystemTime::now())
}

/// Catch up with the disk: walk the note corpus, snapshot what changed behind
/// the app's back. Called from the window-focus handler — the same signal that
/// re-reads settings — so an agent editing notes while the app is unfocused is
/// seen the moment the user comes back. First sight of a note stores a silent
/// baseline (the one-time corpus copy); after that, an mtime newer than the
/// latest snapshot is the only reason to read a file. Returns how many
/// external snapshots were recorded, so the caller knows whether to refresh.
#[tauri::command]
pub fn scan_changes(app: AppHandle) -> Result<usize, String> {
    let s = settings::settings(&app)?;
    let store = store_dir(&app)?;
    let mut recorded = 0;
    for (note, path) in crate::notes::note_paths(&app)? {
        if !tracked(&s, &note) {
            continue;
        }
        let Ok(meta) = fs::metadata(&path) else {
            continue;
        };
        // Same cap as search: past this it isn't prose.
        if meta.len() > crate::notes::MAX_SEARCH_BYTES {
            continue;
        }
        match snapshots(&store.join(&note)).last() {
            None => {
                // Unreadable file: skip, same tolerance as the listing walk.
                let Ok(content) = fs::read_to_string(&path) else {
                    continue;
                };
                let _ = record(&store, &note, &content, Origin::App, now_ms());
            }
            Some(last) => {
                if meta.modified().map(ms).unwrap_or(0) <= last.ts {
                    continue;
                }
                let Ok(content) = fs::read_to_string(&path) else {
                    continue;
                };
                if record(&store, &note, &content, Origin::External, now_ms()).unwrap_or(false) {
                    recorded += 1;
                }
            }
        }
    }
    maybe_prune(&store, now_ms());
    Ok(recorded)
}

/// Note dirs are the directories that directly hold snapshot files; ids can be
/// nested (`project/docs/x.md`), so the walk recurses.
fn collect_note_dirs(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut holds_snapshots = false;
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            collect_note_dirs(&entry.path(), out);
        } else if parse_snapshot(&entry.file_name().to_string_lossy()).is_some() {
            holds_snapshots = true;
        }
    }
    if holds_snapshots {
        out.push(dir.to_path_buf());
    }
}

/// Prune once per calendar day, on whichever scan comes first — retention
/// doesn't need a timer's precision, only that the store can't grow unbounded.
fn maybe_prune(store: &Path, now: u64) {
    let marker = store.join(".pruned");
    let today = (now / DAY_MS).to_string();
    if fs::read_to_string(&marker)
        .map(|d| d.trim() == today)
        .unwrap_or(false)
    {
        return;
    }
    let _ = fs::write(&marker, &today);
    prune(store, now, MAX_STORE_BYTES);
}

/// Age and per-note count first, then the total budget as the backstop —
/// oldest across all notes, so one hammered note can't starve the rest.
/// Failures are skipped, never fatal: pruning is housekeeping.
fn prune(store: &Path, now: u64, max_bytes: u64) {
    let mut dirs = Vec::new();
    collect_note_dirs(store, &mut dirs);
    let cutoff = now.saturating_sub(KEEP_DAYS * DAY_MS);
    // (ts, size, path) of what survives, latest snapshots excluded — they are
    // never candidates, but their size still counts against the budget.
    let mut prunable: Vec<(u64, u64, PathBuf)> = Vec::new();
    let mut total: u64 = 0;
    for dir in dirs {
        let snaps = snapshots(&dir);
        let n = snaps.len();
        for (i, snap) in snaps.iter().enumerate() {
            let latest = i + 1 == n;
            if !latest && (snap.ts < cutoff || n - i > KEEP_PER_NOTE) {
                let _ = fs::remove_file(&snap.path);
                continue;
            }
            let size = fs::metadata(&snap.path).map(|m| m.len()).unwrap_or(0);
            total += size;
            if !latest {
                prunable.push((snap.ts, size, snap.path.clone()));
            }
        }
    }
    if total <= max_bytes {
        return;
    }
    prunable.sort_by_key(|p| p.0);
    for (_, size, path) in prunable {
        if total <= max_bytes {
            break;
        }
        if fs::remove_file(&path).is_ok() {
            total -= size;
        }
    }
}

// --- Diffs, computed on demand ---

fn count_diff(old: &str, new: &str) -> (u32, u32) {
    let diff = similar::TextDiff::from_lines(old, new);
    let mut added = 0;
    let mut removed = 0;
    for change in diff.iter_all_changes() {
        match change.tag() {
            similar::ChangeTag::Insert => added += 1,
            similar::ChangeTag::Delete => removed += 1,
            similar::ChangeTag::Equal => {}
        }
    }
    (added, removed)
}

/// One diff line. `line` is the 1-based position in the note as of that
/// snapshot — what the view's jump-to-line uses — so it is best-effort against
/// a file that may have moved on since. Deleted lines have no position there.
#[derive(Serialize)]
pub struct DiffLine {
    pub kind: &'static str,
    pub text: String,
    pub line: Option<u32>,
}

#[derive(Serialize)]
pub struct Hunk {
    pub lines: Vec<DiffLine>,
}

/// Hunks with a little context, the unit the view renders. Consecutive
/// deleted lines travel individually; collapsing them into a pill is the
/// view's presentation choice, not the data's.
fn hunks(old: &str, new: &str) -> Vec<Hunk> {
    let diff = similar::TextDiff::from_lines(old, new);
    diff.grouped_ops(2)
        .iter()
        .map(|group| {
            let mut lines = Vec::new();
            for op in group {
                for change in diff.iter_changes(op) {
                    let kind = match change.tag() {
                        similar::ChangeTag::Equal => "ctx",
                        similar::ChangeTag::Insert => "add",
                        similar::ChangeTag::Delete => "del",
                    };
                    lines.push(DiffLine {
                        kind,
                        text: change.value().trim_end_matches(['\n', '\r']).to_string(),
                        line: change.new_index().map(|i| i as u32 + 1),
                    });
                }
            }
            Hunk { lines }
        })
        .collect()
}

/// One external edit as the ledger sees it: which note, when, how much.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeSummary {
    pub note: String,
    pub at_ms: u64,
    pub added: u32,
    pub removed: u32,
}

/// One external edit with its hunks; `Vec<Change>` under a note is that
/// note's edits in time order, which is how the drill-in stacks them.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub at_ms: u64,
    pub added: u32,
    pub removed: u32,
    pub hunks: Vec<Hunk>,
}

#[derive(Serialize)]
pub struct NoteChanges {
    pub note: String,
    pub changes: Vec<Change>,
}

/// Every external snapshot in the window paired with its predecessor —
/// app-origin snapshots are the "before" of these pairs and never appear as
/// changes themselves. `map` turns one diffed pair into whatever the caller
/// collects, so the ledger and the drill-in share one walk.
fn external_pairs<T>(
    store: &Path,
    only: Option<&str>,
    since: u64,
    mut map: impl FnMut(&str, u64, &str, &str) -> T,
) -> Vec<(String, Vec<T>)> {
    let mut dirs = Vec::new();
    match only {
        Some(note) => {
            let dir = store.join(note);
            if dir.is_dir() {
                dirs.push(dir);
            }
        }
        None => collect_note_dirs(store, &mut dirs),
    }
    let mut out = Vec::new();
    for dir in dirs {
        let note = match only {
            Some(n) => n.to_string(),
            None => dir
                .strip_prefix(store)
                .unwrap_or(&dir)
                .to_string_lossy()
                .replace('\\', "/"),
        };
        let snaps = snapshots(&dir);
        let mut items = Vec::new();
        for i in 1..snaps.len() {
            let snap = &snaps[i];
            if snap.origin != Origin::External || snap.ts < since {
                continue;
            }
            let (Ok(old), Ok(new)) = (
                fs::read_to_string(&snaps[i - 1].path),
                fs::read_to_string(&snap.path),
            ) else {
                continue;
            };
            items.push(map(&note, snap.ts, &old, &new));
        }
        if !items.is_empty() {
            out.push((note, items));
        }
    }
    out
}

fn since_ms(days: Option<u32>) -> u64 {
    now_ms().saturating_sub(u64::from(days.unwrap_or(7)) * DAY_MS)
}

/// The ledger: every external edit in the window, newest first. Counts only —
/// text travels via `change_details` when a note is drilled into.
#[tauri::command]
pub fn recent_changes(app: AppHandle, days: Option<u32>) -> Result<Vec<ChangeSummary>, String> {
    let store = store_dir(&app)?;
    let mut out: Vec<ChangeSummary> =
        external_pairs(&store, None, since_ms(days), |note, ts, old, new| {
            let (added, removed) = count_diff(old, new);
            ChangeSummary {
                note: note.to_string(),
                at_ms: ts,
                added,
                removed,
            }
        })
        .into_iter()
        .flat_map(|(_, items)| items)
        .collect();
    out.sort_by_key(|c| std::cmp::Reverse(c.at_ms));
    Ok(out)
}

/// Hunks for the drill-in (`note` given) or the read-through stream (absent).
/// Notes come newest-change first; within a note, edits stay in time order.
#[tauri::command]
pub fn change_details(
    app: AppHandle,
    note: Option<String>,
    days: Option<u32>,
) -> Result<Vec<NoteChanges>, String> {
    if let Some(note) = &note {
        // The id names a directory under the store; hold it to the same shape
        // note ids have everywhere, so it can't reach outside.
        if !note.split('/').all(crate::notes::valid_segment) {
            return Err(format!("invalid note name: {note}"));
        }
    }
    let store = store_dir(&app)?;
    let mut out: Vec<NoteChanges> = external_pairs(
        &store,
        note.as_deref(),
        since_ms(days),
        |_, ts, old, new| {
            let (added, removed) = count_diff(old, new);
            Change {
                at_ms: ts,
                added,
                removed,
                hunks: hunks(old, new),
            }
        },
    )
    .into_iter()
    .map(|(note, changes)| NoteChanges { note, changes })
    .collect();
    out.sort_by_key(|n| std::cmp::Reverse(n.changes.last().map(|c| c.at_ms).unwrap_or(0)));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// A unique store dir per test, removed on drop.
    struct TempStore(PathBuf);

    impl TempStore {
        fn new() -> Self {
            static N: AtomicU32 = AtomicU32::new(0);
            let dir = std::env::temp_dir().join(format!(
                "asapnotes-history-test-{}-{}",
                std::process::id(),
                N.fetch_add(1, Ordering::Relaxed)
            ));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            TempStore(dir)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempStore {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn summaries(store: &Path, since: u64) -> Vec<(String, u64, u32, u32)> {
        external_pairs(store, None, since, |note, ts, old, new| {
            let (added, removed) = count_diff(old, new);
            (note.to_string(), ts, added, removed)
        })
        .into_iter()
        .flat_map(|(_, items)| items)
        .collect()
    }

    #[test]
    fn record_dedupes_identical_content() {
        let store = TempStore::new();
        assert!(record(store.path(), "a.md", "one", Origin::App, 100).unwrap());
        // Touched but identical: common, and must not burn retention budget.
        assert!(!record(store.path(), "a.md", "one", Origin::External, 200).unwrap());
        assert_eq!(snapshots(&store.path().join("a.md")).len(), 1);
    }

    #[test]
    fn timestamps_only_move_forward() {
        let store = TempStore::new();
        record(store.path(), "a.md", "one", Origin::App, 100).unwrap();
        // A colliding or earlier timestamp is bumped, so name order stays
        // time order and the "latest" snapshot stays unambiguous.
        record(store.path(), "a.md", "two", Origin::External, 100).unwrap();
        let snaps = snapshots(&store.path().join("a.md"));
        assert_eq!(snaps.len(), 2);
        assert_eq!(snaps[0].ts, 100);
        assert_eq!(snaps[1].ts, 101);
        assert_eq!(snaps[1].origin, Origin::External);
    }

    #[test]
    fn snapshot_names_round_trip() {
        assert_eq!(
            parse_snapshot(&snapshot_name(1723500000000, Origin::External)),
            Some((1723500000000, Origin::External))
        );
        assert_eq!(parse_snapshot("notes.md"), None);
        assert_eq!(
            parse_snapshot("0000000000100-app.md"),
            Some((100, Origin::App))
        );
    }

    #[test]
    fn only_external_snapshots_are_changes() {
        let store = TempStore::new();
        record(store.path(), "a.md", "baseline\n", Origin::App, 100).unwrap();
        record(
            store.path(),
            "a.md",
            "baseline\nsaved by me\n",
            Origin::App,
            200,
        )
        .unwrap();
        record(
            store.path(),
            "a.md",
            "baseline\nsaved by me\nagent line\n",
            Origin::External,
            300,
        )
        .unwrap();
        let out = summaries(store.path(), 0);
        // One change: the external edit, diffed against the user's own save —
        // the app snapshots are its "before", never changes themselves.
        assert_eq!(out.len(), 1);
        let (note, ts, added, removed) = &out[0];
        assert_eq!(note, "a.md");
        assert_eq!(*ts, 300);
        assert_eq!((*added, *removed), (1, 0));
    }

    #[test]
    fn window_filters_by_timestamp() {
        let store = TempStore::new();
        record(store.path(), "a.md", "one\n", Origin::App, 100).unwrap();
        record(store.path(), "a.md", "two\n", Origin::External, 200).unwrap();
        record(store.path(), "a.md", "three\n", Origin::External, 900).unwrap();
        assert_eq!(summaries(store.path(), 0).len(), 2);
        let recent = summaries(store.path(), 500);
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].1, 900);
    }

    #[test]
    fn nested_note_ids_are_found() {
        let store = TempStore::new();
        record(store.path(), "proj/docs/a.md", "one\n", Origin::App, 100).unwrap();
        record(
            store.path(),
            "proj/docs/a.md",
            "two\n",
            Origin::External,
            200,
        )
        .unwrap();
        let out = summaries(store.path(), 0);
        assert_eq!(out.len(), 1);
        // Ids come back with forward slashes whatever the OS separator is.
        assert_eq!(out[0].0, "proj/docs/a.md");
    }

    #[test]
    fn count_diff_counts_lines() {
        let (added, removed) = count_diff("a\nb\nc\n", "a\nx\ny\nc\n");
        assert_eq!((added, removed), (2, 1));
        assert_eq!(count_diff("same\n", "same\n"), (0, 0));
    }

    #[test]
    fn hunks_carry_new_side_line_numbers() {
        let old = "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n";
        let new = "1\n2\n3\nADDED\n4\n5\n6\n7\n8\n9\n";
        let hs = hunks(old, new);
        // One edit region → one hunk; far-apart edits would split.
        assert_eq!(hs.len(), 2);
        let added: Vec<_> = hs
            .iter()
            .flat_map(|h| &h.lines)
            .filter(|l| l.kind == "add")
            .collect();
        assert_eq!(added.len(), 1);
        assert_eq!(added[0].text, "ADDED");
        assert_eq!(added[0].line, Some(4));
        let deleted: Vec<_> = hs
            .iter()
            .flat_map(|h| &h.lines)
            .filter(|l| l.kind == "del")
            .collect();
        assert_eq!(deleted.len(), 1);
        assert_eq!(deleted[0].text, "10");
        assert_eq!(deleted[0].line, None);
    }

    #[test]
    fn prune_age_keeps_latest() {
        let store = TempStore::new();
        let now = 100 * KEEP_DAYS * DAY_MS;
        record(store.path(), "a.md", "one", Origin::App, 100).unwrap();
        record(store.path(), "a.md", "two", Origin::External, 200).unwrap();
        prune(store.path(), now, MAX_STORE_BYTES);
        let snaps = snapshots(&store.path().join("a.md"));
        // Both are ancient, but the latest survives: last-known content is
        // the invariant the scan's mtime compare stands on.
        assert_eq!(snaps.len(), 1);
        assert_eq!(snaps[0].ts, 200);
    }

    #[test]
    fn prune_caps_versions_per_note() {
        let store = TempStore::new();
        let now = 1000;
        for i in 0..KEEP_PER_NOTE as u64 + 10 {
            record(store.path(), "a.md", &format!("v{i}"), Origin::App, i).unwrap();
        }
        prune(store.path(), now, MAX_STORE_BYTES);
        let snaps = snapshots(&store.path().join("a.md"));
        assert_eq!(snaps.len(), KEEP_PER_NOTE);
        // Oldest went first.
        assert_eq!(snaps[0].ts, 10);
    }

    #[test]
    fn prune_budget_takes_oldest_across_notes_but_never_latest() {
        let store = TempStore::new();
        record(store.path(), "a.md", "aaaaaaaaaa", Origin::App, 100).unwrap();
        record(store.path(), "a.md", "bbbbbbbbbb", Origin::App, 200).unwrap();
        record(store.path(), "b.md", "cccccccccc", Origin::App, 150).unwrap();
        record(store.path(), "b.md", "dddddddddd", Origin::App, 250).unwrap();
        // Budget of one snapshot: everything prunable must go, latest stays.
        prune(store.path(), 300, 10);
        assert_eq!(snapshots(&store.path().join("a.md")).len(), 1);
        assert_eq!(snapshots(&store.path().join("b.md")).len(), 1);
        assert_eq!(snapshots(&store.path().join("a.md"))[0].ts, 200);
        assert_eq!(snapshots(&store.path().join("b.md"))[0].ts, 250);
    }

    #[test]
    fn tracked_is_markdown_only() {
        let s = Settings::default();
        assert!(tracked(&s, "note.md"));
        assert!(tracked(&s, "proj/docs/note.markdown"));
        assert!(!tracked(&s, "data.json"));
        assert!(!tracked(&s, "proj/config.toml"));
        assert!(!tracked(&s, "no-extension"));
    }
}
