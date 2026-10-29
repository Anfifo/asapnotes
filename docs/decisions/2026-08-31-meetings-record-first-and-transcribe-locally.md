# Meetings record first and transcribe locally

- Date: 2026-08-31
- Status: Built (recording, the recordings view, the transcription add-on; agents can
  start and stop a recording over MCP)

## Context

A meeting note wants what was said, and much of what is said comes from the other people
on the call. Two invariants bound the design. Nothing leaves the machine unasked, which
rules out hosted speech services. Summon latency is the product, so a meeting feature
cannot keep a speech model resident in the tray process or make the default install
heavier for the many who never record. Speech recognition at useful accuracy also runs
slower than real time on a laptop CPU, and a capture that waits on the recogniser loses
audio whenever it falls behind.

## Decision

**Record first, transcribe later.** A recording is audio on disk; during the call nothing
runs but capture and an encoder. Transcription is a later pass over finished files, so the
audio is safe whatever the recogniser does, and a batch pass over a whole file transcribes
better than a stream. Live transcription during the call was considered. It would hold the
model in memory and the CPU busy for the whole meeting, and a failure midway would leave
nothing behind.

**Two tracks, never mixed.** The microphone and the system playback (a loopback capture on
the default output device) are each written as a mono Opus file in Ogg, 48 kHz at 32 kbps,
into the meeting note's assets. The track a voice arrived on attributes it: the microphone
is "Me", the system audio is "Them", with no diarization model. Loopback delivers nothing
while the machine is silent, so the encoder pads with silence against the wall clock and
the two files stay the same length and aligned. Start refuses unless every chosen capture
comes up, so a blocked microphone is an error at the start of the meeting. The dialog has
a checkbox per source, both on every time and never remembered: a mic-only choice carried
into the next meeting would drop the other voices unnoticed. Opus is open and
royalty-free, so the files play in other tools.

**Transcription is an optional local add-on.** The engine is a third binary,
`asapnotes-transcribe` (whisper.cpp through `whisper-rs`), built only with the `transcribe`
cargo feature. The app never links whisper.cpp, and a default install carries none of it.
The engine runs as a child process at below-normal priority with no console window, so a
crash in native code cannot take the tray app down, a run can be killed at any moment, and
summon stays quick. It streams progress and segments as JSON lines; the app merges the
tracks by time into stamped paragraphs. The engine and the models (base, small,
large-v3-turbo) download into app data only when a download button is pressed, each
checked against a SHA-256 the app build carries. The language is asked on every run with
the last choice preselected. There is no automatic option, because a wrong guess yields a
transcript in the wrong language. Shipping the engine in every install was considered, as
was an installer checkbox. The installers in use have no components page, and most
installs never transcribe.

**The transcript is a sibling note.** It lands as `<meeting>.transcript.md` beside the
meeting note, linked from the line under the recording's stop line. An hour of talk is
around nine thousand words, which would bury the hand-written notes if appended to them.
The transcript is found by name, so editing the stop line never orphans it.

**The notes index the recordings.** The recordings view lists every `.opus` link the notes
hold, grouped by project. Recordings share the root assets folder and carry no project in
their names, so a folder scan could not attribute them, and a recording whose link was
deleted is one its note no longer claims.

**Consent belongs to the person recording; the app makes recording visible.** Whether a
call may be recorded depends on where it happens and who agreed, which the app cannot
know. Its part is an indicator that cannot be missed: a titlebar chip that is itself the
stop button, and a tray tooltip while recording. Recording started by an agent sits
behind a Settings switch that is off by default, and brings the window up so the chip is
in view. The README states this stance next to the no-network one.

## Links

- [README: meeting recording and consent](../../README.md#status)
- [MCP server](../../mcp/README.md): `start_meeting`, `stop_meeting` and the meetings switch
- [Resident tray + Tauri stack](2026-08-06-resident-tray-and-tauri-stack.md): the footprint
  the add-on split protects
- Key files: [`src-tauri/src/meeting.rs`](../../src-tauri/src/meeting.rs) (capture, encoder,
  recordings index), [`src-tauri/src/transcribe.rs`](../../src-tauri/src/transcribe.rs)
  (downloads, the child process, the transcript),
  [`src-tauri/src/bin/asapnotes-transcribe.rs`](../../src-tauri/src/bin/asapnotes-transcribe.rs)
  (the engine), [`src/Meeting.tsx`](../../src/Meeting.tsx),
  [`src/Recordings.tsx`](../../src/Recordings.tsx),
  [`src/Transcribe.tsx`](../../src/Transcribe.tsx)
