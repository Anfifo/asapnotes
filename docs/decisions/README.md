# Decisions

One log for the decisions that shape this repo: architecture choices, subsystem designs,
"chose against" calls, and parked investigations. If a future contributor could reasonably
ask "why is it like this?" — the answer belongs here, as a short entry linking to the deep
doc that carries the detail.

Entries are dated (`YYYY-MM-DD-slug.md`) and deliberately lightweight. The bar is simply
_a real decision or a main integration_ — not task noise, not routine fixes.

## Template

```markdown
# <Short title>

- Date: YYYY-MM-DD
- Status: Accepted | Built | Parked | Superseded by <entry>

## Context

One paragraph: the problem and the forces in play.

## Decision

What was decided, including what was rejected and why.

## Links

Deep docs, migrations, key files.
```

## Where entries come from

- Promoted from [`docs/TODO.md`](../TODO.md) when a completed work item embodied a real
  decision (see the workflow note in [CLAUDE.md](../../CLAUDE.md)).
- Written directly when a decision is made outside a tracked TODO (an investigation that
  ends in "park it", a probe that picks an approach).

## Index

| Date       | Entry                                                                                                                         | One-liner                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 2026-08-06 | [Resident tray + Tauri stack](2026-08-06-resident-tray-and-tauri-stack.md)                                                    | Always-resident tray process + hidden window; Tauri 2 + React/TS                     |
| 2026-08-06 | [Markdown files are the store](2026-08-06-markdown-files-are-the-store.md)                                                    | `.md` files as source of truth; workspaces + cloud layer on top                      |
| 2026-08-06 | [Unsaved work lives in shadow drafts](2026-08-06-unsaved-work-lives-in-shadow-drafts.md)                                      | Edits autosave to app-data drafts; Ctrl+S writes the file; a leftover draft wins     |
| 2026-08-07 | [Folders are projects](2026-08-07-folders-are-projects.md)                                                                    | First-level subfolders group notes; root notes have no project                       |
| 2026-08-07 | [External projects linked in place](2026-08-07-external-projects-linked-in-place.md)                                          | Scan finds README-marked folders; notes edited where they live                       |
| 2026-08-07 | [Live preview in the editing buffer](2026-08-07-live-preview-in-the-buffer.md)                                                | Markdown renders in the buffer; markers compact, revealed at the caret; one scale    |
| 2026-08-08 | [Search is a plain scan of the files](2026-08-08-search-is-a-plain-scan.md)                                                   | Each query reads the files; no index to reconcile with other tools' edits            |
| 2026-08-09 | [Notes are plain-text files, with features per type](2026-08-09-notes-are-plain-text-files-with-per-type-features.md)         | Any registry-claimed extension is a note; each type declares its own features        |
| 2026-08-10 | [A project is a location plus mounts](2026-08-10-a-project-is-a-location-plus-mounts.md)                                      | One model for root, linked and virtual folders; ids unchanged                        |
| 2026-08-10 | [Config splits by trust, not by scope](2026-08-10-config-splits-by-trust.md)                                                  | Personal config in app data, portable config in the project                          |
| 2026-08-12 | [Deleting means the recycle bin](2026-08-12-deleting-means-the-recycle-bin.md)                                                | Notes, drafts, folders and mounts go to the OS bin; an unsaved close asks first      |
| 2026-08-13 | [History is an app-data snapshot store](2026-08-13-history-is-an-app-data-snapshot-store.md)                                  | Snapshots in app data catch outside edits; a read-only lens marks them on the note   |
| 2026-08-14 | [Canvas is a native view, not a plugin](2026-08-14-canvas-is-a-native-view.md)                                                | Superseded 2026-08-25; the registry-vs-code seam still stands                        |
| 2026-08-14 | [Canvas files are JSONCanvas](2026-08-14-canvas-files-are-jsoncanvas.md)                                                      | Superseded 2026-08-25; no `.canvas` files any more                                   |
| 2026-08-19 | [The MCP server shells out to the Rust helper](2026-08-19-the-mcp-server-shells-out-to-the-rust-helper.md)                    | One project-model implementation; per-call grants; section writes; write log         |
| 2026-08-25 | [The map is a graph view, not a canvas](2026-08-25-map-is-a-graph-view-not-a-canvas.md)                                       | Canvas engine removed; one map view, three layouts, click for details                |
| 2026-08-31 | [Meetings record first and transcribe locally](2026-08-31-meetings-record-first-and-transcribe-locally.md)                    | Two Opus tracks on disk; an opt-in local whisper.cpp add-on writes a sibling note    |
| 2026-09-04 | [Controls are stroke glyphs; the app owns right-click](2026-09-04-controls-are-stroke-glyphs-and-the-app-owns-right-click.md) | One inlined glyph set for every control; no webview page menu; Recent panel gone     |
| 2026-09-04 | [Public under MIT, with the history kept](2026-09-04-public-under-mit-with-history-kept.md)                                   | MIT; history kept with identity metadata rewritten; comparisons stay private         |
| 2026-09-05 | [Workspaces are display-only sets of projects](2026-09-05-workspaces-are-display-only-sets.md)                                | Named sets of projects filter the window; MCP scope only when asked; grants stay     |
| 2026-10-28 | [AI tools work on the notes from outside the app](2026-10-28-ai-tools-work-from-outside.md)                                   | No in-app agent; destinations route new notes; MCP create/move; code-folder reminder |
| 2026-10-29 | [Agents drive meetings over a local control channel](2026-10-29-agents-drive-meetings-over-a-local-control-channel.md)        | Off-by-default pipe with a per-launch token; agents start and stop recordings        |
| 2026-10-29 | [Third-party notices are generated per release](2026-10-29-third-party-notices-are-generated-per-release.md)                  | One committed file, rebuilt by every release; a license list gates new crates        |
| 2026-10-29 | [The installer is NSIS only](2026-10-29-the-installer-is-nsis-only.md)                                                        | Per-user NSIS installer; no MSI until central deployment is asked for                |
