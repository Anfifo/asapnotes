# asapnotes — workspace / project model

_2026-08-10. Design doc, written before the code. Five TODO items defer to it; this is
the answer they were waiting for. Update as the implementation teaches us things._

## What this settles

| Deferred question                                                 | Answer                                                                                           | Section                                         |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| Grouping levels and mappings to files outside the notes root      | A project is a **location plus mounts**; ids keep their shape                                    | [The model](#the-model)                         |
| One config file or two, and where the per-project one lives       | **Two**, split by trust: personal in app data, portable in the project                           | [Where config lives](#where-config-lives)       |
| Does the per-project file end up in the user's repo?              | Only if they commit it. It is never created unasked and we never touch `.gitignore`              | [Is it committed?](#is-it-committed)            |
| Where a new project lives                                         | Creation asks: notes root, or a picked folder                                                    | [Projects](#projects)                           |
| Does "add virtual folder" pick or create?                         | Both (revised 2026-08-12): _associate_ picks, _new_ creates in the virtual-folders home          | [Mounts](#mounts-virtual-folders)               |
| Note-type registry shape                                          | Data in settings (`extensions`, `view`, `icon`, `features`); view providers are an in-tree table | [Note-type registry](#the-note-type-registry)   |
| How the explorer marks virtual entries                            | Badge and real path on the mount root; a subtle inherited tint on its subtree                    | [In the explorer](#in-the-explorer)             |
| Default exclusion set, and how a project pulls code files back in | Default is code (type allowlist + skip dirs); a project overrides with one ordered pattern list  | [What counts as a note](#what-counts-as-a-note) |
| Board layout storage                                              | `board.canvas` — a JSONCanvas file, not a config key                                             | [What this unlocks](#what-this-unlocks)         |
| MCP access scope                                                  | A per-project grant living in the **personal** file, never in the project                        | [What this unlocks](#what-this-unlocks)         |

What it costs the existing code, and the order to build it in, are at the
[end](#what-it-costs-the-existing-code).

Nothing here reopens [markdown files are the store](decisions/2026-08-06-markdown-files-are-the-store.md),
[folders are projects](decisions/2026-08-07-folders-are-projects.md), or
[external projects linked in place](decisions/2026-08-07-external-projects-linked-in-place.md) —
this is what those three imply once per-project configuration exists.

## The model

**A project is a location plus zero or more mounts.** That single sentence covers what
were three separate features: a project in the notes root (location is a subfolder), an
external project (location is an absolute path), and virtual folders (mounts).

### Existence comes from the filesystem; the registry only adds attributes

A first-level subfolder of the notes root is a project whether or not anything has ever
registered it — make one in a file manager and it appears. The registry supplies what the
filesystem cannot: a location outside the root, mounts, an access grant, config.

This line matters. A registry that decided _which_ folders are projects would be the
member manifest that [folders are projects](decisions/2026-08-07-folders-are-projects.md)
rejected, arriving through the back door. Attributes-only keeps the filesystem the source
of truth for structure and the registry a side table.

### Ids keep their shape

A note's id everywhere stays its project-relative path — `project/note.md`,
`project/rel/path/note.md`, `note.md` for a note in no project. Resolution gains exactly
one rule:

1. Take the first segment. If a registered project owns it, that project's location is the
   base; otherwise the base is the notes root and the whole id is relative to it.
2. Within the project, the **longest mount whose `at` is a segment-boundary prefix of the
   rest** wins: the resolved path is that mount's `path` plus the remainder.
3. Otherwise the rest resolves against the project's own location.

Today's rule ("an external mapping on the first segment wins") is the degenerate case: an
external project is a project whose location is absolute and whose mount list is empty.

Because ids don't change shape, everything keyed by id keeps working untouched — shadow
drafts mirroring ids in app data, tab persistence, the palette, `search_notes`, the
`@`-mention links that resolve through [`relativePath`](../src/paths.ts).

### Mounts are folder-granular, never per-file

A mount attaches a **folder**. There is deliberately no way to list individual notes as
members of a project: per-file membership _is_ the rejected manifest, and it would make
the project model a query over a list instead of a walk over directories. A single note
that must belong somewhere else lives in a folder that is mounted.

### The workspace level

"User → project → notes" has, for now, exactly one workspace: this machine's notes root
plus its registry. A named multi-workspace level is **not** introduced here — it buys
nothing while everything is local, and it is the natural unit when cloud share and team
sync arrive. Nothing in this model blocks adding it later; the registry simply gains an
owning workspace per project.

## Where config lives

Two files, and the seam between them is **trust**, not scope level.

|              | Lives in                    | Holds                                                                                                          | Leaves the machine?         |
| ------------ | --------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------- |
| **Personal** | app data, `settings.json`   | notes root, appearance, note-type registry, virtual-folders home, and per project: location, mounts, MCP grant | never                       |
| **Portable** | `<project>/.asapnotes.json` | `files` patterns, per-project note-type entries                                                                | only if the user commits it |

### Why the split is there

A file inside a project arrives on other machines by `git pull`. If mounts or the MCP
grant lived there, cloning a repository could point the sidecar at a folder nobody on this
machine ever approved, or attach a directory to a project because a commit said so. For an
app whose stance is that a resident tray process earns trust by being auditably quiet,
that is not a matter of taste — **anything that grants access or names a machine path is
personal, full stop.**

Absolute paths fail the same test for a duller reason: they are simply wrong on a
teammate's machine.

Everything left over is genuinely shareable — "in this repository, these files are notes"
is as portable as an editor config, and worth committing.

### App-level: `settings.json`

Plain JSON in app data, editable in Settings and by hand, and later readable over MCP.
It absorbs `external_projects.json` and the settings currently sitting in `localStorage`.

```json
{
  "version": 1,
  "notesRoot": "C:/Users/me/Documents/asapnotes",
  "appearance": { "theme": "system", "zoom": 1, "explorer": { "width": 260, "pinned": true } },
  "projects": {
    "asapnotes": {
      "path": "C:/Users/me/Documents/GitHub/asapnotes/docs",
      "mounts": [{ "at": "meetings", "path": "C:/Users/me/Documents/acme/meetings" }],
      "mcp": "off"
    },
    "recipes": {}
  }
}
```

Plus `noteTypes`, the registry described [below](#the-note-type-registry).

A project entry with **no `path` is a notes-root project** — its location is
`notesRoot/<name>`. That is the whole difference between "internal" and "external"; they
stop being two kinds of thing. An entry may exist purely to carry mounts or a grant, and
most notes-root projects will have no entry at all.

### Per-project: `.asapnotes.json`

At the project's location — so a repository rooted at `docs/` gets `docs/.asapnotes.json`.

```json
{
  "version": 1,
  "files": ["archive/**", "!src/**/*.rs"],
  "noteTypes": [{ "id": "rust", "extensions": ["rs"], "view": "text", "color": "#c07a4a" }]
}
```

**Created lazily** — the first time the user changes something about that project. Linking
twelve repositories writes zero files.

### Is it committed?

That is the user's call, and the file is shaped so both answers are cheap: one predictable
name at a predictable place, no machine-specific content, nothing secret. We recommend
committing it — a teammate then sees the same notes the author does — but **the app never
edits `.gitignore` and never prompts about version control.**

### Startup, and the summon invariant

`settings.json` is the source of truth. `localStorage` continues to hold a **boot mirror**
of the handful of values needed before first paint — theme, zoom, explorer width and pin
state, open tabs — because reading them costs an IPC round trip, and theme in particular
is applied before `createRoot` precisely so nothing paints in the wrong colors. Writes go
to both; the mirror is reconciled from the file once it loads. Summon latency is the
product; no setting gets to sit in front of the first frame.

On the Rust side the parsed settings live in app state and are invalidated on write,
rather than being re-read per call — the way
[`external_map`](../src-tauri/src/notes.rs) is re-read on every single `resolve_note`
today, which `search_notes` already had to work around with its own `note_paths` helper.

Both files are re-read **on window focus**, reusing the mechanism that already re-syncs
externally edited notes. Hand-editing settings while the app runs works; no filesystem
watcher, no idle cost.

## Projects

### Creating one

Creation asks where the project lives — the one question the current flow answers silently
by always making a root subfolder:

- **In the notes folder** (default) — a new subfolder of the notes root, no registry entry
  needed.
- **Pick a folder…** — any directory, linked in place, registered with its `path`. When
  the picked folder contains `.git`, a checked-by-default **"use the repository's `docs/`
  folder"** option applies the existing `ensure_docs` rule, so a manual pick lands where a
  scanned repository would.

Scanning a folder for projects is unchanged; it is the same registration, in bulk.

### Names

A project name is one path segment and must be unique across the notes root and the
registry — already enforced when adding external projects, now the general rule.
Renaming a project is still deferred: it means moving a folder or repointing a location
_and_ rewriting ids in drafts, tabs, and board files.

## Mounts (virtual folders)

### The verbs

_Revised 2026-08-12 — the original design was one verb (pick a folder, mount it, with
the picker doubling as the way to create one). Use taught otherwise: "make me a virtual
folder" shouldn't require deciding where it lives._ Two verbs now, split by where the
folder comes from:

- **Associate virtual folder…** — pick an existing folder, mount it at its own name.
  The picker is still where a folder at a _chosen_ place gets created.
- **New virtual folder** — name it inline; the app creates the backing directory in the
  **virtual-folders home** (`virtualFoldersRoot` in the personal file, defaulting to
  `virtual/<project>/<at>` in app data — never the installation folder, which updates
  replace and installs may make read-only) and mounts it. Detaching leaves the folder in
  place, so creating the same name again revives its files.

Both verbs share one validation and registration path in the code; they differ only in
where the folder comes from.

Reachable from the explorer context menu on a project or folder heading — mounting onto a
folder heading simply produces a nested `at` (`design/meetings`).

### Shape and rules

```json
{ "at": "meetings", "path": "C:/Users/me/Documents/acme/meetings" }
```

- `at` is a project-relative path of one or more segments; `path` is an absolute folder.
- Mounted notes are listed and walked exactly like the project's own — same recursion,
  same skip rules, same `files` patterns (a mount is not a way around the project's
  exclusions).
- **Collisions:** mounting at a name a real folder already occupies is refused at creation.
  If a real folder later appears there, **the real folder wins** — a file that exists on
  disk must never be invisible — and the explorer marks the mount as conflicted.
- Images pasted into a mounted note land in that mount's own `assets/`, extending the rule
  that a linked folder owns its files. Each mount path must be added to the asset-protocol
  scope when it is added and at startup, the same call `add_external_projects` already
  makes — without it, preview silently fails to load those images at runtime.
- Drafts need no special handling: a mounted note's id has the ordinary shape, so its
  shadow draft mirrors it like any other.

### In the explorer

The mount **root** row carries the distinction: a link glyph, its real absolute path in the
row's detail slot, and the conflicted marker when applicable. Its subtree gets a subtle
inherited tint — one class on the container, free for every descendant.

Deliberately _not_ badging every descendant: inside a mounted folder, the files are
ordinary files that genuinely live together. The honest statement is "this folder is
somewhere else", made once, at the place where it is true. Loud styling all the way down
reads as breakage.

## The note-type registry

One registry replaces knowledge currently scattered across `NOTE_EXTS` in
[`notes.rs`](../src-tauri/src/notes.rs), `hasNoteExt`/`isMarkdown` in
[`paths.ts`](../src/paths.ts), the Editor's `plainText` flag, and the markdown-only
branches in `App`.

```json
{
  "id": "markdown",
  "name": "Markdown",
  "extensions": ["md", "markdown"],
  "view": "markdown",
  "icon": "file-text",
  "color": null,
  "features": ["live-preview", "preview", "mentions", "format", "images"]
}
```

Shipped entries: **markdown** as above; **text** (`txt`, `text`, `tex`, `log`, `csv`,
`json`, `yaml`, `yml`, `ini`, `cfg`, `toml`, `xml`) with `view: "text"` and no features.
(A **canvas** type shipped 2026-08-14–24 and was removed with the canvas view; a settings
file still carrying the shipped canvas entry upgrades to this list.)

### The registry is data; view providers are a code table

`view` and `icon` are **ids into small in-tree tables**, not paths, module specifiers, or
anything else loadable. The provider table maps `markdown`/`text` to components.

So a user can add `rs` to the text type, or give `.log` its own color, by editing JSON.
A user cannot introduce a new view — that is code in this repository. The registry is the
extension point for _formats_, the provider table is the extension point for _views_, and
only the first is user data.

### Features are a closed set

`live-preview`, `preview`, `mentions`, `format`, `images`, `ink` — the exact affordances
the chrome already toggles. The toolbar, Format menu, preview eye, and mention completion
key off this list instead of `isMarkdown`. A closed set is checkable, describable in
Settings, and honest: a feature name means a thing the app implements, not a hope.

### Matching

First entry whose extension list contains the file's extension wins; a project's
`noteTypes` entries are consulted before the app-level ones, so a project can recolor or
retype an extension without redefining the rest.

### One definition of "is this a note"

The registry's union of extensions _is_ the allowlist, read by both sides from the same
file — retiring the "keep these two lists in sync" comments that currently stand in for a
single source of truth, where a divergence would mean a file the backend lists and the
frontend refuses to open.

## What counts as a note

### The default is code, not patterns

A file is listed when its extension is in the registry allowlist and no skipped directory
is on its path (dot-directories, `node_modules`, `target`, `dist`, `build`, `out`) — which
is today's behavior, now stated as _the default_ rather than as the only possibility.

It is deliberately **not** expressed as patterns. The `.gitignore` idiom for "deny
everything except" needs `*`, `!*/`, `!*.md` and still surprises people. A default nobody
should have to read is better as code.

### A project overrides with one ordered list

`files` in `.asapnotes.json` is a single ordered list in `.gitignore` pattern syntax,
relative to the project root, **last match wins**:

- a bare pattern **excludes** what the default would have listed — `archive/**`,
  `CHANGELOG.md`;
- a `!` pattern **includes**, and additionally waives the type allowlist — `!src/**/*.rs`
  is exactly how a project pulls code files in.

A file re-included with no matching note type opens in the `text` view; adding a project
`noteTypes` entry is only needed to give it an icon or color.

Two behaviors inherited from the syntax, stated so they are not discovered as bugs: a
pattern that excludes a whole directory prunes the walk, so a negation cannot resurrect
files from inside it (to re-include there, do not exclude the directory); and matching is
per-segment with `**` crossing segments, as usual.

### The floor

No pattern re-includes: `.git/`, the executable extensions already listed in `EXEC_EXTS`
(the same set `open_external` refuses to launch), and files above the search size cap.
The floor exists so a pattern in a pulled config cannot make the app open something it
would otherwise refuse to touch.

## What this unlocks

### The project map

A project's map is **computed, never stored**: every markdown note is a node, every
markdown link to another file a reference, laid out on open in one of three views
([decision](decisions/2026-08-25-map-is-a-graph-view-not-a-canvas.md)). Nothing about it
lives in a project file — the notes are the data, so there is nothing to keep in sync. (A
`board.canvas` file per project was this section's earlier answer, 2026-08-14–24; it went
with the canvas view.)

### MCP

`mcp` per project in the **personal** file: `"off"` (default for registered out-of-root
projects), `"read"`, `"write"`. The notes root and its own projects are visible by default
— they are the app's own folder. Everything linked from elsewhere is opt-in, one project
at a time, from Settings.

This is the payoff of splitting the files by trust rather than by scope: there is no file
in any repository that can widen the sidecar's reach. The sidecar also sees only what the
project's `files` rules list, so exclusions are an access boundary as well as a display
one.

### Sync and the repo-clean promise

Mounts are how "team-syncable project notes that never enter the repository" works: the
mounted folder is what a sync layer carries, the repository stays exactly as clean as its
owner left it, and the notes still appear under the project where they belong. Files stay
primary either way, which keeps the cloud direction layered on top rather than in place of
this model.

## What it costs the existing code

Checked against the code as it stands, so none of this is discovered late.

- **Resolution has an inverse, and they must not disagree.** `resolve_note` maps id → path;
  [`noteIdOf`](../src/App.tsx) maps path → id for Ctrl+Clicked links, and today it walks the
  external map in arbitrary order. Both have to read the **same ordered mount table,
  longest-prefix-first** — if forward and inverse disagree about which mount owns a file,
  the same file acquires two ids, and therefore two shadow drafts and two tabs that can
  overwrite each other. This is the one place where getting mounts subtly wrong corrupts
  user data rather than just looking odd.
- **Search walks its own corpus.** `note_paths` enumerates the notes root plus the external
  map; if it doesn't learn about mounts, mounted notes are listed and openable but silently
  unsearchable — a failure that reads as "there are no results", which is exactly the
  failure mode the search toast was added for.
- **The frontend computes base directories in four places.** `externals[project] ?? root/project`
  appears in [App.tsx](../src/App.tsx) for asset paths, mentions, the current note's
  directory, and reveal. With mounts, all four become one `baseDirOf(id)` — well past the
  hoist-on-second-use rule, and a place where a missed copy means a link that resolves
  everywhere except one entry point.
- **`assets_dir_for` takes a project name**, which stops being enough once a mount can own
  its own `assets/` — it needs the note id, since the answer depends on which mount the
  note falls under, not which project.
- **`move_note` uses `fs::rename`**, which fails across volumes. Already reachable today
  (a linked project on another drive), but mounts make cross-volume moves ordinary rather
  than exotic; a copy-then-delete fallback stops being optional.
- **`MAX_DEPTH` counts id segments.** A mount with a deep `at` plus a deep file can exceed
  the 12-segment cap that the same file, reached through its own project, would pass. Worth
  deciding deliberately — cap the `at` depth at mount creation, where the error can be
  explained, rather than at open time, where it can't.
- **Removing a mount orphans drafts** filed under its ids — the same shape as the known
  unlink trade-off, and it should get the same answer whatever that turns out to be.
- **Already free, worth knowing:** `valid_segment` rejects dot-prefixed segments and
  `skip_dir` skips dot-directories, so `.asapnotes.json` can never be mistaken for a note
  and `.git/` is already outside every walk. Part of the floor exists; it just wasn't
  written down as a rule.

## Implementation order

Each step is useful alone and unblocks the next — no step needs the one after it to ship.

1. **`settings.json` + migration + the registry as data.** No user-visible change beyond
   parity; unblocks the settings rework and gives everything else a place to live.
   **Done 2026-08-10.**
2. **Registry consumers** — retire `NOTE_EXTS`, `hasNoteExt`, the `plainText` flag, and the
   markdown-only branches. Unblocks the plain-text-formats item and is the canvas seam.
   **Done 2026-08-10.**
3. **Projects as location** — unify notes-root and linked projects, add the
   where-does-it-live prompt to creation. **Done 2026-08-11.**
4. **Mounts** — resolution both ways, explorer marking, the context-menu entry.
   **Done 2026-08-11.**
5. **`files` patterns** — the default is already the behavior, so this is the override path
   plus the floor. **Done 2026-08-11.**
6. **Consumers**: the MCP grant and `board.canvas` land on top, each in its own item.

### What steps 1–2 taught (2026-08-10)

- **A hand-editable file needs a failure mode.** One typo in `settings.json` would
  otherwise take the whole app down, since the backend needs the registry to list anything.
  A parse failure now falls back to the shipped defaults, reports the message once, and
  **refuses writes** — so the file the user has to fix is never overwritten by defaults.
- **Model the whole schema before consuming any of it.** `mounts` and `mcp` are parsed and
  written back untouched from the start; a struct that only modeled what it consumed would
  have silently deleted a hand-edited mount on the next appearance write.
- **`notesRoot` is deliberately not written yet.** Honoring a hand-edited root is a real new
  capability with no UI, no validation, and no answer for notes already under the old root;
  writing a key the code ignores would be worse. It belongs with the Settings rework.
- **The registry reaches the frontend in the startup round trip it already made**, so no
  setting sits in front of the first frame: nothing consults it before `open` is set, which
  happens after those awaits. Chrome sees a reload on the next render; the editor sees it on
  the next open, because its extensions are chosen at mount.
- **Appearance writes are per change, not batched.** The read-modify-write happens under the
  settings lock, so a fast series (a Ctrl+scroll zoom gesture) can't leave the older value
  on disk.

### What step 3 taught (2026-08-11)

- **Creation was never a thing.** "New project" was a name box that _moved the open note_,
  and the folder existed only because `move_note` created it on the way past. So the
  where-does-it-live prompt could not be bolted onto the old flow; the flow had to be
  written. Creating and filing are now separate: creation makes the project and nothing
  else, and "Move to project" — which already existed in the palette — files a note into
  it. The three entry points that all reached the old name box (File menu, palette,
  explorer context menu) now genuinely create, which is what the explorer's entry always
  looked like it did.
- **A location inside the notes root is the id-collision bug, reachable by hand.** Nothing
  stopped a linked folder from sitting under the notes root, and a file below it then had
  two valid ids — one from the root walk, one through the project — which is two shadow
  drafts and two tabs that overwrite each other. Latent before (a scan of the notes folder
  could do it), one click away once a picker exists. `outside_root` now refuses it at
  creation and at repoint, where the user can be told why. This is the same class of bug
  the cost list flags for mounts, arriving one step early.
- **The unification is mostly naming, because step 1 already did the data.** What was left
  was the vocabulary: `add_external_projects`/`set_external_path`/`remove_external_project`
  became `link_projects`/`set_project_path`/`unlink_project`, and Settings shows one
  **Projects** table where the location — a path, or "In the notes folder" — is the only
  thing that distinguishes them. Naming a _kind_ of project was the last place the model
  still said there were two.

### What step 4 taught (2026-08-11)

- **"The real folder wins" is a rule three walks have to share.** Resolution, the listing
  walk and the search corpus each decide independently whether a mount is live, so all three
  now ask the same question (`own.join(at).is_dir()`) — and the frontend, which cannot stat
  anything, is told the answer instead of deriving mounts from the settings document. That
  is what `list_mounts` is for: it carries `conflicted` alongside each mount, and both the
  explorer's marker and the frontend's half of resolution key off it. Deriving the table
  from `settings.json` would have been one fewer command and a mount that resolves to a
  folder the backend refuses to read from.
- **The overlap guard generalized, and caught a case step 3 missed.** `outside_root` became
  `disjoint` plus `check_location`: the notes root, every project location and every mount
  path must be pairwise unrelated, since one folder containing another is the whole bug
  class. Step 3 only checked that a location was not _inside_ the root — a location
  _containing_ the root was allowed, and would have given every note two ids.
- **Mount points may not nest either.** Two mounts where one `at` prefixes the other put the
  files under the inner one inside both, which is the same bug reached through the `at` side
  rather than the path side. Refused at creation, like the rest.
- **The four base directories really did collapse.** `assetLink`'s "climb _n_ levels" count
  became a relative path from whatever base the note resolved through — shorter, and the
  only version that can be right for a mount, where the number of levels has nothing to do
  with the id's depth.
- **A walk now starts at the depth its id prefix already spent**, so `MAX_DEPTH` bounds the
  whole id. Before, a file 12 levels inside a linked project was listed with a 13-segment id
  that `checked_name` then refused to open. Mount points are capped at four segments at
  creation for the same budget, where the refusal can be explained.
- **Left deliberately:** Settings shows projects but not their mounts — the explorer's
  context menu is the only surface, since that is where the folders are. Detaching still
  orphans drafts filed under the mount's ids, the same trade unlinking a project makes, and
  it should get the same answer whenever that one is settled.

### What step 5 taught (2026-08-11)

- **The engine is the promise.** "`.gitignore` pattern syntax" was the documented
  contract, and anchoring, negation and dir-only patterns are exactly where a
  hand-rolled subset quietly diverges from what a user's git intuition predicts. So the
  matching is the gitignore matcher from the `ignore` crate — a handful of small
  pure-Rust crates, most of whose tree was already in the lock — not a reimplementation.
  (Not the ~40-crate search stack the search item rejected; that was the other half of
  that library.) One faithfulness datum worth keeping: the engine rejects almost no
  pattern — an unclosed `[` is taken literally, exactly as git's matcher takes it — so
  the skip-and-report path for bad lines exists but rarely fires.
- **The rules had to reach the id checks, not just the walks.** The obvious wiring is
  the listing walk; the near-miss is that `checked_name` guards _every_ open, save and
  draft with the registry allowlist, so a re-included `.rs` would have been listed but
  unopenable — and its shadow draft unwritable. The "is this id a note" question now has
  the same two-part answer everywhere: allowlist, or the owning project's re-include
  (subject to the floor). Same lesson as resolution-and-inverse: a rule read in one
  place and not another isn't a rule.
- **The floor is checked twice on purpose.** At the walk (a re-included file over the
  size cap is not listed) and at the id check (it is not openable either) — because the
  id path doesn't go through the walk, and the floor's whole point is that a pattern in
  a pulled config can't make the app touch what it would otherwise refuse.
- **Matching is case-insensitive**, like extension matching and the `disjoint` check —
  chosen for consistency with how the rest of the app treats paths and with the
  filesystem underneath, over git's default-sensitive behavior.
- **A broken portable file fails visibly but locally.** Same shape as the
  `settings.json` lesson, different channel: the walks fall back to default rules (one
  typo must not blank a project's listing, and `list_notes` has no error slot worth
  growing), and a `project_config_errors` command re-collects the parse problems for
  the frontend to toast on the focus re-sync it already does.
- **Scan counts got honest for free**: `count_md` reads a candidate folder's own config,
  so the scan sheet's number matches what linking the folder would actually list.
- **Left deliberately:** `list_drafts` keeps default rules — matching each draft id
  against its project's rules would cost a config read per segment, and the gap (a
  draft of a re-included non-allowlist file missing from Recent) is recorded rather
  than paid for. The frontend's `isNoteFile` doesn't know patterns either, so
  Ctrl+Clicking an absolute path to a re-included file opens it externally — knowing
  would take an IPC ask in a hot path. And nothing writes the file yet: hand-edit only,
  until the settings rework gives it UI.

## Migration

- `external_projects.json` → `projects` in `settings.json` on first launch (a name → path
  map becomes entries with `path` and no mounts); the old file is removed after a
  successful write.
- `localStorage` keys stay where they are and become the boot mirror described above; the
  theme setting gains its home in `settings.json` without losing its pre-paint read.
- No project file is created by migration. Existing projects keep default rules until
  someone changes something.

## Rejected

- **One file in app data, holding everything.** Zero footprint in user repositories and no
  trust boundary to reason about — genuinely the simplest build. Rejected because nothing
  is shareable: a team cannot ship "these are the docs, this is the board" with the
  repository, and a board nobody else can read undercuts the whole reason for choosing an
  open canvas format.
- **One file in the project, holding everything.** The purest reading of files-are-the
  contract. Rejected because a config arriving by `git pull` would carry an MCP grant, and
  because absolute mount paths are wrong on every other machine.
- **Per-file membership lists.** The manifest already rejected in
  [folders are projects](decisions/2026-08-07-folders-are-projects.md); folder-granular
  mounts get the same result without a second source of truth about where a note belongs.
- **Default exclusions as `.gitignore` patterns.** See above — the deny-all-but idiom is a
  foot-gun for the one set every user inherits.
- **Declaring type or membership in frontmatter.** Stamps app metadata into user-owned
  files, rejected for grouping before and no better here.
- **A view plugin API.** Settled with the canvas design: the registry is data, views are
  in-tree, and loading third-party code into a resident tray process is in tension with
  the no-unrequested-network stance.

## Open / deferred

- **Multi-workspace level** — revisit with cloud share or team sync.
- **Single-file mounts** — deliberately out; revisit only if "attach exactly one note"
  turns out to be common enough that a containing folder is real friction.
- **Read-only mounts** — plausible for reference material; no demand yet.
- **Project rename** — needs the id-rewrite pass described above.
- **Watching config files** — focus-based re-read for now, on purpose; a watcher is idle
  footprint.
- **Scan sheet note counts** under these rules — answered 2026-08-11 with step 5: counts
  follow the same walk the listing uses, config included. (Whether counts should reflect
  the docs/ subtree a scanned repo will actually root at is the part still open, in
  TODO.md.)

## Links

- [Markdown files are the store](decisions/2026-08-06-markdown-files-are-the-store.md) —
  the invariant this model has to satisfy, including "must not assume all notes live under
  one folder".
- [Folders are projects](decisions/2026-08-07-folders-are-projects.md) — existence stays
  filesystem-derived; this doc adds attributes, not a manifest.
- [External projects linked in place](decisions/2026-08-07-external-projects-linked-in-place.md) —
  becomes the degenerate case of location plus mounts.
- [TODO.md](TODO.md) — the canvas, settings-rework, virtual-folders, explorer-context-menu,
  and MCP items that defer here.
- Key files this will touch: [`src-tauri/src/notes.rs`](../src-tauri/src/notes.rs)
  (resolution, listing, registry read), [`src/paths.ts`](../src/paths.ts) (type lookups),
  [`src/Explorer.tsx`](../src/Explorer.tsx) (mount rows),
  [`src/Settings.tsx`](../src/Settings.tsx) (registry and per-project UI).
