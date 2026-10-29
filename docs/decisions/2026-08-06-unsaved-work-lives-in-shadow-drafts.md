# Unsaved work lives in shadow drafts

- Date: 2026-08-06
- Status: Built (autosave to drafts, Ctrl+S to the file, Save / Discard / Cancel on close)

## Context

A capture window is hidden with Esc, summoned again a second later, and lives in a tray
process that can be killed at any time, so text that exists only in the editor can be
lost. The note files are shared at the same time: sync clients, version control, other
editors and agents over MCP read the same `.md` files, and a write to one is visible to all
of them at once. Keeping every keystroke safe and keeping the user's files stable pull in
opposite directions while there is only one place to write.

## Decision

**Every edit autosaves to a shadow draft.** 500 ms after the last change the buffer is
written to a `drafts/` folder in app data at the note's own id (`note.md`,
`project/docs/note.md`), so the drafts tree mirrors the notes tree. A pending write is
flushed before a tab switch, a window hide or a close, so nothing is left waiting in a
timer when the window goes away. Renaming or moving a note moves its draft with it;
deleting a note, a folder or a project removes the drafts filed under it.

**Ctrl+S is the only write to the note file.** Save writes the real file and deletes the
draft, so other tools only ever see a state that was saved on purpose. Before writing, save
compares the file's modification time with the one seen when the buffer loaded; when
another tool changed the file in between, a confirm asks before overwriting. An untitled
note takes a name derived from its first line at that point.

**A leftover draft wins on reopen.** Opening a note that has a draft loads the draft and
marks the tab unsaved. The same rule serves as crash recovery and as the way a closed,
unsaved note comes back. A draft at an existing note's id holds that note's unsaved edits;
a draft at an app-generated `untitled-<timestamp>` id is an unsaved new note. A named draft
whose file was deleted outside the app keeps its name, and Ctrl+S recreates the file where
it was. "Show unsaved changes" marks a draft against its file the way the changes lens
marks an external edit.

**A deliberate close asks; bulk closes keep the draft.** Closing a tab that holds unsaved
content raises Save / Discard / Cancel. Discard moves the draft to the recycle bin, the rule
every other deletion in the app follows, so a discarded draft stays recoverable. A tab
edited back to exactly its file closes without asking and its draft goes, and so does a
never-typed untitled tab, which keeps empty drafts from piling up. Close others and Close
all leave drafts behind without a prompt, and Close saved skips any tab with a draft: one
decision per deliberate close, with no stack of modals.

**Known costs.** Search reads the files on disk, so a hit in a note with a draft jumps to
the saved file's line number, a few lines off until the note is saved. Drafts list under
the default note rules, so a draft of a file that only a project's `files` patterns
re-include does not appear in the listing.

## Links

- Key files: [`src-tauri/src/notes.rs`](../../src-tauri/src/notes.rs) (the draft commands;
  the module docs describe the layout), [`src/App.tsx`](../../src/App.tsx) (`handleChange`,
  `flushDraft`, `save`, `openItem`, `requestCloseTab`),
  [`src/CloseConfirm.tsx`](../../src/CloseConfirm.tsx).
- [Markdown files are the store](2026-08-06-markdown-files-are-the-store.md)
