# The MCP server shells out to the Rust helper

- Date: 2026-08-19
- Status: Built (design and code the same day; extended since with workspaces, note
  creation and moves, and meeting control)

## Context

The MCP sidecar lets any agent client list, read, search and write the notes. Resolving a
note id involves the notes root, each project's location, its mounts and its `files`
patterns, and those patterns decide what a caller may see at all. The grant was settled on
2026-08-10 as `off` / `read` / `write` per project, kept in the personal `settings.json`
so no file in a repository can widen it. The token question was settled before that: no
compact serialization for agents, since markdown is what they read best, so the savings had
to come from the shape of the tools.

## Decision

**The project model has one implementation.** [`mcp/`](../../mcp/README.md) is a
TypeScript stdio server on the official SDK, its own npm package so the app's dependencies
and summon latency are untouched. It holds no project-model logic: every tool calls
`asapnotes-mcp`, a second binary of the app's crate built on
[`src-tauri/src/corpus/`](../../src-tauri/src/corpus/mod.rs), the same core the app's
commands call (ids, walks, search, sections, grants, edits, the settings store, the log).
The command goes in argv and its arguments as JSON on stdin, because note content is
arbitrary text that a shell would mangle, and the helper always answers with an envelope so
a refusal reads differently from a crash. The server is the untrusted half, spawned by the
agent's client; its own work is the protocol, refusing an undeclared argument by name, and
the convention tools, which compose helper calls and grant nothing extra. The helper ships
beside the app's executable, so using the sidecar needs no toolchain.

Two other shapes were considered. Direct filesystem access from TypeScript is the simplest,
and it is a second copy of the project model, where drift is an access-boundary bug. A
listener inside the running app would route writes through the app's save path, but it adds
a listening endpoint to a resident app and makes every read depend on the app being up.

**Grants are enforced in the helper, per call.** Each call re-reads `settings.json`, so a
grant revoked in Settings closes for an agent that is already running. An `off` project
does not exist to the sidecar: it is not listed, its notes are not searched, and a read
gets the same "no such note" a missing id gets. Visibility runs inside the walk, so a
hidden project cannot spend a search's limit. Top-level notes and notes-root projects
default to `read`, linked projects to `off`, and an unrecognized grant reads as `off`.
`mcp.writeScope: "current"` pins writes to the project the app is on, checked after the
grant; `write_settings` refuses the whole `mcp` block, so an agent cannot lift its own
limits.

**Reads and writes address sections.** A section is named by its heading path; listings
carry heading trees on request and never content, and each search hit names the section it
fell under, so the next call is a section read. `write_section` replaces the body under a
heading and keeps the heading line; `append_to_note` appends, and creates a note that does
not exist yet. Both take `expectUnchanged`, a read's mtime, and refuse when the file moved
on. There is no whole-file note write, because it is the one call that can destroy work the
agent never read. Deletes are left out too.

**Writes are logged, reads are not.** `mcp-calls.jsonl` in app data gets one line per
write: tool, note, section, summary. Settings > MCP shows it. A log of reads would be a
record of everything the person's agents looked at, and answers no question they have.

**The app publishes its own notes root** in `mcp-state.json`, and the helper prefers it
over resolving one itself; `doctor` reports which it used. A helper reading a different
corpus would answer every call politely and wrongly.

## Links

- [MCP tool surface](../mcp-tool-surface.md): the design, the tool table, and "What
  changed in the building", which supersedes the design text where they differ.
- [`mcp/README.md`](../../mcp/README.md): setup and the grant table.
- [`src-tauri/src/bin/asapnotes-mcp.rs`](../../src-tauri/src/bin/asapnotes-mcp.rs): the
  helper; [`src-tauri/src/corpus/grants.rs`](../../src-tauri/src/corpus/grants.rs): grants,
  the pin and the published state.
- [Config splits by trust](2026-08-10-config-splits-by-trust.md): why the grant lives in the
  personal file.
