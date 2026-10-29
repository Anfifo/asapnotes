# Agents drive meetings over a local control channel

- Date: 2026-10-29
- Status: Built (off by default; `start_meeting`, `stop_meeting`, `meeting_status`)

## Context

Meeting recording lives in the app process: the audio capture, the recording chip, the
editor that receives the recording's links, and the local transcription. The MCP helper is
a separate, short-lived process that works with the app closed, and the 2026-08-19 design
kept a listener out of the app for the corpus tools because a resident app should be
auditably quiet. So an agent asked to record a meeting for a project could file the note
but had to ask the person to start the recording by hand.

## Decision

**A local channel that opens only while meeting control is on.** `control.rs` serves a
named pipe on Windows, with remote clients rejected, and a unix socket in app data
elsewhere. The address and a random token are fresh on every launch and published in
`mcp-state.json` in the app's data folder under the user's profile; the token is the proof
that a caller read that file. Launch clears the previous run's address, and the endpoint opens only when
`mcp.meetings` is `on`, at launch or when the Settings switch turns it on. `meetings_on`
accepts nothing but an explicit `on`, because a recording captures other people. Like the
rest of the `mcp` block, the switch is not writable over MCP. Every request re-reads
`settings.json`, so a switch turned off by hand applies to the next request.

**The app authorizes, the frontend carries it out.** A request is one JSON line and the
reply one envelope, the same envelope the helper prints. The trusted process checks the
token, the switch and, for a start, write access to the note's project through the same
`check_write` the corpus tools use. Only then does it forward the request to the window as
an `app-control` event and wait up to 20 seconds for `control_reply`. The helper's side,
`corpus/control.rs`, only presents the token from the state file.

**Three tools.** `start_meeting` (name, project, mic, system) files the note in the
project's meetings destination, records into it again when that name already exists there,
brings the window up so a recording never runs unseen, and starts recording.
`stop_meeting` writes the recording's links into the note and, with `transcribe`, starts
the local transcription with a language and model that default to the last pick.
`meeting_status` reports a running recording and transcription. An open note with no edits
of its own is saved after its transcript link goes in, so the file carries it; a note with
unsaved edits is left to the person.

**Refusals name the setting.** A closed channel answers that the app is not running or
meeting control is off, and names Settings > MCP > Meetings; a read-only project names
Settings > MCP > Project access and the `settings.json` key. Only the person can change
access, so the tool descriptions tell the agent to pass the refusal on, and to say that it
is recording. A project whose access is off still answers like one that does not exist.

**Meetings only.** The parked agent pane carried a wider channel that read and drove the
open editor and the palette. This one exposes the three meeting actions, and every corpus
tool still runs through the helper with the app closed.

## Links

- [`src-tauri/src/control.rs`](../../src-tauri/src/control.rs): the endpoint, the token
  check, and the forwarding to the frontend.
- [`src-tauri/src/corpus/control.rs`](../../src-tauri/src/corpus/control.rs): the helper's
  client side.
- [`src-tauri/src/corpus/grants.rs`](../../src-tauri/src/corpus/grants.rs): `meetings_on`,
  `ControlAddress` in the published state, `check_write` and the refusal wording.
- [AI tools work on the notes from outside the app](2026-10-28-ai-tools-work-from-outside.md):
  why there is no in-app agent, and the destinations the meeting note is filed by.
