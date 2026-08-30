# asapnotes over MCP

An MCP stdio server that lets an agent read, search and edit your notes through
the same project model the app itself uses.

Two pieces:

- **`asapnotes-mcp`** — a small Rust binary built from the app's own crate. It
  is the only thing that touches the corpus, and it is where access is enforced.
- **this package** — the stdio MCP server. Protocol plumbing; it shells out to
  the helper for everything.

The split is the design, not an accident. The project model — the notes root,
per-project locations, mounts, and each project's `files` rules — decides what a
caller may _see_. A second implementation of that in TypeScript, drifting from
the Rust one, would not be a display bug; it would be an access-boundary bug. It
also means the server process, which your agent's client spawns and therefore
controls, enforces nothing: grants and the write pin live below it.

## Setup

Step by step, including granting access and wiring a client: **[SETUP.md](SETUP.md)**.
The short version:

```bash
# 1. Build the helper (from the repo root)
cargo build --manifest-path src-tauri/Cargo.toml --release --bin asapnotes-mcp

# 2. Build the server
cd mcp && npm install && npm run build
```

Then point a client at it. For a client using the usual `mcpServers` JSON:

```json
{
  "mcpServers": {
    "asapnotes": {
      "command": "node",
      "args": ["C:/path/to/asapnotes/mcp/dist/src/index.js"],
      "env": {
        "ASAPNOTES_MCP_HELPER": "C:/path/to/asapnotes/src-tauri/target/release/asapnotes-mcp.exe"
      }
    }
  }
}
```

`ASAPNOTES_MCP_HELPER` is optional if the binary is on `PATH` or sits beside the
server; during development the server also looks in `src-tauri/target/debug`.

Check it before wiring a client to it:

```bash
echo '{}' | ./src-tauri/target/release/asapnotes-mcp doctor
```

That prints the notes root, the `settings.json` it read, and the grant on every
project. **Run it whenever results look wrong.** The one failure mode this design
can't make obvious by itself is resolving a _different_ corpus than the app: it
answers every question politely and wrongly. The app publishes its own notes root
into `mcp-state.json` and the helper prefers that, so this should agree — `doctor`
is how you confirm it does.

## Access

Nothing is writable, and nothing outside your notes folder is even visible, until
you say so. Grants live in `settings.json` (in app data), never in a project file
— a project you cloned cannot widen what the sidecar can reach.

<!-- prettier-ignore -->
```jsonc
{
  "projects": {
    "work": { "mcp": "write" },        // read and edit
    "reading": { "mcp": "read" },      // read only
    "client-repo": { "mcp": "off" }    // does not exist to the sidecar
  },
  "mcp": {
    "notesRoot": "read",   // default for projects in the notes folder
    "linked": "off",       // default for projects linked from elsewhere
    "writeScope": "any",   // or "current" — see below
    "settings": "off"      // access to settings.json itself
  }
}
```

| Grant   | What it means                                                                         |
| ------- | ------------------------------------------------------------------------------------- |
| `off`   | The project **does not exist** to the sidecar: not listed, not searched, not readable |
| `read`  | Every read tool works; writes are refused with the reason                             |
| `write` | Everything                                                                            |

`off` is absent rather than forbidden on purpose. Refusing a read with "you lack
permission for project X" would confirm that X exists and what it is called, so
an `off` project answers exactly what a note that was never there answers.

Grants are re-read from disk on **every call**, so revoking one in `settings.json`
takes effect immediately — not whenever a long-running agent happens to restart.

### Pinning writes to what you are working on

Set `mcp.writeScope` to `"current"` and writes only land in the project the app
currently has open. Everything else stays readable; an edit aimed elsewhere is
refused by name. The app publishes which project that is as you move between
tabs, so the pin follows you.

An agent cannot turn this off. The `mcp` block is the one part of `settings.json`
that `write_settings` refuses outright — a tool that can widen its own grant does
not have a grant.

## The tools

Reading, cheapest first:

| Tool            | For                                                         |
| --------------- | ----------------------------------------------------------- |
| `find_notes`    | By name. Opens no files                                     |
| `search_notes`  | By content. Every hit names the heading path it fell under  |
| `list_notes`    | The corpus; with `outline: true`, every note's heading tree |
| `outline_note`  | One note's heading tree                                     |
| `read_note`     | A whole note, or one **section** of it                      |
| `list_projects` | What is visible, and at what grant                          |
| `doctor`        | What this process resolved                                  |

Writing:

| Tool             | For                                                             |
| ---------------- | --------------------------------------------------------------- |
| `write_section`  | Replace one heading's body                                      |
| `append_to_note` | Add to a note or a section — **and create a note**, in one call |
| `write_settings` | A JSON merge patch, never touching `mcp`                        |
| `append_todo`    | A correctly shaped TODO item under today's heading              |
| `new_decision`   | A dated decision entry from the template                        |

The three that can return many rows — `find_notes`, `search_notes`, `list_notes` —
answer with `{ notes | hits, truncated }` rather than a bare array. `truncated`
means more matched than came back, so an agent can tell "that is all there is"
from "that is all you asked for" and narrow or raise `limit` instead of
concluding the corpus is small. `list_notes` with `outline: true` defaults to a
much lower limit than without, and stops on accumulated size as well as on
count: a heading tree per note over a whole corpus is one of the largest answers
this surface can produce.

A rule those three share, and the reason the limit is applied where it is: **a
note the caller may not see never spends a result slot.** The grant decides what
gets searched, not what survives the search. Filtering afterwards let a project
that is `off` consume the whole budget and return a nearly empty answer — a
corpus that looks small rather than a boundary that says no, which is exactly
the failure this design exists to prevent. It also leaked: results arriving
short of a limit that a larger limit then exceeded implied something unseen was
there.

Two things shape all of it:

**Sections, not files.** A note is addressed by heading path — `"Decisions"`, or
`"Design/Decisions"` when that is ambiguous, or `""` for the preamble. A name
that matches nothing or matches twice is an error **listing the candidates**,
never a guess, because a guess writes into the wrong part of someone's file.
Reads take a section, writes replace one, and a listing carries heading trees, so
an agent that wants two paragraphs never has to carry the whole note.

**No whole-file write.** `write_section` plus `append_to_note` covers what agents
need, and a replace-the-file call is the one shape that can silently destroy work
the agent never read.

`expectUnchanged` is the mtime a read hands back. Pass it on the write and a file
that moved in between refuses the write instead of clobbering it. The user may
well be typing in that file right now.

## The convention layer

`asapnotes://convention` is a resource describing the working pattern this repo
uses — a live `TODO.md`, dated `decisions/` entries that answer "why is it like
this?" — plus three prompts (`add_todo_item`, `draft_decision`, `catch_up`).

`append_todo` and `new_decision` grant nothing extra. They compose the same calls
an agent could make itself, so that the common case is one call with the right
shape instead of a free-form section write that gets it subtly wrong.

## What is not here

- **Deletes and renames.** Destructive, and the recycle-bin safety net is in the
  app. A later slice, with the same `expectUnchanged` discipline.
- **A whole-file note write.** Deliberately, as above.
- **Reads in the log.** Writes are logged to `mcp-calls.jsonl` in app data — one
  line each, with the tool and the section. Reads are not: a record of every read
  would be a surveillance log of the user's own notes, and it answers no question
  the user asked.

## Tests

```bash
npm test    # builds, then runs against the real helper binary
```

They drive a real MCP client over a real server over the real Rust binary against
a corpus in a temp directory. Nothing is mocked, because the seams are what break.
The Rust side has its own suite: `cargo test --manifest-path src-tauri/Cargo.toml`.
