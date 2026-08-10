# Config splits by trust, not by scope

- Date: 2026-08-10
- Status: Accepted

## Context

Per-project configuration was the last thing five TODO items were waiting on: file rules,
mounts, the note-type registry, board layout, and the MCP grant all needed somewhere to
live. The obvious axis to split on is scope — app-level settings in app data, per-project
settings in the project. But a file inside a project arrives on other machines by
`git pull`, and this app's stance is that an always-resident tray process earns trust by
being auditably quiet.

## Decision

**Two files, and the seam between them is trust, not scope level.** Anything that grants
access or names a machine path is _personal_ and lives in app-data `settings.json`: the
notes root, appearance, the note-type registry, and per project its location, its mounts,
and its MCP grant. Everything portable — "in this repository, these files are notes",
per-project note types — lives in `<project>/.asapnotes.json`, created lazily on the first
change to that project, so linking twelve repositories writes zero files. The app never
edits `.gitignore` and never prompts about version control; committing it is the user's
call, and the file is shaped so both answers are cheap.

The consequence that earns the second file: no file in any repository can widen what the
app, or the planned MCP sidecar, can reach. Cloning a repository can't point the sidecar at
a folder nobody on this machine approved, or attach a directory to a project because a
commit said so. Absolute paths fail the same test for a duller reason — they are simply
wrong on a teammate's machine.

Rejected:

- **One file in app data holding everything.** Zero footprint in user repositories and no
  boundary to reason about — genuinely the simplest build. But nothing is shareable: a team
  cannot ship "these are the docs, this is the board" with the repository, and a board
  nobody else can read undercuts the reason for choosing an open canvas format.
- **One file in the project holding everything.** The purest reading of files-are-the-
  contract, but a config arriving by `git pull` would carry an access grant.

`settings.json` is the source of truth, and `localStorage` stays a **boot mirror** of the
values read before the first paint — theme, zoom, explorer width and pin state, open tabs.
Theme is applied before `createRoot` precisely so nothing paints in the wrong colors.
Writes go to both; the mirror is reconciled from the file once it loads. Summon latency is
the product, so no setting gets to sit in front of the first frame. On the Rust side the
parsed file lives in app state and is replaced on write, rather than being re-read per call
the way the mapping it absorbed was; both files are re-read on window focus, reusing the
signal that already re-syncs externally edited notes — hand-editing works, with no watcher
and no idle cost.

## Links

- [Workspace / project model](../project-model.md) — the full design, including the schema
  and the migration
- [A project is a location plus mounts](2026-08-10-a-project-is-a-location-plus-mounts.md) —
  the model this configuration describes
- [Markdown files are the store](2026-08-06-markdown-files-are-the-store.md) — files stay
  primary; config is a side table
- `src-tauri/src/settings.rs` — the file, its cache, and the migration off
  `external_projects.json`
