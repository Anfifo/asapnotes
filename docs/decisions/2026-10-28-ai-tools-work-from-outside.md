# AI tools work on the notes from outside the app

- Date: 2026-10-28
- Status: Built (destinations, `create_note` and `move_note`, the Claude Code plugin; the
  agent pane parked)

## Context

The notes are plain files, and the MCP server already let any agent client read and write
them under per-project grants. Two gaps were left. An agent creating a note had to pick a
folder by itself, so its notes landed wherever it guessed. And nothing pointed a session
working in a code repository at the notes kept about that repository. An agent pane was
built to close the second gap from inside the app: a terminal beside the editor running an
agent CLI in the current project's folder, with MCP tools that read and drove the open
editor over a local control channel.

## Decision

**There is no in-app agent.** AI tools work on the notes as files or over MCP, from the
terminal or editor they already run in. The agent pane was parked before release. Any agent
that reads files or speaks MCP already reaches the notes, so a pane would have tied the app
to one agent CLI and added a terminal and a long-running process to a resident app whose
summon latency and idle footprint are the product. The one capability only the running app has, recording a
meeting, got a narrow channel of its own
([entry](2026-10-29-agents-drive-meetings-over-a-local-control-channel.md)).

**Destinations decide where new notes land, for people and agents alike.** `destinations`
in `settings.json` names a folder per kind of new note: `capture` (the blank note a summon
or a startup lands in), `meeting`, and one per note type under `types`. Globally the
folders are note-id prefixes, so one may point into a project (`work/meetings`); a
project's entry holds the same shape as subfolders of the project. `Settings::destination`
resolves it: inside a project the project's own entry decides and falls back to the
project folder, and the global table applies only outside projects. The frontend's
`destinationFor` follows the same rule. Capture, "New note" and the meeting dialog route
through it; the explorer's "New note here" names its folder explicitly, and an untitled
note saves into the folder it was opened in. A `meetingFolder` from an older file moves
into `destinations.meeting` on load and is never written back. Settings shows the table as
"Where new notes go" and "Project folders".

**MCP files and moves notes through the same table.** `create_note` takes a file name, an
optional project, a kind (`note`, `capture` or `meeting`) and a note type, writes into that
kind's destination, and refuses to overwrite a note that exists. `move_note` moves or
renames within a project or between projects; both ends need write access, the note's
history goes with it, and it is refused while the app holds unsaved edits for the note.
Links in other notes are not rewritten. `list_projects` and `doctor` report destinations,
so an agent can see where a note will go before it writes one. Each move is logged with
both ids, and on focus the app repoints a tab whose note moved: background tabs always,
the open tab when its buffer has no edits. A save that would recreate a vanished file
asks first, which covers moves by any other tool.

**A Claude Code plugin points a session at the notes for its code.**
`projects.<name>.codeFolders` lists the absolute folders a project's notes are about, such
as the repository the work happens in. [`integrations/claude-code/`](../../integrations/claude-code/README.md)
is an optional plugin whose hook runs at session start, on each prompt, and after file and
shell tools. The first time the session's folder, a tool path, a shell command or the
prompt names one of a project's code folders, the session gets one line: the project, where
its notes live, whether it may write to them, and which MCP tools to use. Each project is
named once per session. The list comes from the helper's `code_folders` command, which
starts from the visible projects, so a project whose access is off never matches. The app
publishes the helper's path in `mcp-state.json`, and the hook needs no configuration.
Measured cost: about 80 ms per tool call and 130 to 150 ms at session start.

## Links

- [`src-tauri/src/settings.rs`](../../src-tauri/src/settings.rs): `Destinations`, `Kind`,
  `Settings::destination`, `code_folders` on the project entry.
- [`mcp/src/tools.ts`](../../mcp/src/tools.ts): `create_note`, `move_note`, and the
  `write_settings` description of both keys.
- [`integrations/claude-code/README.md`](../../integrations/claude-code/README.md): install,
  setup, and when the reminder fires.
- [The MCP server shells out to the Rust helper](2026-08-19-the-mcp-server-shells-out-to-the-rust-helper.md):
  the grants these tools go through.
