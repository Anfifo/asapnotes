# Folders are projects

- Date: 2026-08-07
- Status: Accepted

## Context

Notes need a grouping level (user → project → notes, Postman-like) before there are enough
of them to drown the flat root. Whatever shape grouping takes constrains storage, future
cloud sync, and the planned mappings to files living outside the notes root — so the shape
was decided before code ([TODO item](../TODO.md), and see
[Markdown files are the store](2026-08-06-markdown-files-are-the-store.md)).

## Decision

**A project is a first-level subfolder of the notes root; notes at the root are the
"inbox".** A note's identity everywhere (backend commands, drafts, palette) is its path
relative to the notes root — `project/note.md` or `note.md` — one folder level deep, no
nesting. The shadow-drafts folder mirrors the same relative paths. Pasted images land in a
shared `assets/` folder at the notes root (excluded from project listings) and are linked
relative to the note's own location so other markdown tools resolve them.

Rejected:

- **Manifest workspaces** (a `project.json` listing member notes, including external
  files) — supports external-file mappings today, but introduces a second source of truth
  beside the filesystem, exactly what the markdown-files decision warns against. When
  external mappings arrive, a manifest can layer _on top_ of folders without migrating
  anything.
- **Frontmatter tags** (`project: x` in YAML) — grouping becomes a query, invisible to
  file explorers and sync tools, and stamps metadata into every user-owned file.

Folders keep the grouping itself plain files: any external tool, backup, or future sync
sees the same structure the app does.

## Links

- [Markdown files are the store](2026-08-06-markdown-files-are-the-store.md)
- `src-tauri/src/notes.rs` — path-validated commands over the notes root
