# Deleting means the recycle bin

- Date: 2026-08-12
- Status: Built (notes, drafts, folders and virtual folders; the close-tab confirm)

## Context

Notes are plain files the user owns, often inside repositories and folders the app only
borrows. A delete the app cannot undo loses something that was never the app's. Two gaps
made the question concrete. Folders had no removal at all, and a virtual folder offered
only Detach, which left its backing directory behind. Closing a tab with unsaved content
kept a shadow draft silently: nothing was lost, but the note looked gone, and untitled
drafts piled up in app data unannounced.

## Decision

**Every deletion of user content goes to the OS recycle bin.** `delete_note`,
`delete_folder`, `delete_mount` and `discard_draft` all move their target with the `trash`
crate. There is no hard delete and no trash area private to the app. A dated drafts-trash,
pruned after some days, was considered for discarded drafts. It would be a second deletion
policy with its own pruning code and its own recovery story, hidden from everything else
on the machine; the recycle bin is the one recovery path the OS already teaches. A target
already removed by other means counts as deleted, so the cleanup after it still runs.

**App-internal copies are removed outright.** Shadow drafts and history snapshots under a
deleted note or folder are app state, so they go with a plain filesystem remove.
`delete_draft` stays the silent removal for a draft whose content is safe elsewhere, such
as a just-saved note's. The line between the two: the only copy of something the user
wrote goes to the bin.

**Folders and virtual folders can be deleted.** A subfolder heading offers "Delete folder";
top-level folders are projects, whose lifecycle is unlinking, and the backend refuses them.
A virtual folder offers "Delete virtual folder" beside "Detach": delete trashes the backing
folder and then detaches it, detach keeps every file where it is. When the backing folder
lives outside the virtual-folders home, the confirm names its path, since that folder is
what gets deleted. A conflicted mount shows the real folder that took its name, so its
entry is "Delete folder". The confirm talks plainly about deletion; recoverability is the
safety net, and the wording does not lean on it. Tabs under the deleted subtree close.

**Closing an unsaved tab is a decision point.** A tab whose content would otherwise survive
only as a shadow draft raises an in-app sheet: Save, Discard, Cancel. It is in-app because
the native dialog has two buttons. Save is focused, so Enter saves and Esc cancels. Save
runs the one existing save path (a background tab activates first, so name derivation and
the changed-on-disk guard apply) and closes only if the save went through. Discard flushes
the live buffer into the draft and then trashes the draft, so the bin holds exactly what
was thrown away. A never-typed untitled tab, or one edited back to what its file holds,
closes silently and its redundant draft is removed, which stops empty drafts accumulating.
The explorer's "Discard draft" and the "Discard unsaved changes" verb use the same
`discard_draft`. Bulk closes (others, saved, all) ask nothing and leave drafts behind, one
question per deliberate close. Keeping the silent close and announcing the kept draft was
considered. It would ask nothing, but drafts would keep piling up and the note would still
look gone.

Agents have no delete verb over MCP.

## Links

- [Markdown files are the store](2026-08-06-markdown-files-are-the-store.md): notes are
  user-owned files
- [A project is a location plus mounts](2026-08-10-a-project-is-a-location-plus-mounts.md):
  what a virtual folder and its backing folder are
- [MCP tool surface](../mcp-tool-surface.md): why agents have no delete
- Key files: [`src-tauri/src/notes.rs`](../../src-tauri/src/notes.rs) (`delete_note`,
  `delete_folder`, `delete_mount`, `discard_draft`, `delete_draft`),
  [`src/CloseConfirm.tsx`](../../src/CloseConfirm.tsx) (the sheet); the close flow is
  `requestCloseTab` in [`src/App.tsx`](../../src/App.tsx)
