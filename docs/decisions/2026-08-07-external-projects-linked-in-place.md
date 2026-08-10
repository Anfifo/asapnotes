# External projects are linked in place

- Date: 2026-08-07
- Status: Built

## Context

Projects were exactly the first-level subfolders of the notes root
(`Documents/asapnotes`). The user wanted "scan a folder and load projects" — point at,
say, a GitHub directory and have every repo with markdown docs show up as a project.
Those files live outside the notes root, which is the "external-file mappings" gap the
markdown-files-are-the-store decision left open. Two shapes were on the table: copy the
found `.md` files into the notes root (small, self-contained), or map the folders and
edit the real files where they live (touches note-id resolution, listing, drafts,
preview asset scope).

## Decision

Link in place. Copying forks the files — edits in asapnotes would never reach the repo
they came from — which breaks "markdown files are the contract". Concretely:

- A mapping `name → absolute folder path` lives in app-data `external_projects.json`
  (`notes.rs`). The id's **first segment** decides where a note lives: an external
  mapping wins, everything else resolves under the notes root. Ids are now any depth
  (`project/docs/x.md`); root projects keep their one-level listing.
  _(2026-08-10: that store moved into app-data `settings.json` as project entries with a
  `path` — see [config splits by trust](2026-08-10-config-splits-by-trust.md). The
  resolution rule is unchanged, and is now the degenerate case of
  [location plus mounts](2026-08-10-a-project-is-a-location-plus-mounts.md).)_
- **Scan rule:** File → "Scan folder for projects…" walks the picked folder
  (skipping dot-dirs, `node_modules`, `target`, …); a folder containing a
  `README.md`/`index.md` (case-insensitive) becomes a candidate and is not descended
  further — nested READMEs belong to the outer project. The user confirms which
  candidates to add in a checklist sheet.
- External project notes are listed **recursively** (chosen over top-level-only);
  drafts mirror the deep ids in app data as before.
- Pasted/dropped images for an external note go to that project's own `assets/`
  (the folder owns its files); each mapped folder is added to the asset-protocol
  scope at startup/add so preview can render its images.
- Unlinking (Settings → Linked projects) only removes the mapping — files untouched.

## Links

- [Markdown files are the store](2026-08-06-markdown-files-are-the-store.md) — the
  invariant that forced link-over-copy.
- [Folders are projects](2026-08-07-folders-are-projects.md) — the root-project model
  this extends.
- Key files: `src-tauri/src/notes.rs` (resolution, scan, mappings),
  `src/ScanProjects.tsx` (confirmation sheet), `src/MenuBar.tsx` (menu entry point).
