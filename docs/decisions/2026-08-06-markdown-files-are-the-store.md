# Notes are markdown files; the app is a viewport

- Date: 2026-08-06
- Status: Accepted

## Context

An AI must be able to go over the notes via MCP, and three future abilities are wanted:
including files that live outside the notes folder (open anything, wherever it sits),
grouping levels user → project → notes (nested workspaces), and eventually cloud
share + live collaboration on a group of notes. The storage choice shapes all of them.

## Decision

- **One `.md` file per note under a user-owned notes root.** Files are the source of truth
  and the public contract: greppable, syncable, editable by other tools. The MCP server
  becomes a thin sidecar over the same files rather than an API over a private schema.
- **The workspace model must not assume all notes live under one folder.** A project is a
  list of note _references_ — some inside the root, some mappings to external files — not
  a directory listing. Nearer-term storage code keeps that door open.
- **Rejected: SQLite as the note store.** Faster metadata/search, but it locks notes
  behind the app's schema and forces every future consumer (MCP, sync, other editors)
  through app code. A _rebuildable_ index on top of the files stays allowed if search ever
  outgrows grep-scale.
- **Cloud share / live collaboration stays future work.** It layers sync/presence on top
  of the file model (likely per-note CRDT at that point) instead of replacing it. No code
  now; this entry records the direction so nearer-term decisions stay compatible.

## Links

- [Unsaved work lives in shadow drafts](2026-08-06-unsaved-work-lives-in-shadow-drafts.md),
  [Notes are plain-text files, with features per type](2026-08-09-notes-are-plain-text-files-with-per-type-features.md),
  [The MCP server shells out to the Rust helper](2026-08-19-the-mcp-server-shells-out-to-the-rust-helper.md),
  [Workspaces are display-only sets of projects](2026-09-05-workspaces-are-display-only-sets.md)
- [2026-08-06-resident-tray-and-tauri-stack.md](2026-08-06-resident-tray-and-tauri-stack.md)
