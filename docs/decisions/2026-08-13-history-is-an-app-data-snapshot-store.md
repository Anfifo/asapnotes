# History is an app-data snapshot store

- Date: 2026-08-13
- Status: Built (the ledger and seen marks 2026-08-13; the rendered lens replaced the hunk
  document 2026-08-14)

## Context

Notes are files, so other tools edit them: agents, the MCP sidecar, a second editor, a
`git pull`. The recent-changes view answers "what changed in my notes while I was
elsewhere", which needs past content to diff against. Nothing in the app stored any:
drafts hold only the current unsaved buffer, the recycle bin holds deletions, and an mtime
says when a file changed but never what. The notes root is not guaranteed to be a
repository, and a resident tray app cannot afford a file watcher or a timer at idle.

## Decision

**Snapshots live in app data.** `history/` sits beside `drafts/` and mirrors note ids the
same way, one full copy per version named `<timestamp>-<origin>.md`, zero-padded so name
order is time order. Full copies keep the store simple: any snapshot can be pruned without
re-basing the ones after it. The notes folder holds only the user's files. Git was
considered as the source. The notes root may not be a repository, commits are not an edit
timeline, uncommitted work is invisible to it, and reading it needs a git on the machine
or a heavy library. OS-level file history was considered too; it is not dependable across
machines and its content cannot be queried.

**The view shows edits made outside the app.** Every snapshot carries an origin. `app` is
the app's own save, recorded silently because the next diff needs the last app-known state
as its "before". `external` is content the scan found changed on disk, and only those
appear as changes. External means "not this app": an agent, another editor and a pull all
look the same, and the app does not attribute further.

**Capture rides signals the app already has.** `save_note` snapshots after writing, and for
a note the store has never seen it stores the pre-save disk content first, so that save
diffs against something. The window-focus re-sync runs `scan_changes` over the note corpus: an mtime newer
than the latest snapshot is the only reason to read a file, identical content is deduped,
and a note seen for the first time gets a silent baseline. The invariant underneath is that
the store holds every seen note's last-known content; that is what keeps the scan an mtime
compare. Only markdown notes are tracked, files past the search size cap are skipped, and a
broken store never blocks a save. An in-app move carries a note's history with it;
deleting a note or folder removes its history outright, as it does the draft.

**Retention has three caps.** Thirty days, 25 versions per note, and 50 MB for the whole
store, the last taken oldest-first across all notes so one note an agent hammers cannot
starve the rest. One prune pass runs on the first scan of each day. A note's latest
snapshot is never pruned, because the scan and the diffs stand on it. The caps are
constants with no settings UI.

**Diffs are computed in Rust on demand.** The ledger needs counts across every changed
note, so the backend sends counts and marks over IPC and the webview never receives file
pairs. The `similar` crate does the diffing, its inline mode supplying the changed words
inside an edited line; a user-facing diff depends on readable hunks, which is where a
hand-rolled one would spend its effort. Word ranges travel as UTF-16 columns, the unit the
webview counts text in.

**The ledger leads, the lens reads.** The view covers the last seven days. The panel
groups changed notes into project sections,
one row per note with its added and removed counts and a relative stamp; the view button's
badge counts unseen notes. Seen marks live in `seen.json` keyed by note and change
timestamp, so a fresh edit to a seen note comes back unseen, and Ctrl+Z walks marks back.
Opening a row retargets one lens tab: the note on the editor's own live-preview surface,
read-only, with the changed words marked and each deletion a collapsed pill that expands in
place. Its baseline is the snapshot before the window's first external edit, so the
document holds still while marks are clicked. F8 and Shift+F8 walk the changes and step to
the next changed note past either end, which makes reading through every change one
motion. The lens closes when the explorer leaves the changes view, on Esc, or when it hands
over to the real note at the change on screen. The first build opened a separate hunk
document; reading a raw diff lost the note's own shape, and the lens replaced it. Marking
the rendered preview was considered. It can only mark whole blocks, so one reworded clause
washes its paragraph, and it has no line positions to jump to. The same lens shows a note's
unsaved edits against its file.

## Links

- [Markdown files are the store](2026-08-06-markdown-files-are-the-store.md): the store is a
  side table, the files stay primary
- [Resident tray + Tauri stack](2026-08-06-resident-tray-and-tauri-stack.md): why capture
  has no watcher and no timer
- Key files: [`src-tauri/src/history.rs`](../../src-tauri/src/history.rs) (store, scan,
  prune, ledger, lens marks), [`src/Changes.tsx`](../../src/Changes.tsx) (the ledger panel),
  [`src/DiffLens.tsx`](../../src/DiffLens.tsx) (the lens),
  [`src/changesLedger.ts`](../../src/changesLedger.ts) (sections and the lens's note order)
