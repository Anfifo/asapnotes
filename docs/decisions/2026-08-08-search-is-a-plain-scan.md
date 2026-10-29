# Search is a plain scan of the files

- Date: 2026-08-08
- Status: Built (the explorer's search view 2026-08-09; the MCP `search_notes` tool runs the same scan)

## Context

Ctrl+P matches note names, so finding a line inside a note needs content search. The files
are the contract: other editors, sync clients, version control and agents over MCP change
them at any time, often while the window is hidden, and the app runs no filesystem
watcher. Any stored search state is a second copy of the notes that has to be reconciled
against every one of those writers, and a resident tray app pays at idle for whatever it
keeps warm.

## Decision

**Every query reads the files.** `search` in `src-tauri/src/corpus/search.rs` walks the
same note set the explorer lists (`note_paths`: the notes root, registered project
locations and their mounts, each under its project's `files` rules), opens each file and
returns the matching lines. Nothing is kept between queries, so a result reflects the disk
at the moment it runs, with no reconcile step and no idle cost. A persistent index
(tantivy, SQLite full-text) was considered. It is derived state that goes stale whenever
another tool edits a note, and it grows the idle footprint. The ripgrep crates were
considered too. They bring regex and speed on large trees for about forty transitive crates
and a slower cold build, power this corpus does not need. The scan adds no dependency.

**Matching is a case-insensitive literal.** There are no regex, whole-word or case toggles.
Each hit is one line with its 1-based line number for the jump; a line longer than 300
characters comes back as a window around the match, so one minified file cannot push
megabytes through the IPC boundary.

**Narrowing comes before reading.** Files over 2 MB are skipped unopened. A whole-file
check skips the per-line pass on a file that cannot match, which is most of them. A project
filter drops files outside it unopened, and a per-note cap stops one long file filling the
result; the MCP tool uses both. The app caps a query at 500 hits. A note the caller may not
see is dropped before it counts toward the limit, so a hidden project cannot starve the
visible ones.

**The speed it gets.** On a 361-note corpus a whole-corpus search returned in 42 ms over
MCP. The search view debounces typing by 180 ms and waits for two characters, so typing a
word costs one scan, and only the newest scan may write results.

**Names and contents are two lookups.** Ctrl+P fuzzy-matches the note listing in the app,
and the MCP `find_notes` tool matches ids in Rust; neither opens a file. Ctrl+Shift+F opens
the search view inside the explorer panel, with matches grouped by note, each hit on one
line and its full text in the tooltip. A workspace filters the hits after the scan, so
switching workspaces does not re-run it.

**Limits, accepted.** Cost grows with the corpus, one read per file per query; on a large
granted repository the scan and its `files`-rule evaluation are the first thing to
measure. A note with an unsaved draft is searched as saved on disk, so a jump can land a
few lines off until it is saved. If search outgrows a scan, the store decision already
allows a rebuildable index on top of the files.

## Links

- Deep doc: [`docs/mcp-tool-surface.md`](../mcp-tool-surface.md) (the two searches, and
  visibility applied before the limit).
- Key files: [`src-tauri/src/corpus/search.rs`](../../src-tauri/src/corpus/search.rs)
  (`search`, `find_notes`), [`src-tauri/src/notes.rs`](../../src-tauri/src/notes.rs)
  (`search_notes`, the app command), [`src/Search.tsx`](../../src/Search.tsx) (the view).
- [Markdown files are the store](2026-08-06-markdown-files-are-the-store.md)
