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
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
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
    prune_seen(store, cutoff);
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

// --- Seen ledger ---
//
// Which changes the user has marked as read: (note id, change timestamp)
// pairs in one JSON file beside the snapshots. A new external edit to an
// already-seen note gets a new timestamp, so it correctly comes back unseen.

fn seen_path(store: &Path) -> PathBuf {
    store.join("seen.json")
}

/// An unreadable or malformed file reads as "nothing seen" — the ledger is a
/// convenience over the snapshots, never a reason to fail a scan.
fn load_seen(store: &Path) -> HashSet<(String, u64)> {
    fs::read_to_string(seen_path(store))
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<(String, u64)>>(&s).ok())
        .map(|v| v.into_iter().collect())
        .unwrap_or_default()
}

fn save_seen(store: &Path, seen: &HashSet<(String, u64)>) -> Result<(), String> {
    let mut entries: Vec<_> = seen.iter().collect();
    entries.sort();
    let json = serde_json::to_string(&entries).map_err(|e| e.to_string())?;
    fs::write(seen_path(store), json).map_err(|e| e.to_string())
}

/// One ledger entry to mark or unmark, as the frontend addresses changes.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeenItem {
    pub note: String,
    pub at_ms: u64,
}

#[tauri::command]
pub fn set_changes_seen(app: AppHandle, items: Vec<SeenItem>, seen: bool) -> Result<(), String> {
    let store = store_dir(&app)?;
    let mut set = load_seen(&store);
    for item in items {
        let key = (item.note, item.at_ms);
        if seen {
            set.insert(key);
        } else {
            set.remove(&key);
        }
    }
    save_seen(&store, &set)
}

/// Drop ledger entries older than the snapshot retention — their changes can
/// no longer appear in any window, so keeping them would grow the file forever.
fn prune_seen(store: &Path, cutoff: u64) {
    let seen = load_seen(store);
    let kept: HashSet<_> = seen
        .iter()
        .filter(|(_, ts)| *ts >= cutoff)
        .cloned()
        .collect();
    if kept.len() != seen.len() {
        let _ = save_seen(store, &kept);
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

/// One external edit as the ledger sees it: which note, when, how much.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeSummary {
    pub note: String,
    pub at_ms: u64,
    pub added: u32,
    pub removed: u32,
    /// Marked as read in the seen ledger — the view dims these and the
    /// rail badge counts only the rest.
    pub seen: bool,
}

/// Every external snapshot in the window paired with its predecessor —
/// app-origin snapshots are the "before" of these pairs and never appear as
/// changes themselves. `map` turns one diffed pair into whatever the caller
/// collects.
fn external_pairs<T>(
    store: &Path,
    since: u64,
    mut map: impl FnMut(&str, u64, &str, &str) -> T,
) -> Vec<(String, Vec<T>)> {
    let mut dirs = Vec::new();
    collect_note_dirs(store, &mut dirs);
    let mut out = Vec::new();
    for dir in dirs {
        let note = dir
            .strip_prefix(store)
            .unwrap_or(&dir)
            .to_string_lossy()
            .replace('\\', "/");
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
/// the text travels with the lens when a note is opened.
#[tauri::command]
pub fn recent_changes(app: AppHandle, days: Option<u32>) -> Result<Vec<ChangeSummary>, String> {
    let store = store_dir(&app)?;
    let seen = load_seen(&store);
    let mut out: Vec<ChangeSummary> =
        external_pairs(&store, since_ms(days), |note, ts, old, new| {
            let (added, removed) = count_diff(old, new);
            ChangeSummary {
                note: note.to_string(),
                at_ms: ts,
                added,
                removed,
                seen: seen.contains(&(note.to_string(), ts)),
            }
        })
        .into_iter()
        .flat_map(|(_, items)| items)
        .collect();
    out.sort_by_key(|c| std::cmp::Reverse(c.at_ms));
    Ok(out)
}

// --- The lens: one note, rendered, with the external edits marked on it ---

/// One marked line: its 1-based position in the document, and the UTF-16
/// column ranges of the words that actually changed. No ranges means the whole
/// line is new — the view paints those wholesale instead of word by word.
/// UTF-16 because that is the unit the webview counts text in.
#[derive(Serialize)]
pub struct LensLine {
    pub line: u32,
    pub spans: Vec<(u32, u32)>,
}

/// A run of removed lines. The document no longer contains them, so they hang
/// after the last surviving line above them (`0` = above the first line).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LensDel {
    pub after_line: u32,
    pub lines: Vec<String>,
}

/// The note as another tool left it, plus what changed getting there.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteLens {
    pub note: String,
    pub text: String,
    pub added: Vec<LensLine>,
    pub dels: Vec<LensDel>,
    /// Counts for this one aggregate diff. They can come out below the
    /// ledger's per-edit sums — text added and then removed again inside the
    /// window shows in each edit but not in the end state.
    pub added_n: u32,
    pub removed_n: u32,
    /// When the last external edit in the window landed.
    pub at_ms: u64,
    /// The user has saved the note since, so `text` is the state the other
    /// tool left behind, not what is on disk now.
    pub own_edits_since: bool,
}

/// Marks for the rendered document: which lines of `new` are additions (down
/// to the changed words, where a line was edited rather than written), and
/// where the removed lines sat.
fn lens_marks(old: &str, new: &str) -> (Vec<LensLine>, Vec<LensDel>, u32, u32) {
    let diff = similar::TextDiff::from_lines(old, new);
    let mut added: Vec<LensLine> = Vec::new();
    let mut dels: Vec<LensDel> = Vec::new();
    let mut removed_n = 0;
    // Deleted lines collect until the next line that survived, then hang after
    // the last one before them — so a replacement shows its pill above the
    // text that took its place.
    let mut pending: Vec<String> = Vec::new();
    let mut anchor = 0;
    let mut passed = 0; // new-side lines walked so far
    let mut flush = |pending: &mut Vec<String>, anchor: u32| {
        if !pending.is_empty() {
            dels.push(LensDel {
                after_line: anchor,
                lines: std::mem::take(pending),
            });
        }
    };
    for op in diff.ops() {
        for change in diff.iter_inline_changes(op) {
            let text = || {
                change
                    .iter_strings_lossy()
                    .map(|(_, v)| v.to_string())
                    .collect::<String>()
            };
            match change.tag() {
                similar::ChangeTag::Delete => {
                    if pending.is_empty() {
                        anchor = passed;
                    }
                    removed_n += 1;
                    pending.push(text().trim_end_matches(['\n', '\r']).to_string());
                }
                similar::ChangeTag::Equal => {
                    flush(&mut pending, anchor);
                    passed = change.new_index().map_or(passed, |i| i as u32 + 1);
                }
                similar::ChangeTag::Insert => {
                    flush(&mut pending, anchor);
                    let Some(index) = change.new_index() else {
                        continue;
                    };
                    passed = index as u32 + 1;
                    // A wholly new line comes through unemphasized (the crate
                    // only marks words inside a replaced line), which is
                    // exactly the "no ranges = the whole line" case.
                    let mut spans = Vec::new();
                    let mut col = 0;
                    for (emphasized, value) in change.iter_strings_lossy() {
                        let width =
                            value.trim_end_matches(['\n', '\r']).encode_utf16().count() as u32;
                        if emphasized && width > 0 {
                            match spans.last_mut() {
                                // Adjacent runs join, so a marked phrase is one
                                // span rather than one per word.
                                Some((_, end)) if *end == col => *end = col + width,
                                _ => spans.push((col, col + width)),
                            }
                        }
                        col += width;
                    }
                    added.push(LensLine {
                        line: passed,
                        spans,
                    });
                }
            }
        }
    }
    flush(&mut pending, anchor);
    let added_n = added.len() as u32;
    (added, dels, added_n, removed_n)
}

/// The lens for one note: the note as of the last external edit in the window,
/// with every external addition since the window's first edit marked on it.
/// One baseline, not one per edit — a rendered document can only be one
/// document. `None` when nothing external happened to it in the window.
#[tauri::command]
pub fn note_lens(
    app: AppHandle,
    note: String,
    days: Option<u32>,
) -> Result<Option<NoteLens>, String> {
    // The id names a directory under the store; hold it to the shape note ids
    // have everywhere, so it can't reach outside.
    if !note.split('/').all(crate::notes::valid_segment) {
        return Err(format!("invalid note name: {note}"));
    }
    let store = store_dir(&app)?;
    let snaps = snapshots(&store.join(&note));
    let since = since_ms(days);
    let external = |s: &Snapshot| s.origin == Origin::External && s.ts >= since;
    let (Some(first), Some(last)) = (
        snaps.iter().position(external),
        snaps.iter().rposition(external),
    ) else {
        return Ok(None);
    };
    // Without a predecessor the first snapshot is a baseline, not an edit.
    if first == 0 {
        return Ok(None);
    }
    let old = fs::read_to_string(&snaps[first - 1].path).map_err(|e| e.to_string())?;
    let text = fs::read_to_string(&snaps[last].path).map_err(|e| e.to_string())?;
    let (added, dels, added_n, removed_n) = lens_marks(&old, &text);
    Ok(Some(NoteLens {
        note,
        text,
        added,
        dels,
        added_n,
        removed_n,
        at_ms: snaps[last].ts,
        own_edits_since: snaps.len() > last + 1,
    }))
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
        external_pairs(store, since, |note, ts, old, new| {
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
    fn lens_marks_whole_new_lines_without_word_ranges() {
        let (added, dels, added_n, removed_n) =
            lens_marks("one\ntwo\n", "one\nbrand new line\ntwo\n");
        assert_eq!((added_n, removed_n), (1, 0));
        assert!(dels.is_empty());
        assert_eq!(added.len(), 1);
        assert_eq!(added[0].line, 2);
        // Nothing to compare a new line against, so it marks whole.
        assert!(added[0].spans.is_empty());
    }

    #[test]
    fn lens_marks_carry_word_ranges_on_an_edited_line() {
        let (added, _, _, _) = lens_marks("the quick brown fox\n", "the quick red fox\n");
        assert_eq!(added.len(), 1);
        assert_eq!(added[0].line, 1);
        // "brown" → "red": the changed word alone, in UTF-16 columns.
        assert_eq!(added[0].spans, vec![(10, 13)]);
    }

    #[test]
    fn lens_word_ranges_count_utf16_columns() {
        // The em dash is one UTF-16 unit but three bytes — byte offsets would
        // land the mark a character early in the webview.
        let (added, _, _, _) = lens_marks("a — brown fox\n", "a — red fox\n");
        assert_eq!(added.len(), 1);
        assert_eq!(added[0].spans, vec![(4, 7)]);
    }

    #[test]
    fn lens_deletions_anchor_after_the_line_above_them() {
        let (added, dels, _, removed_n) =
            lens_marks("keep\ngone one\ngone two\ntail\n", "keep\ntail\n");
        assert!(added.is_empty());
        assert_eq!(removed_n, 2);
        assert_eq!(dels.len(), 1);
        assert_eq!(dels[0].after_line, 1);
        assert_eq!(dels[0].lines, vec!["gone one", "gone two"]);
    }

    #[test]
    fn lens_deletions_above_the_first_line_anchor_at_zero() {
        let (_, dels, _, _) = lens_marks("gone\nkeep\n", "keep\n");
        assert_eq!(dels.len(), 1);
        assert_eq!(dels[0].after_line, 0);
    }

    #[test]
    fn lens_replacement_hangs_its_removals_above_the_new_text() {
        let (added, dels, _, _) = lens_marks(
            "intro\nold one\nold two\nend\n",
            "intro\nfresh one\nfresh two\nend\n",
        );
        assert_eq!(added.iter().map(|l| l.line).collect::<Vec<_>>(), vec![2, 3]);
        assert_eq!(dels.len(), 1);
        assert_eq!(dels[0].after_line, 1);
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
    fn seen_ledger_round_trips() {
        let store = TempStore::new();
        let mut set = HashSet::new();
        set.insert(("a.md".to_string(), 100));
        set.insert(("proj/docs/b.md".to_string(), 200));
        save_seen(store.path(), &set).unwrap();
        assert_eq!(load_seen(store.path()), set);
        // Missing or malformed files read as "nothing seen".
        fs::write(seen_path(store.path()), "not json").unwrap();
        assert!(load_seen(store.path()).is_empty());
    }

    #[test]
    fn prune_seen_drops_entries_past_the_cutoff() {
        let store = TempStore::new();
        let mut set = HashSet::new();
        set.insert(("a.md".to_string(), 100));
        set.insert(("a.md".to_string(), 900));
        save_seen(store.path(), &set).unwrap();
        prune_seen(store.path(), 500);
        let kept = load_seen(store.path());
        assert_eq!(kept.len(), 1);
        assert!(kept.contains(&("a.md".to_string(), 900)));
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
