# TODO — live working file

The AI (or anyone) working on this repo keeps this file current while working:

- **Add** an item when a piece of work starts or is agreed; give it a date and one line
  of context (enough that it makes sense weeks later).
- **Update** it as the work progresses (check off sub-steps, note blockers).
- **On completion:** if the work embodied a real decision or main integration, promote it
  to a dated entry in [`decisions/`](decisions/README.md) and delete it here. Pure task
  noise is just deleted. This file should stay short — it's a working surface, not an
  archive.

---

## Bugs

## Next: distribution

- [ ] **Releases, winget, signing, updater** (2026-09-05): `.github/workflows/release.yml`
      turns a tag into a draft GitHub release with the NSIS and MSI installers. A release
      bumps the version in `package.json`, `mcp/package.json`,
      `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, then tags `vX.Y.Z`. Left, in
      order:
  - [ ] First tagged run of the release workflow (2026-10-29): it now builds the engine
        with the C runtime linked in, passes its SHA-256 and size to the app build,
        fails if any shipped exe imports the VC++ runtime, attaches the engine, and
        regenerates the notices. None of these steps has run on CI yet; the libclang
        path assumes the runner's LLVM install.
  - [ ] A winget manifest (`Anfifo.asapnotes`) once a release exists.
  - [ ] Signing: ship unsigned and say so, then apply to SignPath Foundation's free
        open-source signing. The Store is parked (account fee, and MSIX packaging the
        bundler does not emit). Ready on our side (2026-10-29): the README carries the
        code signing policy and the privacy statement, the workflow builds every shipped
        binary from a tag, and the exes carry product name, version and publisher. Left:
        MFA on the GitHub account, the repository public, the application at
        signpath.org, then a signing step between the build and the release upload and
        the policy's "planned" sentence rewritten as current.
  - [ ] Installer: a Settings switch for autostart, and an NSIS uninstall hook that
        removes the Run entry the autostart plugin writes at runtime.
  - [ ] Updater: `tauri-plugin-updater` reading `latest.json` from the GitHub release,
        signed with a minisign key (private key as a repository secret). Opt-in only: a
        "Check for updates" button that connects on click, and a toggle for a throttled
        check. Waits on the update-policy decision below.

## Open work

- [ ] **Tray menu shows the summon chord** (2026-09-04): "Open (Ctrl+Alt+A)" in the
      label, rewritten on rebind (the tray menu in `lib.rs`).
- [ ] **Tables and task lists in the live-preview editor** (2026-09-04): a table renders
      as a grid while the caret is outside the block and as raw pipes inside it, the rule
      the rest of `livePreview.ts` follows; task-list boxes the same way.
- [ ] **Moving notes: drag hint and keyboard reach** (2026-09-07): drag-to-move is built
      (`Explorer.tsx`, `MoveInto.tsx`). Left: a hint line on the drag pill over nothing
      droppable ("drop on a folder, a project, or the note"); a right-click "Move to…"
      submenu (No project, each project's folder and virtual folders, new virtual
      folder…); a palette command with a type-ahead folder picker over the open note or
      the explorer selection. Mention links to a moved note are not rewritten.
- [ ] **Workspaces, the rest** (2026-09-07): per-workspace tab sets (each workspace keeps
      its own strip, Default keeps everything; open: where a note opened from search lands
      when it is outside the workspace). MCP grants per workspace and
      `writeScope: "workspace"` beside today's `"current"`.
- [ ] **Meeting mode, the rest** (2026-08-31): recording, the recordings view and local
      transcription are built
      ([decision](decisions/2026-08-31-meetings-record-first-and-transcribe-locally.md)).
  - [ ] Export as WAV: an "Export as WAV…" entry on the recording link's right-click menu
        and a palette and File verb, opening one sheet (mixed, per track, or the raw
        `.opus` files, then a save location).
  - [ ] GPU engine: the `transcribe-vulkan` feature exists; it needs a second release
        asset, a variant picker in Settings, and the Vulkan SDK on CI.
  - [ ] Live timestamps: stamp elapsed time on new bullets while recording.
  - [ ] Later: per-track gain and mute while recording (a muted track writes silence, so
        the files stay aligned).
  - [ ] Later: a mic noise gate, tuned against real recordings first, since a wrong
        default eats quiet speech.
- [ ] **Explorer, the rest** (2026-08-09): project rename (needs a folder-move backend),
      collapse-all (nested folder `<details>` are uncontrolled), F2 inline rename, a filter
      box, keyboard tree navigation, reveal-active-note. An empty new folder lasts only
      the session, because the walk lists no directories (`project_dirs` in `walk.rs` is
      top level only).
- [ ] **Note types and project config in Settings** (2026-08-09): `noteTypes` in
      `settings.json` and `.asapnotes.json` are hand-edited only.
- [ ] **Editor conventions not built yet** (2026-08-08): multi-cursor and column select
      (`allowMultipleSelections`, `rectangularSelection`, `crosshairCursor`; Ctrl+D yields
      one cursor today); tab drag-to-reorder and Ctrl+Shift+T; a breadcrumb for same-name
      tabs; scrollbar search-match markers and `highlightSelectionMatches`; split view
      (low rank, live preview covers most of it).
- [ ] **Project map questions** (2026-09-05): whether referenced non-markdown files are
      nodes or a count chip; whether details open on hover-dwell; the ledger's long arcs
      at real corpus heights; a warm start across launches (the layout reseeds each
      launch today).

## Decisions waiting

- [ ] **Does the meeting dialog's pick overwrite the Meetings destination?**
      (2026-10-28): the dialog remembers the last folder picked as
      `destinations.meeting`, which Settings shows and `create_note` follows, so one
      meeting recorded into `personal` sends every later one there. Options: keep the
      remembered pick separate from the configured destination, or stop writing it back.
- [ ] **Should `settings.json` keep keys the app does not model?** (2026-08-20):
      `store::patch_settings` writes back the parsed `Settings`, so a hand-edited key or
      one from a newer build disappears on the next write. A `#[serde(flatten)]`
      catch-all would round-trip them. Pinned by the `KNOWN GAP` test in
      `mcp/test/settings.test.ts`.
- [ ] **Update policy** (2026-08-09): nothing connects before consent. Open: whether
      "7 days" means a one-time consent prompt a week after install, the throttle for the
      automatic check, or both; and whether the check goes to GitHub Releases (no server
      of the project sees an IP) or the project's own site.
- [ ] **What the scan sheet counts** (2026-08-09): `count_md` counts the whole candidate
      folder. Should it count only the `docs/` subtree that becomes the project root?
- [ ] **`.md` files not shown as markdown** (2026-08-11): reported once, never
      reproduced. A 2026-08-12 diagnosis found two weak points: the note-type registry is
      module state that triggers no re-render, and the editor's extensions freeze at
      mount until `docKey` changes. Reproduce (does the toolbar also think the note is
      not markdown?) or close.
- [ ] **Search pill ranking** (2026-08-09): should the pill open the palette with notes
      ranked above commands?

## Direction

- [ ] **Cloud share, then sync** (2026-08-09): not scheduled. First an end-to-end
      encrypted file share (the key travels in the URL fragment, so the server never
      sees it), then sync with per-project opt-in. Files stay primary, and nothing leaves
      the machine by default.
- [ ] **AI-assisted palette actions** (2026-08-07): an idea, nothing designed.
