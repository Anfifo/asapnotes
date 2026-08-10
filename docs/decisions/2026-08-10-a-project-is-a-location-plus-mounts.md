# A project is a location plus mounts

- Date: 2026-08-10
- Status: Accepted

## Context

Three things had grown up separately: projects as first-level subfolders of the notes root,
external projects linked in place, and the "virtual folders" asked for so notes can belong
to a project without living in its repository. Each came with its own storage, its own
resolution rule, and its own idea of what the explorer should show — and mappings to files
outside the notes root were still the open question the markdown-files decision deferred.

## Decision

**A project is a location plus zero or more mounts.** A project in the notes root has the
location `<root>/<name>`; a linked project has an absolute one; a mount attaches a folder
into a project at a project-relative name. Three features become one model, and today's
external mapping is the degenerate case — a project whose location is absolute and whose
mount list is empty. Creation asks the one question the old flow answered silently: in the
notes folder, or a picked folder (rooted at the repository's `docs/` when it has a `.git`).

Two rules keep the model honest:

- **Existence comes from the filesystem; the registry only adds attributes.** A first-level
  subfolder of the notes root is a project whether or not anything ever registered it — make
  one in a file manager and it appears. A registry that decided _which_ folders are projects
  would be the member manifest that
  [folders are projects](2026-08-07-folders-are-projects.md) rejected, arriving through the
  back door. The registry supplies only what the filesystem cannot: a location outside the
  root, mounts, an access grant, config.
- **Mounts are folder-granular, never per-file.** Per-file membership _is_ that manifest,
  and it would make the project model a query over a list instead of a walk over
  directories. A single note that must belong elsewhere lives in a folder that is mounted.
  Adding one is a single verb — pick a folder, mount it at a name — because the system
  folder picker already creates folders.

**Ids keep their shape:** a note's id everywhere stays its project-relative path, so shadow
drafts, tab persistence, the palette, search, and `@`-mention links need no migration.
Resolution gains one rule — within a project, the longest mount whose `at` is a
segment-boundary prefix of the rest wins.

The sharp consequence, recorded because getting it subtly wrong corrupts user data rather
than merely looking odd: **resolution has an inverse.** `resolve_note` maps id → path and
`noteIdOf` maps path → id, and both must read the same ordered table, longest-prefix first.
If the two disagree about which mount owns a file, that file acquires two ids — and
therefore two shadow drafts and two tabs that can overwrite each other.

Where a mounted folder is real but somewhere else, the explorer says so once, on the mount
root (a link glyph, the real path, a conflicted marker when a real folder later appears at
that name — the real folder always wins), with a subtle inherited tint on its subtree.
Inside a mounted folder the files genuinely live together, so badging every descendant
would read as breakage.

Also rejected: **declaring type or membership in frontmatter**, which stamps app metadata
into user-owned files — rejected for grouping before, and no better here.

## Links

- [Workspace / project model](../project-model.md) — the full design, the cost to existing
  code, and the implementation order
- [Config splits by trust, not by scope](2026-08-10-config-splits-by-trust.md) — where a
  project's attributes live, and why mounts can't live in the project
- [Folders are projects](2026-08-07-folders-are-projects.md) — existence stays
  filesystem-derived; this adds attributes, not a manifest
- [External projects linked in place](2026-08-07-external-projects-linked-in-place.md) —
  becomes the degenerate case
- `src-tauri/src/notes.rs` (`base_of`) and `src/App.tsx` (`noteIdOf`) — the two directions
  of the one rule
