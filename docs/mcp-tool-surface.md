# asapnotes — MCP tool surface

_2026-08-19. Design doc, written before the code. The MCP sidecar item (2026-08-06) and
three asks that queue behind it defer to this; it is the answer they were waiting for._

**Built the same day — all six build-order steps, plus canvas and settings tools the
first pass had deferred.** The code is `src-tauri/src/corpus/` (the shared core),
`src-tauri/src/bin/asapnotes-mcp.rs` (the helper), and `mcp/` (the stdio server); setup
and the grant table live in [mcp/README.md](../mcp/README.md). What the implementation
taught us is recorded in **[What changed in the building](#what-changed-in-the-building)**
at the foot of this file — read that before trusting a detail above it.

## What this settles

| Deferred question                                | Answer                                                                                | Section                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| How the sidecar reaches the corpus               | A **Rust helper binary** from the same crate; the project model stays single-sourced  | [How the sidecar reaches the notes](#how-the-sidecar-reaches-the-notes) |
| Token economy without a new serialization        | Outline listing, **section-addressed** reads and writes, excerpt search               | [The tools](#the-tools)                                                 |
| How a section is named                           | **Heading path**; ambiguity is an error that lists candidates, never a guess          | [Section addressing](#section-addressing)                               |
| How the grant is enforced                        | In the helper, per call, re-read from disk; `off` projects don't exist to the sidecar | [Grants](#grants-are-enforced-in-the-helper)                            |
| Whether MCP edits are attributable               | The sidecar keeps its **own tool-call log**; the snapshot store stays two-origin      | [Attribution](#attribution-and-the-change-log)                          |
| How agents learn the TODO / decisions convention | A resource plus prompts, plus `append_todo` and `new_decision` as real tools          | [The convention layer](#the-convention-layer)                           |

Settled elsewhere and not reopened here: the grant's shape and placement
(`"mcp": "off" \| "read" \| "write"`, personal file only) come from
[config splits by trust](decisions/2026-08-10-config-splits-by-trust.md) and
[project-model.md](project-model.md); that a project's `files` rules are an **access
boundary** and not a display filter comes from the same place; markdown stays the wire
format per [markdown files are the store](decisions/2026-08-06-markdown-files-are-the-store.md).

## How the sidecar reaches the notes

**A TypeScript stdio MCP server that shells out to a small Rust helper binary built from
the existing crate.** The helper answers corpus questions (`list`, `read`, `search`,
`write`) as JSON on stdout; the server is protocol plumbing, argument validation and the
convention layer.

The reason is narrow and worth stating plainly: **the project model must have exactly one
implementation.** Resolving a note id means the notes root, per-project locations, mounts,
and the `files` pattern list — and because those patterns decide what the sidecar may see
at all, a second implementation in TypeScript that drifts from `notes.rs` is not a display
bug, it is an access-boundary bug. A helper binary reuses the real code.

_Rejected:_ **direct filesystem access** from TypeScript (simplest, app-independent, but
it is exactly the duplicated-project-model hazard above); **talking to the running app**
over a loopback listener (writes would flow through the app's own save path, which would
give history capture and a real origin tag for free, but it adds a listening socket to a
process whose stated virtue is being auditably quiet, and it makes every read depend on
the app being up — the sidecar should work while the app is closed).

### What this costs the existing code

The corpus functions currently take `AppHandle` and get their two roots from it
(`document_dir()/asapnotes` for the notes root, `app_data_dir()` for `settings.json`,
drafts and history). A helper binary has no `AppHandle`, so:

1. Extract the corpus logic into a plain-Rust core whose entry points take explicit roots
   (`notes_root: &Path`, `app_data: &Path`). The Tauri commands become a thin layer that
   passes what `AppHandle` already gives them; behavior does not change.
2. The helper resolves the same two directories through the same OS known-folder calls,
   with `--notes-root` / `--app-data` overrides for tests and unusual setups.

**The hazard to design against, because it fails silently:** if the helper resolves a
different `settings.json` than the app, it serves a different corpus and nothing looks
wrong. (This is not hypothetical — environment overrides like `APPDATA` do _not_ move
Tauri's own resolution, which goes through the Windows known-folder API.) Mitigation: a
`doctor` subcommand that prints the resolved roots, the settings file it read and the
grants it found, so a mismatch is one command away from being visible; and the server
runs it once at startup, failing loudly rather than serving an empty corpus.

## Section addressing

A section is named by its **heading path** — the heading's own text, or a `/`-joined path
when nesting is needed to disambiguate:

```
"Decisions"                  # the only heading with that text
"Design/Decisions"           # the "Decisions" under "Design"
""                           # the note's preamble, before any heading
```

Resolution is exact-text, case-insensitive, on the parsed heading tree. A path matching
nothing, or matching more than one heading, is an **error that lists the candidates** —
never a guess. A section's extent runs from its heading line to the next heading of the
same or shallower depth, so a section read includes its subsections, and a section write
replaces them.

_Rejected:_ **injected anchors or ids** (they would write app bookkeeping into files the
user owns — the store decision forbids it); **line ranges** (they rot on the first edit
by anyone, which is precisely the concurrent-edit case section addressing exists to
survive).

Fenced code blocks are skipped when parsing headings — a `#` inside a fence is not a
heading, and a note about markdown would otherwise address itself wrongly.

## The tools

Six corpus tools, plus the two convention tools below. Names are the wire names.

| Tool             | Grant   | Arguments                                         | Returns                                                                    |
| ---------------- | ------- | ------------------------------------------------- | -------------------------------------------------------------------------- |
| `list_projects`  | `read`  | —                                                 | Visible projects: name, whether it is in the notes root, note count, grant |
| `list_notes`     | `read`  | `project?`, `outline?`                            | Note ids with mtimes; `outline: true` adds each note's heading tree        |
| `read_note`      | `read`  | `note`, `section?`                                | Whole note, or one section's text plus its heading path and depth          |
| `search_notes`   | `read`  | `query`, `project?`, `limit?`                     | Hits: note, line, excerpt, and the heading path the line falls under       |
| `write_section`  | `write` | `note`, `section`, `content`, `expect_unchanged?` | The replaced extent, and the note's new mtime                              |
| `append_to_note` | `write` | `note`, `content`, `section?`                     | Where it landed (end of note, or end of that section)                      |

Three shapes in that table are the whole token-economy answer, and each one is a decision:

- **`outline` on the listing.** A corpus listing that carried content would be unusable at
  any real size; a listing that carries the heading trees lets an agent find the section it
  wants and then read only that. This is the "outline/TOC-level listing" the item asked for.
- **`section` on the read.** The cheap read is the normal read.
- **`expect_unchanged` on the write** — an optional mtime the caller got from a read. When
  it is supplied and the file has moved on, the write is refused with the current mtime
  instead of clobbering. This is how a section-targeted write survives a concurrent human
  edit, and it is opt-in so a fire-and-forget append stays one call.

**No `write_note` that replaces a whole file.** Section-addressed writes plus append cover
what agents need, and the whole-file write is the one call that can silently destroy work
the agent never read. Left out deliberately; if it turns out to be needed, it needs
`expect_unchanged` as a **required** argument, not an optional one.

**Creation** rides `append_to_note` on a note id that does not exist yet (it creates the
file, so an agent needs one call, not two) — but only inside a `write`-granted project,
and only for a path the project's `files` rules would list.

Every tool takes and returns **note ids**, never absolute paths — the same ids the app
uses (`project/sub/note.md`). Absolute paths never cross the protocol boundary in either
direction: they are machine-specific, and a path-shaped argument is the obvious way to ask
the sidecar to read something it was never granted.

### What is deliberately not here yet

- **Canvas reads and edits** (its own ask, 2026-08-16). The grant model extends
  unchanged; the open question is tool shape — raw JSON versus structured verbs — and it
  wants its own pass rather than a hurried `read_note` that returns JSON.
- **Deletes and renames.** Destructive verbs, and the recycle-bin net is in the app.
  A later slice, with the same `expect_unchanged` discipline.
- **Settings reads.** The item's "later readable over MCP" note stays later; `settings.json`
  holds every machine path on the box, and there is no agent task yet that needs it.

## Grants are enforced in the helper

Every call resolves the target's project and checks that project's grant, **re-read from
`settings.json` on each call** — a grant the user just revoked in Settings must not stay
open for the lifetime of a long-running agent process.

- Absent or `off` — the project **does not exist** to the sidecar. It is not listed, its
  notes are not searchable, and a direct `read_note` on one of its notes gets the same
  "no such note" a nonexistent id gets. Refusing with "you lack permission for project X"
  would leak the project's existence and name; absent is absent.
- `read` — the read tools work; write tools refuse with the reason (that a note exists is
  already known to the caller, so this one says what it is).
- `write` — everything in the table.

The default is `off` for anything linked from outside the notes root, per the project
model. Two consequences worth holding onto: a project's `files` rules bound what the
sidecar sees inside a granted project (exclusions are an access boundary), and no file in
any repository can widen the sidecar's reach, because the grant is not in a project file
at all.

## Attribution and the change log

The snapshot store tags snapshots `app` or `external` (`history.rs`). A helper binary
writing a file directly is, correctly, an external edit: the app's focus scan finds it and
the changes view shows it as "not this app".

**The sidecar keeps its own append-only tool-call log** in app data — one line per write
call: when, which tool, which note, which section, and a one-line summary. That is the
finer attribution the change-log ask wanted, and it carries what an origin tag never
could (which section, which tool). The changes view can later read it to badge an external
edit as `mcp` by matching note and timestamp; that is the ask's own "filter/origin badge on
the existing changes view" lean, and it needs no new origin in the store.

Read calls are not logged. A log of every read would be a surveillance record of the
user's own corpus, and it answers no question the user asked.

## The convention layer

The docs pattern in this repo — [TODO.md](TODO.md) as the live working file,
[decisions/](decisions/README.md) as dated entries answering "why is it like this?" — is
the thing agents most need taught, and it is what makes them useful in any project that
adopts it.

Three pieces, smallest surface that actually works:

1. **A resource** (`asapnotes://convention`) stating the pattern: what belongs in TODO
   versus a decision entry, the bar for an entry ("answers why is it like this", not
   routine fixes), that finished items get promoted and task noise deleted, and the
   dated-entry format.
2. **Prompts** — "add a TODO item", "draft a decision entry" — so a client can offer the
   workflow rather than the agent inventing the shape.
3. **Two thin tools**, because these are the writes agents actually attempt and the ones
   where free-form section writes go wrong:
   - `append_todo(project, text, date?)` — appends a correctly shaped item under the
     current date heading in that project's TODO file, creating the heading if the date
     is new. Defaults to today.
   - `new_decision(project, title, context, decision, consequences?, status?)` — writes
     `decisions/<date>-<slug>.md` from the template, refusing rather than overwriting when
     the slug is taken.

Both are ordinary `write`-grant tools, both go through the same helper, and both are
skippable: an agent that prefers `write_section` gets the same files. They exist to make
the common case one call with the right shape.

**ADR/MADR alignment** (the item's (c)) stays _loose_ and lands here rather than in a
docs migration: `new_decision` writes the fields the standards share — Status, Context,
Decision, Consequences, plus a superseded-by link when given — which is close to what the
existing entries already do in prose. Existing entries are **not** rewritten; the
convention resource describes both shapes, and the standard-shaped fields are what new
entries get. Restructuring eight good entries to match a template would be churn against
the one thing they are for: being read.

## Build order

_All six done, 2026-08-19._

1. **The core extraction** — corpus logic takes explicit roots; Tauri commands become the
   thin layer. No behavior change, existing tests carry it.
2. **The helper binary** — `list`, `read` (with `--section`), `search`, `doctor`; grants
   enforced from the first read command, since `off`-means-absent is easier to build in
   than to retrofit.
3. **The server, read-only** — stdio MCP over the helper: `list_projects`, `list_notes`,
   `read_note`, `search_notes`. Point a real client at it before writing a single write
   tool; the tool shape is a guess until an agent has used it.
4. **Writes** — `write_section`, `append_to_note`, `expect_unchanged`, the tool-call log.
5. **The convention layer** — resource, prompts, `append_todo`, `new_decision`.
6. **Settings → MCP section** (its own item) — the setup snippet, the grant table, and
   what "status" can honestly mean for a stdio server the app does not spawn: the last
   tool-call log entry, which is a fact we have, rather than a connection state we do not.

## Open questions

- **Distribution.** The helper is a second binary to build and ship; whether it rides the
  installer or is built by whoever configures the sidecar is unanswered, and it decides how
  the setup snippet in Settings reads.
- **Grant reads at process start versus per call.** Per call is specified above and is the
  safe answer, but it means a `settings.json` read per tool call; if that shows up as
  latency, an mtime-gated cache is the fix, not a longer-lived grant.
- **`files`-rule evaluation cost** on large granted repositories, for search especially.
  The app pays this on its own listing walk today, so it is measurable before it is a
  design change.
- **Multiple clients.** Two agents writing the same section with `expect_unchanged` behave
  correctly (the second is refused); two agents appending race benignly. Nothing needs a
  lock yet, and a lock is the wrong first answer if it turns out it does.

## What changed in the building

Written after the code, and it supersedes the sections above where they disagree.

### The two roots stopped being a guess

The design had the helper resolving the same directories through the same OS
known-folder calls and a `doctor` subcommand to make a mismatch visible. That is still
true — the helper takes `dirs v6`, pinned to the version Tauri itself resolves paths
through — but the failure mode was too quiet to leave at that. So **the app now publishes
its own resolved notes root** into `mcp-state.json`, and the helper prefers it over
anything it would work out for itself. `doctor` reports which of the two it used
(`notesRootSource`).

That leaves only app data resolved independently, which is a much smaller target, and
`--notes-root` / `--app-data` remain the escape hatch.

### `write_section` keeps the heading line

The design said a section's extent runs from its heading line and a write replaces it.
Implemented that way, every write has to re-send the heading — and the first one that
forgets deletes it. So `content` is the **body** under the heading and the heading line
survives; the extent still runs through the section's subsections, so replacing a level-2
section still replaces the level-3s inside it. Blank lines around the new body are
normalized, which is what keeps a heading from ending up glued to the paragraph above it.

### Two grant defaults, not one

"Default `off` for anything linked from outside the notes root" left the in-root case
unstated. It is now two settings with two different answers, because they are two
different kinds of trust: `mcp.notesRoot` defaults to **`read`** (the app's own folder —
reading it is what a sidecar is _for_), and `mcp.linked` defaults to **`off`** (somebody's
repository that the user pointed at). Writing always has to be asked for either way, and
an unrecognized grant string reads as `off` so a typo fails closed.

### The write pin, which the design didn't have

`mcp.writeScope: "current"` confines writes to the project the app is currently on;
everything stays readable. The app publishes the current project as the user moves between
tabs — in `mcp-state.json` rather than `settings.json`, because it changes on every tab
switch and configuration should not churn under a file the user hand-edits.

Order matters and is tested: the **grant is checked before the pin**, so an `off` project
still answers "no such note" rather than admitting it exists but is out of scope. And the
pin is not something an agent can lift — `write_settings` refuses the whole `mcp` block
rather than validating it field by field, so adding a key there can never leave a writable
hole.

### Canvas and settings tools, which "not here yet" said would wait

Both were built, because both were asked for.

**Canvas** resolved its open question (raw JSON versus structured verbs) as _both, split by
direction_. `read_canvas` returns a summary — nodes with type, position and content, edges
with labels, and for ink a stroke **count** — because a drawn board carries tens of
thousands of coordinates that mean nothing to a reader; `raw: true` hands over the document
for a caller that means to edit it. `write_canvas` takes the whole document and validates
it first (unique ids, every edge pointing at a node that exists, a rectangle on every
node), reporting every problem at once. Unknown node types and unknown fields ride through
untouched — a conforming reader skips what it doesn't know, and refusing would make this
the one tool that can't round-trip a file another tool wrote.

This is the one **whole-file write** in the surface, since a canvas has no sections to
address. So it carries the discipline the note tools left optional: overwriting an existing
canvas **requires** `expect_unchanged`. Creating a new one does not, there being nothing to
lose.

**Settings** stayed as cautious as the original note implied but became reachable: one
`mcp.settings` grant, defaulting to **`off`**, because that file names every machine path
on the box. Writes are an RFC 7386 merge patch — chosen over a set-a-key-by-path tool
because a path syntax is a second addressing scheme to specify and get wrong — validated by
round-tripping through `Settings` before anything is written, so a patch that would leave
the app unable to read its own configuration is refused with the parse error rather than
discovered on next launch.

### Two searches, because they cost different amounts

The design had one `search_notes`. Finding things turned out to be two questions:
`find_notes` matches note **ids** and opens nothing, and `search_notes` reads contents.
Content search is still a plain scan with no index — the reason stands, and an index would
have to be kept honest against every other tool that edits these files — but it narrows
before reading: a `project` filter drops files without opening them, a whole-file check
skips the per-line pass on files that can't match, and a `per_note` cap stops one long file
from eating the whole result. Every hit names the heading path it fell under, which is what
makes the next call a section read.

### The extraction paid for itself in tests

`notes.rs` had **zero** tests before this, because everything took `AppHandle`. Moving 460
lines into `corpus/` took the suite from 36 to 110, and the new ones cover what had only
ever been checked by running the app and looking: id resolution through mounts, a real
folder shadowing a mount, `files` rules as an access boundary, and — the ones worth having
— that an `off` project's refusal is byte-identical to a missing note's, that a pin never
widens a grant, and that reads are never logged. A test greps the module for `tauri` so the
boundary is checked rather than trusted.

**One latent panic was found while moving code**, not introduced by it: `excerpt` sliced a
line at a byte offset found in a _lowercased_ copy of it, and case folding can change a
character's byte length — so a long line containing certain non-ASCII characters could have
panicked on a non-boundary slice. It now walks back to a boundary.

### The limit was spent on notes the caller could not see

Found by pointing a real client at a corpus of realistic size (361 notes), which is the
one thing the test suite could not do: its fixtures hold fewer than ten notes, so no
result limit ever binds and this was invisible.

`search_notes` and `find_notes` capped at `limit` **and then** filtered by grant. So a
project that is `off` spent the budget it was not allowed to appear in: on that corpus,
`search_notes "the" limit 50` returned **3 hits** instead of 50, and `find_notes "e"
limit 30` returned **2** instead of 30. Both answered as if the corpus were nearly
empty — the exact failure this whole design is built to avoid, and worse than a refusal
because nothing looks wrong. It was also a side channel: an answer arriving short of its
limit that a larger limit then exceeded says something unseen is there, which is the one
thing an `off` project is supposed never to admit.

The fix pushes visibility **into** the walk, as a `Visible` predicate that is a
parameter rather than a field on `Query` — so no call site can search without deciding,
which is how the boundary went missing in the first place. The app passes `None`; it
shows the user their own corpus. `list_notes` had always done this correctly, which is
much of why the other two looked reviewed.

Three tests hold it: a hidden project cannot starve a visible one, raising the limit
cannot be used to probe for it, and a clipped result says so.

### Long answers say when they were clipped

The same session found `list_notes { outline: true }` returning **226 KB — about 57k
tokens — in a single call** over that corpus, from a tool whose description recommends
it. Outlining now defaults to a much lower note limit than a plain listing and stops on
accumulated bytes as well as count.

And the three list-shaped tools now answer `{ notes | hits, truncated }` instead of a
bare array. A bare array of exactly `limit` rows cannot be told from a corpus that holds
exactly that many, so an agent had no way to know it was looking at a page rather than
an answer. The count is taken by asking the core for one row past what the caller wanted,
so `truncated` is a fact rather than an inference from the length.

### Answers to the open questions

- **Distribution** — settled: the helper **ships with the app**, so using the sidecar
  needs no toolchain. It needs no bundle configuration to do so, which was not
  obvious: the helper is a second `[[bin]]` of the app's crate, the release build
  compiles it, and the bundler ships every binary the crate builds. Verified by
  extracting the MSI a plain `npm run tauri build` produced — `asapnotes-mcp.exe`
  installs beside `asapnotes.exe`. A staging script plus a merged bundle config
  declaring it as a resource was built first and then deleted; it shipped the binary
  a second time, and a resource declaration has to be satisfied at _compile_ time,
  which breaks `cargo build`, `cargo clippy` and `tauri dev` in a fresh checkout.
  `mcp_status` reports `helperPath` and `helperExists` so Settings can print a path
  to paste rather than a command to run, and can tell an installed app from a dev
  tree where nothing sits beside the executable.
- **Per-call grant reads** — kept, and it is a `settings.json` read per call. No latency
  problem has shown up at this corpus size; the fix, if one appears, is an mtime-gated
  cache and not a longer-lived grant.
- **`files`-rule cost** — unmeasured. The `project` filter on search reduces how often it
  matters, and the app pays the same cost on its own listing walk.
- **Multiple clients** — unchanged, and nothing was added. Two agents with
  `expect_unchanged` behave correctly; two appending race benignly.

### Still not here

Deletes and renames, and a whole-file note write. Both for the reasons already given
above, both unchanged by building the rest.
