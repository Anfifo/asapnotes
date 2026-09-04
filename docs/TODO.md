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

## Today (2026-08-31)

- [ ] **Meeting mode: record the meeting, transcribe it later, locally** (2026-08-31) —
      asked and designed 2026-08-31. A meeting is captured as **two mono Opus tracks**
      (microphone and system playback, via WASAPI loopback) in the meeting note's
      `assets/`; keeping the tracks separate is what later attributes transcript lines to
      "me" vs "them" with no diarization model. Record-first was picked over
      live-transcription-only: the audio is always safe on disk, batch transcription beats
      streaming on quality, and nothing runs during the call but the encoder.
      Transcription is **Whisper via whisper.cpp, entirely local** (the no-network
      invariant rules out cloud speech APIs); the model file is an **optional, consented
      download on first use** — English, Portuguese (incl. European) and Spanish work in
      every multilingual size. Recordings stay exportable: Opus is open and royalty-free,
      and a decode-to-WAV verb can come whenever wanted. Recording legality/disclosure is
      the user's responsibility; the app's part is an indicator that cannot be missed.
      Slices:
  - [x] **1 — recording** — built 2026-08-31, **verified live 2026-09-04**, committed.
        What shipped: `src-tauri/src/meeting.rs` (capture threads, linear resample to
        48 kHz mono, Opus at 32 kbps into Ogg, wall-clock silence padding so the two
        tracks stay aligned when playback goes quiet; start refuses unless both captures
        come up), `src/Meeting.tsx` (the dialog: prefilled name + folder select,
        remembered as `meetingFolder`), `src/MeetingChip.tsx` (titlebar chip, whole
        surface is the stop button), mic button in the menubar beside the search pill,
        palette + File-menu entries, resync of a running recording after a webview
        reload. Stop inserts the links at the cursor when the meeting note is the active
        tab, else appends to the file (an unsaved background-tab draft could go stale —
        known edge). **Verified** (headless second instance, 46-s and 4-s recordings):
        both files decode packet-for-packet with page boundaries every 50 packets and a
        clean end-of-stream, lengths within one 20-ms frame of each other, real playback
        on the system track, a live noise floor on the mic track (nobody spoke); the chip
        survives a reload; stopping from another tab appends to the file, from the meeting
        tab inserts into the editor; a second recording gets `-2` file names; the dialog
        lists projects and healthy mounts. Unit tests cover the Ogg/Opus writer round trip
        and the resampler; `probe_recorded_file` (ignored, `ASAPNOTES_PROBE=<file>`)
        reports what any recording holds. **Still owed a hand check:** a spoken word on
        the mic track and a real player's seek; the mic-blocked path (Windows privacy
        toggle) was not exercised. Build note: the Rust tree now needs cmake (Opus builds
        from source) — a user-scoped `CMAKE` env var was set pointing at the VS Build
        Tools copy; new shells pick it up, already-open ones need it set or a restart.
  - [ ] **2 — transcription**: helper process + whisper.cpp; consented model download;
        transcript appended as markdown with `[hh:mm:ss]` per paragraph, speaker by
        track; opus→wav export verb.
  - [ ] **3 — live timestamps**: while recording, stamp elapsed time on new bullets so
        hand notes align with the recording and transcript.
  - [ ] **Later — volume control per track** (asked 2026-08-31): a gain slider for each
        track while recording, and a mute — one may notice their own microphone
        overshadowing the other voices mid-meeting, or decide to keep only the computer
        sound. The two-track split already makes this per-source; muting is just a track
        writing silence, so the files stay aligned and the transcript unaffected.
  - [ ] **Later — mic noise gate** (asked 2026-08-31): a configurable threshold under
        which the microphone track records silence, so it isn't picking up background
        noise the whole meeting. Explicitly future: a wrong default eats quiet speech,
        so it wants tuning against real recordings once some exist.

## 2026-08-25

- [ ] **Remove the canvas engine; the project map becomes a purpose-built graph view**
      (2026-08-25) — **built the same day**; the record is at the foot of this item, the
      decision in [decisions/2026-08-25](decisions/2026-08-25-map-is-a-graph-view-not-a-canvas.md).
      The map is what the project surface is for
      ("the goal is to view the project connections", 2026-08-16), and it rides a
      2,259-line editing engine as a `readOnly` lens while the JSONCanvas format forces
      every node to be a rectangle — which forced the cards, which forced the grid. The
      engine itself already renders as positioned DOM plus SVG edges; the weight is
      ownership, not rendering. **Decision: remove it whole.** Leaves: `src/canvas/`
      (BoardView, jsoncanvas, ink, annotate), `corpus/canvas.rs` and the `read_canvas` /
      `write_canvas` MCP tools with their tests, the `canvas` note type (needs a settings
      migration step; existing `.canvas` files stop being listed), launch-onto-a-canvas,
      Export-as-canvas, the Explorer's "new canvas", the `.board-*` CSS, and the
      `annotate:` tab — **image annotation goes with it** (asked 2026-08-14, shipped
      2026-08-20, never used by hand); pasting/dropping images into notes is untouched,
      it predates the canvas. Stays: the `file:` lens (the map still points at referenced
      files), the "open referenced file" preference, `IMAGE_FILE` in `paths.ts`.
      Considered and declined: keeping the engine for the freeform canvas and giving the
      map its own renderer anyway (no feature loss, two surfaces to maintain for features
      nobody has used), and only swapping the layout algorithm inside the lens (leaves
      the weight and the rectangles). Both 2026-08-14 decision entries flip to
      Superseded when this lands, and a new entry records the why.
      **Order picked: candidate sheet first, then one slice** — the new map view and the
      deletion land together so the MAP chip never goes dark.
      _2026-08-25: candidate sheet published, awaiting a pick_ —
      (a private working page, since removed). Four
      treatments over the repo's own docs graph (21 notes, 15 referenced files, 101
      references, computed the way `projectMap.ts` computes a map), both themes at the
      app's tokens, every pane live (hover lifts a node's lines and shows its card, click
      pins in the preset colors): **A** today's cards in folder clusters (reference, at
      fit zoom); **B** constellation — a dot per file sized by degree and colored by
      folder, force-placed with a soft pull to the folder centroid, blurred folder halos,
      seeded so the picture is stable (recommended: proximity carries folder and hub at
      once, whole project on one screen); **C** ring — folders as arcs, references as
      chords through the middle (best for folder-to-folder traffic, fixed order, no
      simulation); **D** ledger — files listed under folders, references as arcs to the
      right (fully readable, scrolls, no picture). Composable axes with live toggles:
      edges at rest (ghost / hidden / plain), labels (file name / first heading / on
      hover), folder halos, node form ladder (dot / split in-out ring / title box / card
      on pin), detail on demand (hover card / pinned inspector). Open on the sheet:
      whether referenced non-markdown files get nodes or a count chip; six-hue hash vs
      hue families for folders; what a pin does; stability across opens (B warm-starts
      from the last layout; C and D are deterministic by construction).
      **Picked 2026-08-25, same day: all but the ring, as switchable views.** One
      `MapView` replaces the canvas lens — graph model, camera, hover card, pins, file
      verbs shared — with three layouts behind a segmented control on the map's bar (and
      palette commands): **Clusters** (today's look re-created: excerpt cards, title boxes,
      folder tabs, degree balls; the pack algorithm carries over from `projectMap.ts`),
      **Constellation** (the default: dots by degree, folder halos, seeded force layout
      with a warm start so a new note lands near its folder and nothing else moves), and
      **Ledger** (rows under folder headings, arcs to the right; scrolls like a document,
      no zoom cluster). Nodes are DOM, edges SVG — cards need real rendered excerpts.
      Settled defaults: ghost edges at rest in every view; labels are file names (first
      heading as a later toggle); referenced non-markdown files stay nodes; folder colors
      keep the six-hue hash; the last-used view is **one app-wide preference** in
      `settings.json` (per-project can come later without moving anything), camera
      remembered per tab as today. **Clicking gets more:** a click pins the node in a
      preset color _and_ opens its detail — name, folder, title, opening text, and its
      references and back-references as rows that open the note (the sheet's "pinned
      inspector", built in). The ring (C) is dropped. Building: new view with the three
      layouts and the canvas deletion land together, so the MAP chip never goes dark.
      **Built 2026-08-25, all gates clean, verified live over the devtools protocol.**
      What shipped: `src/map/` — `graph.ts` (the model: notes, referenced files, dead
      links, folders, degrees, each note's title and opening text read once at compute
      time, so there is no excerpt cache any more), `layouts.ts` (clusters ported from
      the old pack; constellation as a seeded force layout with label placement and
      folder hulls; ledger rows), `viewKinds.ts` (the three names, the one piece the
      shell imports eagerly), `MapView.tsx` (the surface: DOM nodes, one SVG edge layer,
      camera, hover card, pins, the details panel, the view switcher, menus). `App.tsx`
      lost every canvas path (~600 lines): the lazy import is the map, `openMapTab`
      computes a graph, `mapFileVerbs` takes a node, `openMapFile` replaces the board's
      target resolution, the camera is remembered per tab _and_ view. `settings.rs`:
      `openAtLaunch`/`set_open_at_launch` → `mapView`/`set_map_view`; the registry's
      default is the pre-canvas list again (= the v3 snapshot), with v6 added to the
      upgrade chain so every canvas-era shipped registry sheds the entry and a hand-edit
      is untouched; tests rewritten around that. Gone: `src/canvas/`, `src/views.ts`
      (the view-policy table only ever varied for the canvas — autosave-to-file and
      `nameBase` went with it), `src/assetVersions.ts` (only the annotation flatten ever
      bumped a version), `corpus/canvas.rs`, the two MCP tools and their tests (Rust 116
      → 111, MCP 74 → 71), `overwrite_asset`, the `ink` feature, `ViewId` is `markdown |
text`, `.board-*` CSS replaced by `.map-*`. Both 2026-08-14 decisions flipped to
      Superseded; project-model.md, mcp-tool-surface.md and mcp/README.md reworded.
      _Verified live_ (second instance, own WebView2 profile, the real corpus — the
      `asapnotes` project: 43 nodes, 113 references, 11 folder halos): the MAP chip
      opens the constellation fitted at 82 %; hovering `TODO.md` lifts its 25 lines and
      shows the card (name, folder chip, title, opening text, 10 in · 15 out); clicking
      pins it red and opens the details — "Referenced by 10 / References 15", 25 rows
      with folder chips for rows from other folders; clicking a row moves the panel to
      `README.md` and adds a second pin; the node menu reads Open note · Details · Copy
      path · Reveal in File Explorer · Delete note; a background click clears pins and
      panel; Clusters shows 43 cards with 41 folder tabs (the two root notes wear none)
      at 28 %; Ledger shows 43 rows under 11 headings with the zoom cluster hidden and a
      pinned row's 14 arcs colored; switching views wrote and cleared `mapView` and
      `settings.json` came back **byte-identical**; the palette offers the two other
      views while the map is open; double-click opened `CLAUDE.md` in its own tab; both
      themes screenshotted. Two things the live check caught and fixed: the details
      panel is a fixed-height flex column, so its excerpt shrank to a sliver until its
      children got `flex-shrink: 0`; and the excerpt repeated the heading line the title
      already shows, so the leading heading is stripped at compute time.
      _Pending hands-on:_ **label density on the constellation** — labels live in world
      units and shrink with the fit (82 % on 43 nodes; a bigger project will be worse),
      and the dense middle overlaps even so; the honest fix is screen-space labels
      (counter-scaled by 1/z) plus a "hubs only past N nodes" rule, which wants the app
      in front of a human before picking numbers. Also: whether referenced non-markdown
      files should be nodes at all or a count chip (they are 15 of the 43 here); folder
      colors as the six-hue hash vs hue families; whether the details panel should also
      open on hover-dwell; the ledger's long arcs at real corpus heights; and the warm
      start, which only exists within a session (a fresh launch lays out from the seed).

## Today (2026-08-20)

- [x] **MCP — the TypeScript half is tested now, and it found three bugs**
      (2026-08-20) — the Rust core had 110 tests and `mcp/` had 23 happy-path ones, so
      the untrusted half was also the untested half. **23 → 73**, in five files split by
      what they are about: `test/harness.ts` (build a corpus with its own files,
      grants, `mcp` block and `mcp-state.json` — the piece that unblocked the rest),
      `server.test.ts` (corpus behavior), `protocol.test.ts` (what a client sees),
      `convention.test.ts` (the only non-pass-through logic on this side),
      `helper.test.ts` (the process seam), `settings.test.ts` (settings granted, and
      the write pin — neither reachable before, because both are off in the one
      fixture every test shared). Suite is 2.6s. Gates clean; the only lint warning is
      still `BoardView.tsx:667` from the uncommitted map work.
      _The seam tests use a fake helper_ — a node script run by the same node, since
      `Helper` puts the command first on the argv — so a missing binary, a crash, a
      non-envelope answer, a 400 KB reply arriving in chunks and a hang are all
      exercised without touching Rust. `HelperOptions` gained `timeoutMs` for the last
      of those (the 60s default was untestable, and a shorter leash is a fair knob for
      an embedder).
      **Three bugs, all found by writing the test rather than by running the app:**
      (1) `append_todo` rewrote the section holding the dated headings and put the new
      one on top of whatever was already in it — so a TODO with prose above its dates
      had that prose **moved into today's items**. It now splits at the first dated
      heading and keeps what sits above it. (2) An explicitly older `date` was inserted
      at the top anyway, breaking the newest-first ordering the tool exists to
      maintain; a backfill now lands under the oldest heading still newer than it.
      (3) Every tool schema says `additionalProperties: false` and **nothing enforced
      it** — the SDK's low-level server does not validate and the helper reads
      arguments by name, so `limmit: 50` was silently dropped and the caller believed
      its limit was honored. `index.ts` now refuses an undeclared argument and names
      what the tool does take. Names only: types and required arguments stay the
      helper's business, since re-checking those here would be a second implementation
      of the rules that matter.
      _Verified the tests bite:_ swapping the old insertion logic back in fails exactly
      the four new ordering/prose tests and nothing else.

- [x] **The notes root walks deep now — a project's subfolders are part of it**
      (2026-08-20) — found by the tests above: `append_to_note` with
      `work/meetings/2026-08-19.md` returned `created: true`, read back fine, and
      appeared in **no** listing, search or note count. The app's explorer uses the same
      walk, so it was invisible there too, and the previous e2e suite enshrined that id
      shape as a pass.
      _Why deep rather than refusing the id_ — which was the first plan, and wrong.
      Everything else in the app already assumes a project can have folders: the working
      convention keeps dated entries in `decisions/`, "New folder" makes real ones
      (`create_folder` allows depth 2–12 in any project), a project's `files` rules
      re-include paths like `!src/**/*.rs`, and the frontend's id math handles depth.
      Only `list_tree` stopped one level in. The refusal was built first and killed by
      its own test suite: it broke `new_decision`, because `project/decisions/…` is
      exactly the subfolder it forbade.
      _What changed:_ `list_tree` takes `deep` and recurses into each notes-root project
      when it is set. **The first paint is untouched** — the app's launch call is
      `listNotes(false)`, which still walks one level in, and the deep call it already
      made afterwards now lists everything. `note_paths` (search, `find_notes`, the id
      map) always walks deep. Tests: a shallow-vs-deep pair that pins what the flag
      costs and buys, a create-then-find-it test in the corpus core, and the e2e test
      that used to enshrine the hole now asserts the note is findable.
      Uncommitted map-lens note: the map will now see notes-root subfolders as folder
      nodes, which it was built for but had never been given.

- [ ] **Settings → MCP panel** (2026-08-20) — the last piece of the sidecar slice, built
      from the candidate sheet's option C with editable access controls. Three
      sub-sections in the order someone actually needs them: **Connect a client** (status
      dot, the notes root being served, and a ready-to-paste config entry built by
      `JSON.stringify` from `helperPath` and the new `serverPath`, with Copy), **Project
      access** (Hidden / Read / Write per project, the write pin, and access to
      `settings.json` itself, with a one-line summary and a warning when settings access
      is on), and **Recent activity** (the write log, collapsed, newest first).
      New Rust: `set_mcp_grant`, `set_mcp_write_scope`, `set_mcp_settings_access` — three
      narrow setters rather than one that takes the whole `mcp` block, so none of them
      can clobber a neighbour, plus `checked_grant` refusing a word that isn't a grant
      (everything downstream reads an unknown value as `off`, so a typo from the UI would
      silently hide a project). `mcp_status` gained `serverPath`.
      `McpSection` fetches its own status and re-reads after every change rather than
      trusting optimistic state — the precedent for a component doing its own IPC is
      `DiffLens`. Typed `McpStatus` in `notes.ts` replaces the `Record<string, unknown>`.
      **Still to do:** seen on screen. Gates are clean and the data path is exercised, but
      the panel has not been looked at, and the grant buttons write the real
      `settings.json`, so verifying those needs a corpus that isn't the user's.

- [ ] **Decide: a settings key the app does not model is dropped on write**
      (2026-08-20) — `store::patch_settings` merges the patch into the file's JSON,
      then writes back the **parsed** `Settings` struct, which has no catch-all. So any
      key nobody models disappears: a stray hand-edit, a key from a newer build, a
      comment-ish line someone left. `settings.json` is explicitly a file the user
      hand-edits, which is what makes this worth a decision — and it is how the app
      writes settings too, not something the sidecar introduced. Fix, if it is one, is
      a `#[serde(flatten)]` catch-all on `Settings` so unknown keys round-trip.
      Pinned meanwhile by the `KNOWN GAP` test in `settings.test.ts`.

- [x] **Renaming a note in a folder pulled it out of the folder** (2026-08-20) — found
      while reading for the conversion item below. `submitRename` built the new id from
      `projectOf(cur.id)` — the **first segment only** — so renaming
      `work/meetings/2026-08-19.md` to "standup" wrote `work/standup.md`: the file left
      its folder, and the duplicate-name check looked in the wrong place too. Reachable
      for any note in a virtual folder since mounts existed, and newly reachable
      everywhere now that the walk goes deep. Fixed by taking the whole containing
      folder, which is also what the same-name conversion needs: new `dirOf` in
      `paths.ts` (the counterpart of `fileOf`), and the two other copies of that path
      math — `openDir` and the explorer's "New note here" — now read it instead.
      _Verified live_ (see below): renamed inside a real folder and inside a virtual
      one; both stayed put, the tab retagged, and the note read back through the mount.

- [x] **Convert a folder between virtual and real** (2026-08-20; asked 2026-08-16, item
      under that date) — shipped as an **in-place** conversion, which is the decision
      the whole slice rests on. See that item for the record.

- [x] **Six piled-up slices went in as six commits** (2026-08-20) — the tree had been
      carrying the MCP sidecar, image annotation, live-preview typography, the map
      surface, and the conversion all at once, across shared files: App.tsx (43 hunks),
      App.css (24), BoardView.tsx (31), livePreview.ts, notes.rs, lib.rs, notes.ts. Split
      by hunk rather than by file, so each commit is one slice. Four places were mixed
      inside a single hunk and needed an intermediate version written by hand: the
      `paths.ts` additions (`IMAGE_FILE` vs `dirOf`), App.tsx's `paths` import,
      BoardView's props destructuring (`annotate` vs `fileVerbs`/`camera`), and
      BoardView's `nodeAccent` removal sharing its closing brace with `folderColor`'s
      arrival. `livePreview.ts` could not be split by hunk at all — the annotation
      threading and the marker rework interleave — so its intermediate file was built
      from `HEAD`'s copy and put in the index with `hash-object` + `update-index`, which
      never touches the working tree.
      _What made it verifiable:_ each commit's staged state was checked out in a scratch
      worktree **before** committing (`write-tree` → `commit-tree` → `checkout --detach`
      in a worktree with a junction to `node_modules`, `CARGO_TARGET_DIR` shared so
      clippy is seconds not minutes), then `tsc`, `eslint`, `prettier --check` and
      `clippy --all-targets`. It caught two real breaks: zero-context hunks misplacing
      lines in `livePreview.ts` (the `+` line numbers assume the hunks that were left
      out), and `folderColor` landing a commit before the code that uses it.
      _Also:_ `docs/TODO.md` had been failing `prettier --check` since before this
      session; the docs commit fixes it.

- [ ] **BoardView's wheel effect is missing `zoomAt`** (2026-08-20) — the repo's only
      lint warning (`BoardView.tsx:667`), in with the map-surface commit's zoom
      refactor. `zoomAt` is rebuilt every render, so naming it in the dependency array
      would re-register the wheel listener on every render; the honest fix is a
      `useCallback` or a ref, and either changes when that listener is attached. Wants
      the app in front of a human, not a blind edit.

- [ ] **Move a note into another folder** (2026-08-20) — the half of the conversion ask
      that is still open: moving files between a virtual folder and the real one it
      becomes, so a conversion needn't be all-at-once. The backend is already there —
      `move_note` takes a whole id and carries the note's draft and history with it, and
      the tab retagging is the same call `submitRename` makes. What is missing is a way
      to aim it: a "Move to…" entry listing the corpus's folders, or drag-and-drop in the
      explorer (there is none anywhere in the app yet, so it would be the first). Open
      question is which — a picker is small and keyboard-reachable, dragging is what the
      hand expects from a tree. Unlike a conversion, this **does** change the moved
      note's id, so mention links pointing at the old one are a real question here.

## Today (2026-08-19)

- [ ] **MCP sidecar — built, all six build-order steps plus canvas and settings**
      (2026-08-19) — the design doc written earlier the same day
      ([mcp-tool-surface.md](mcp-tool-surface.md)) taken all the way through code.
      Goal as stated: any agent can read notes from any project, add notes where
      allowed, create and review canvases, reach settings; **quick searching and
      finding things is the most important part**; well tested; and a toggle that
      confines writes to the current project. All of it is in, gates clean, and
      what the building changed about the design is recorded in that doc's
      **"What changed in the building"** section — read that before trusting the
      design text above it. Setup and the grant table: [mcp/README.md](../mcp/README.md).
      **Step 1, the core extraction — the gate on everything else.** 460 lines out of
      `notes.rs` into `src-tauri/src/corpus/` (`ids`, `walk`, `search`, `sections`,
      `grants`, `edits`, `canvas`, `store`, `log`, `tools`), taking explicit
      `Roots { notes, data }` instead of `AppHandle`. `notes.rs` and `settings.rs` are
      now the thin Tauri layer over it; `lib.rs::app_paths` is the one place the app
      answers "where are the roots". Behavior unchanged.
      _What it bought:_ `notes.rs` had **zero** tests, because everything took
      `AppHandle`. The suite went **36 → 110**. The new ones cover what had only ever
      been checked by running the app and looking — id resolution through mounts, a real
      folder shadowing a mount, `files` rules as an access boundary — plus the ones that
      matter most: an `off` project's refusal is byte-identical to a missing note's, a
      write pin never widens a grant, and reads are never logged. One test greps the
      module for `tauri`, so the no-Tauri boundary is checked rather than trusted.
      _One latent panic found while moving code, not introduced by it:_ `excerpt` sliced
      a line at a byte offset found in a **lowercased** copy of it, and case folding can
      change a character's byte length — a long line with certain non-ASCII characters
      could have panicked on a non-boundary slice. It walks back to a boundary now.
      **Steps 2–3, the helper and the read server.** `src-tauri/src/bin/asapnotes-mcp.rs`
      takes a command in argv and its arguments as JSON on **stdin** (note content is
      arbitrary text; argv would give every shell on the way a vote), and always emits an
      envelope so a refusal is distinguishable from a crash. `mcp/` is the stdio server
      on the official SDK — **its own package**, so the app's dependency footprint and
      summon latency are untouched.
      **Steps 4–5, writes and the convention layer.** `write_section` (which keeps the
      heading line — see the doc), `append_to_note` (creation rides it, so adding a note
      is one call), `expect_unchanged`, the write log, plus the `asapnotes://convention`
      resource, three prompts, and `append_todo` / `new_decision` — which grant nothing
      extra, they compose the same calls an agent could make itself.
      **Step 6 partly:** `mcp_status` and `set_mcp_current_project` commands exist and
      `src/notes.ts` exposes them; the Settings **UI** is still that item's own work.
      **Searching, since it was named as the most important part.** Two tools, because
      they cost different amounts: `find_notes` matches note **ids** and opens nothing,
      `search_notes` reads contents. Still a plain scan with no index — an index would
      have to be kept honest against every other tool that edits these files — but it
      narrows before reading (a `project` filter drops files unopened, a whole-file check
      skips the per-line pass, a `per_note` cap stops one long file eating the result),
      and **every hit names the heading path it fell under**, so the next call is a
      section read rather than a whole-note read. The listing carries heading trees on
      request and never content.
      **The write pin, which the design did not have.** `mcp.writeScope: "current"`
      confines writes to the project the app is on; everything stays readable. The app
      publishes the current project (and its own resolved notes root) into
      `mcp-state.json` — a file, not `settings.json`, because it changes on every tab
      switch and configuration should not churn under a hand-edited file. **The agent
      cannot lift it:** `write_settings` refuses the whole `mcp` block rather than
      validating field by field, so adding a key there can never leave a writable hole.
      **Verified live**, helper driven directly against a scratch corpus: doctor,
      outline listing, section read, search, the read-only refusal naming the settings
      key, the candidate-listing error on a missed section, the pin refusing with nothing
      current and then allowing the pinned project, canvas create → validate → the
      blind-overwrite refusal → read, and settings refused while off. Plus 23 end-to-end
      tests driving a **real MCP client over a real server over the real Rust binary** —
      nothing mocked, because the seams are what break.
      _2026-08-20, driven by a real client over real stdio against a 361-note corpus._
      The descriptions do teach the cheap path (find/search → outline → section read,
      and `expectUnchanged` on the way back), and search feel is a non-issue at that
      size: every call landed in 27–86 ms, whole-corpus search in 42 ms, cold connect
      plus `tools/list` in 207 ms. It also found the bug the fixtures could not, because
      no limit binds under ten notes: **`search_notes` and `find_notes` spent their
      `limit` on notes the caller could not see, then filtered** — `"the" limit 50`
      returned 3 hits instead of 50. Fixed by pushing visibility into the walk; recorded
      in [mcp-tool-surface.md](mcp-tool-surface.md). Two smaller things went with it:
      outlining a whole corpus returned ~57k tokens in one call (now capped by count and
      by bytes), and a clipped result now says `truncated` instead of looking like a
      complete one.
      _Still unmeasured:_ the summon-latency claim — the sidecar touches nothing on the
      app's startup path except one `mcp-state.json` write, but that has not been timed.
      _Distribution: settled 2026-08-20._ The helper ships with the app, and needs no
      bundle config to do it — it is a second `[[bin]]` of the app's crate, so the
      release build compiles it and the bundler ships it. Confirmed by extracting the
      MSI from a plain `npm run tauri build`.
      _Still deliberately absent:_ deletes and renames over MCP, and a whole-file note
      write.

- [ ] **Review the in-editor markdown rendering — marker weight, type scale, font**
      (2026-08-19) — feedback, verbatim intent: the mixed markdown view "looks strange
      and hard to read", and it "should match closer to the real .md render so it
      doesn't look 2 different". Five asks, none settled; the whole item is typography,
      so it is candidate-sheet material. Mechanics scouted first:
      **What's there now.** `livePreview.ts` never hides a syntax marker — by design
      (its header comment): `HeaderMark`/`EmphasisMark`/`CodeMark`/`StrikethroughMark`/
      `QuoteMark` all take one flat `.cm-syntax` (a single literal `#9a9a9a` at 0.6
      opacity, with no dark-theme value, while the `--syn-marker` token that _does_
      have one is spent only on thematic breaks). Crucially the marker **inherits the
      size and weight of the text it formats** — so `##` on a level-2 heading paints at
      1.3em bold and `**` around bold words paints bold. The markers are the loudest
      part of the formatting they describe, and they push the text right by their own
      width. Two families have to converge for "not look 2 different": the live-preview
      family (note editor, diff lens, read-only file lens — all three call
      `livePreview()`; heading scale 1.5/1.3/1.15em, no block margins) and the
      `renderMarkdown` family (preview pane on Ctrl+E, canvas static text blocks —
      browser-default h1 at 2em with browser-default margins). That gap _is_ what the
      feedback is measuring.
      **(1) The bold pair should read more compact once the bold applies.** Leans,
      cheapest first: (a) markers get their own type instead of inheriting — a fixed
      small size (~0.7em of their context) at normal weight, so a marker never inherits
      bold or a heading's scale; (b) tighten the pair's advance width (letter-spacing /
      negative margin) so it costs about one character cell; (c) replace the pair with a
      widget while the caret is off the line — the `BulletWidget`/`ImageWidget` pattern
      is already in the file with the `onCursorLine` guard, so the literal characters
      return the moment the caret enters the line. (c) is the strongest visual answer
      and the only one that can reach zero width; the trade is caret arithmetic — the
      caret steps over a replaced range as one unit.
      **(2) Same for `##`.** One lean specific to headings, on top of (1): the marker
      leaves the text flow and hangs in the left gutter (zero advance, negative
      margin), so heading text starts on the same left edge as body text instead of
      being pushed right by one indent per level. Best guess at the largest single
      contributor to "hard to read" — today the left rag zig-zags with heading depth.
      **(3) "Maybe stack them on top of each other so it fills less space
      horizontally."** Read literally: `##` becomes two `#` in one character cell (two
      rows at half line-height), the bold pair likewise — widget territory, i.e. lean
      (1c). _Open question worth answering before any of it is drawn:_ does "stack" mean
      literally stacked glyphs, or just "the marker must not cost horizontal space"? —
      because (2)'s gutter-hang and a small level badge both satisfy the second reading
      at much lower risk. The sheet should show all three at real size, side by side.
      **(4) The font.** Open — no direction given beyond "not the greatest". What's
      there: the editor inherits the UI face (Inter / "Segoe UI") at 0.95rem/1.6 and
      has no measure cap, so on a wide window body text runs the full pane width.
      Leans: split the _note body_ face from the UI chrome face and give the body a
      reading face; and cap the reading measure. Hard constraint: any face must be
      bundled with the app or already on the system — a webfont fetched at runtime is
      out (no unrequested network connections). Ladder for the sheet: today's UI face /
      a humanist sans / a text serif / a system UI face one step larger, each crossed
      with line-height and measure.
      **(5) The italic `_` should look better.** Takes (1)'s compact-marker treatment,
      plus its own problem: an underscore sits on the baseline, where it competes with
      descenders and with underscores inside identifiers. Extra lean: marker color
      moves from one flat gray to per-kind tokens, so heading / bold / italic markers
      are distinguishable without getting louder — and `.cm-syntax` finally gets a dark
      value (or moves onto `--syn-marker`, which already has one).
      **The lean that ties it together:** one shared markdown type scale — heading
      sizes and weights, block spacing, blockquote, code, list indent — as CSS tokens
      read by _both_ families, rather than tuning the editor alone and drifting again.
      `HighlightStyle` already reads `var()` for its colors, so sizes can ride tokens
      the same way. The cheap alternative (nudge the editor's numbers toward the
      browser's defaults by hand) is deliberately not leaned: it is the same drift, one
      round later.
      **The one question that changes everything downstream:** may markers _disappear_
      off the cursor line? Today they never do, on purpose — the visible marker is what
      makes it obvious where formatting starts and ends. If that invariant is
      negotiable, most of (1)–(3) stops being a typography problem and becomes a
      four-line change. If it holds, the compact-marker design is the work. Not assumed
      either way.
      _2026-08-19, both answered:_ **markers must stay visible** — the invariant holds, no
      treatment may hide a marker off the cursor line, so the compact-marker design _is_ the
      work; and on the stacking question the user asked to see all three readings drawn
      before choosing. **Candidate sheet published same day, awaiting picks.** Two more
      findings the scouting turned up, both recorded on the sheet: `.cm-bullet` (`#7a7a7a`)
      has no dark value either — the same bug as `.cm-syntax`, twice; and **`Inter` is named
      in `App.css` but never bundled** (no `@font-face`, no font assets, and it is not
      installed on this machine), so every note has in fact been rendering in Segoe UI while
      the CSS asked for Inter. The sheet quantifies the "2 different" complaint too: a
      level-1 heading is 22.8px in the editor and 32px in the preview pane (+40%), and the
      editor has no space between blocks at all against the preview's 16–21px.
      _Four decisions on the sheet, each drawn at the editor's real metrics (15.2px/1.6, the
      app's own stack) on both real grounds:_
      **(D1) Marker geometry, six treatments** (color held constant so only geometry varies):
      **A** today (reference) — the marker inherits size, weight and slant; **B** compact
      inline — the marker takes its own type (0.7em, weight 400, never slanted), stays in
      flow, CSS-only; **C** gutter hang — B plus heading markers out of the flow into a 30px
      gutter so every line shares one left edge, CSS-only; **D** stacked glyphs in flow — the
      literal reading, `##` as two `#` in one cell, needs a widget, and its weakness is drawn
      honestly (a lone `#` and a lone `_` have nothing to stack, so three kinds end up with
      three geometries); **E** level badge — an `H2` chip in the gutter; **F** gutter stack
      (recommended) — C and D composed, the heading marker stacks into one cell _and_ hangs
      in the gutter, so the gutter costs 18px instead of 30px, while inline bold and italic
      stay real characters at real width (keeps the stacking instinct where it pays without
      forcing it on a single `_`, and no caret surprises mid-sentence).
      **(D2) Marker color, three variants** on top of F: today's flat literal (reference) /
      one gray properly tokenised onto `--syn-marker` (one line, fixes dark) / a hue per
      marker kind (recommended — structure neutral gray, emphasis cool blue-gray, literals
      warm gray, all low-saturation).
      **(D3) The face, six rungs** at real width so measure reads: what ships today (Segoe
      UI, uncapped) / real Inter fetched for comparison, to judge whether the original intent
      was even right / Segoe UI at 16px/1.65 capped to 72ch, to separate settings from face /
      Candara / **Sitka Text (recommended** — drawn for on-screen reading, ships with the OS,
      and the strongest case for splitting the note-body face from the UI-chrome face**)** /
      Constantia. Each rung states its shipping cost; bundling a woff2 subset is the only
      option that isn't free, and a runtime font fetch is out.
      **(D4) The shared scale** — the same note in editor and preview, today versus both
      surfaces reading one token set, with the proposed values written out
      (`--md-base: 1rem`, `--md-line: 1.65`, h1/h2/h3 at 1.6/1.32/1.14em, weight 650,
      `--md-block-gap: 0.55em`, `--md-measure: 72ch`).
      _The sheet (temporary working link, private to this account — delete with this item):_
      (a private working page, since removed)
      _No code yet._ Candidates compose, and once picked the slice lands across
      `livePreview.ts` and `App.css` — the shared scale reaches all five surfaces at once
      (note editor, diff lens, file lens, preview pane, canvas text blocks).
      _2026-08-19 round 1 picked: **F, gutter stack** (C and D composed) — with two
      refinements that were faults in the drawing, not preferences._ **Round 2 published
      same day on the same sheet, awaiting picks.**
      **(R2a) The stacked mark needs a rule for depth.** Round 1 drew every level at one
      glyph size, and the arithmetic is worse than "tight": at 9.4px glyphs a level-4 mark
      stands 20.7px and a level-6 mark 31px inside a 24.3px line, so from level 4 up it
      collides with the lines above and below. Sharper because levels 4–6 all render at the
      same size and weight in the app — the mark is the _only_ thing distinguishing them, so
      it cannot be the thing that degrades. Four rules drawn over levels 2–6, with marks that
      outgrow their line outlined in red rather than left to clip: **G1** one size for every
      level (the fault, as reference); **G2** a hand-picked size per level, 10px down to
      6.5px — everything fits but level 6, at the price of five magic numbers with no rule
      behind them; **G3** constant cell height, glyph size = cell ÷ hash count — fits every
      level by construction and forever, but legibility collapses exactly where it is needed
      (4.4px at level 5, 3.7px at level 6); **G4** wrap to two columns at level 4
      (recommended) — glyphs stay fixed at 9.5px and the _mark_ wraps instead, so `####`
      reads as a 2×2 block and `######` as 2×3, nothing ever falls below 9.5px, height never
      passes three rows, and it still fits the same 18px gutter because a second column costs
      about 6px. Marker sizes are absolute px, not em, across all four — a consequence of
      this ask worth keeping: a mark sized in em inherits its heading's scale and so reads
      differently at every level, which is half of what made the original look wrong.
      **(R2b) The blockquote `>` belongs inside the vertical rule, not beside it.** Requested
      verbatim. It makes the rule and the marker one object instead of two devices doing one
      job — and since the rule is 3px and the glyph about 10px, something has to give. The
      hard part is the repeat: every line of a blockquote carries its own `>` in the file and
      the visibility invariant says none may vanish, so whatever the treatment is, it happens
      on every line. Two-line quotes drawn throughout for exactly that reason. Four
      treatments: **Q1** today, `>` as the first character after the rule (reference);
      **Q2** a break in the rule with the glyph in the gap, centred on the rule's axis
      (recommended — literally the `>` inside the line, at the rule's original weight, and it
      costs zero horizontal space, so quotes indent no further than today; the thing to judge
      is that a multi-line quote then reads as a dashed rule rather than a solid one);
      **Q3** the rule widens into an 11px tinted band with the glyph inside it (unbroken edge
      however long the quote runs, and the band reads as one block — but it costs ~8px more
      indent and changes what a quote _looks like_, not just where its marker sits);
      **Q4** the `>` hung in the gutter beside an untouched rule (the most consistent option —
      one gutter for every marker kind — but not what was asked for; on the sheet so the
      simpler answer is on the table).
      _Both round-2 sections sit at the top of the same sheet; round 1's A–F, the color
      variants, the font ladder and the shared-scale comparison stay below for the record,
      with D1 marked settled. D2 (marker color), D3 (the face) and D4 (the shared scale) are
      still open._
      _2026-08-19 round 2 picked: **G3, the constant cell** (chosen over the recommended G4
      wrap — one expression and no per-level table won), and the quote ask came back
      redirected. **Round 3 published same day, same sheet, awaiting picks.**_
      **(R3a) G3's constants were wrong in the drawing, not its rule.** Round 2 set G3's cell
      at 12.1px inside a 24.3px line, so it gave away half the height it was free to use
      before it began shrinking the glyph — hence the 3.7px tail that made it look like the
      weak option. Same expression, honest constants, two settings drawn: **G3a** as round 2
      drew it (reference) versus **G3b** cell = the line's usable 19px, capped at 10px so a
      shallow mark never outgrows the body text, floored at 6px as the size below which a
      hash stops being countable (recommended). Every level gains: 10 / 10 / 8.6 / 6.9 / 6px
      against G3a's 11 / 7.3 / 5.5 / 4.4 / 3.7px, no level overruns its line, and the
      property that won G3 survives — one expression, `min(cap, max(floor, cell ÷ count))`,
      no table. Known costs of G3b: levels 2 and 3 both sit at the cap so the two shallowest
      marks are the same size, and 6px at level 6 is legible rather than comfortable — if
      that ever matters, round 2's G4 wrap stays available as a fallback for depths 5–6.
      **(R3b) The quote rule must not break at all.** Requested: keep Q2's glyph position but
      let the rule run through unbroken, the two told apart by slightly different colors so
      both stay visible. That retires Q2's gap and Q3's band; Q4's gutter answer stays on the
      sheet as a fallback. Three tones now in play — rule `#c9c9c9`/`#5a5a5a`, glyph
      `#8e8e8e`/`#a5a5a5` (a clear step from the rule in both themes), and for one candidate
      a third lighter rule tone. Three treatments: **Q5** glyph centred on the rule's axis
      with the rule running straight through it (recommended — the literal ask; continuous
      edge however long the quote runs, zero horizontal cost, only two tones, and the rule
      passes through the open side of the `>` so the mark reads as sitting on the line);
      **Q6** glyph nudged right so its point sits against the rule's edge rather than over it
      (nothing overlaps, so both are perfectly crisp and the mark appears to point out of the
      line — but it is beside the rule again, which is what the redirect rejected, and it
      eats ~7px of the rule-to-text gap); **Q7** unbroken but the rule steps to a third,
      lighter tone for the 14px the glyph crosses (maximum separation, at the price of three
      tones for one small device and a rule that looks banded down a long quote).
      _2026-08-19 round 3 picked: **G3b** (the cell rule on honest constants) and **Q5**
      (unbroken rule, glyph on its axis a tone darker). Marker geometry is now specified
      except for one request that arrived with the picks: carry the `>` **only on the quote's
      first line**, at that line's height, so the mark reads as where the quote comes from.
      **Round 4 published same day, same sheet, awaiting picks** — that request is two
      questions, and the second one is the user's to answer, not a design lean._
      **(R4a) Where the single glyph sits.** Three placements over three-line quotes:
      **P1** a glyph on every line (the settled Q5, as reference — reads as a column of
      arrows and says nothing about where the quote begins); **P2** one glyph on the opening
      line, centred on the rule's axis at that line's own height (recommended — glyph and
      rule divide the labour, the glyph saying where the quote starts and the rule how far it
      runs, and it stays aligned with the first quoted words so the eye starts in the right
      place); **P3** one glyph pinned to the top of the rule (unmistakably an opening mark
      and never colliding with ascenders, but aligned to no line of text, so it floats
      between the heading above and the quote below and can read as decoration on the rule
      rather than a character in the file).
      **(R4b) What becomes of the continuation `>` characters — the invariant question.**
      Every line of a blockquote carries its own `>` in the file, so a single glyph means the
      rest go undrawn, and round 1 settled that no marker may be hidden. There is a fair
      reading in which this is not a breach — the unbroken rule _is_ what marks those lines,
      so the syntax stays represented, just not glyph-by-glyph — but it is the first thing on
      this sheet to touch that rule, so all three answers are drawn rather than assumed:
      **V1** not drawn, and that is the design (quietest and simplest, but a marker in the
      file never reaches the screen, and an accidentally deleted continuation `>` was never
      being pointed at); **V2** every `>` drawn but continuations at ~quarter opacity (the
      invariant holds literally, hierarchy instead of hiding, and nothing conditional — at
      the price of a glyph faint enough to miss anyway, plus a fourth tone on a device that
      already carries three); **V3** hidden while reading, all glyphs back at full strength
      while the caret is anywhere inside the quote (recommended — keeps the invariant's
      _purpose_ exactly, reading as clean as V1 and editing as honest as P1, and it extends
      the cursor-proximity machinery already governing bullets and images; the cost is that
      it is the one candidate whose appearance changes as the caret moves, and it needs the
      quote's extent rather than just its line, so the guard becomes block-scoped). Drawn
      with a third panel showing the same quote with the caret parked inside it.
      _2026-08-19 round 4 picked: **P2** and **V3**. The marker geometry is now fully
      specified and ready to build — five picks across four rounds (F, G3b, Q5, P2, V3),
      drawn in full at the top of the sheet with the complete spec beside it:_
      **Marker type** is its own, never inherited — absolute px, weight 400, upright (a mark
      sized in em inherits its heading's scale and so reads differently at every level, which
      was half of what made the original look wrong).
      **Heading marks** are glyphs stacked in one cell, hung in the gutter at zero advance so
      heading and body text share one left edge; gutter 18px, and the decoration must cover
      the mark _and_ its trailing space or a stray indent is left behind.
      **Stack size** is `min(10, max(6, 19 ÷ (0.55 × count)))` px, one column, row height
      0.55 — level 1 a single `#` at the cap, then 10 / 10 / 8.6 / 6.9 / 6.0 for levels 2–6,
      nothing overrunning the 24.3px line.
      **Inline marks** (bold, italic, code) stay compact in the flow: 0.7em, weight 400,
      upright, real characters at real width, so the caret never steps over a widget
      mid-sentence.
      **The quote rule** is solid 3px and unbroken down every quoted line. **The quote glyph**
      is drawn once per block, on the opening line, centred on the rule's axis at that line's
      height, one tone darker than the rule (`#8e8e8e`/`#a5a5a5` against `#c9c9c9`/`#5a5a5a`).
      **Continuation `>` characters** are undrawn while reading and every one returns at full
      strength while the caret is anywhere inside the block — the existing cursor-proximity
      guard, made block-scoped. _This narrows the round-1 visibility invariant deliberately:_
      markers may be undrawn while reading a quote's continuation lines, because the unbroken
      rule marks them and the real characters come back wherever the caret is. The precedent
      is reusable — the same block-scoped reveal could quiet heading and emphasis markers
      later without ever truly hiding them.
      _Build surface: `livePreview.ts` takes the heading-mark widget, the block-scoped quote
      guard and the per-kind mark classes; `App.css` takes the marker type, the gutter, the
      rule and the tokens. Still gating the rest of the slice, all three drawn on the sheet
      since round 1 and still unanswered: **D2** marker colour, **D3** the face, **D4** the
      shared type scale._
      _2026-08-19 the last three answered, all as recommended — the design is complete and
      building starts:_ **D2 a hue per marker kind** (structure neutral gray, emphasis cool
      blue-gray, literals warm gray, all low-saturation, three token pairs);
      **D3 Sitka Text** for the note body at 16px/1.65 with the measure capped to 72ch —
      which also splits the note-body face from the UI-chrome face, chrome staying a sans
      (system face, no bundle, needs a serif fallback for other platforms; note that `Inter`
      stays named nowhere useful — the stack's first entry was never bundled, so this replaces
      a font the app never actually had); **D4 yes, one shared token set** read by both
      families, closing the 40% heading gap and reaching all five surfaces at once.
      **Implemented 2026-08-19 — `npm run build`, `lint` and `format` clean (the one lint
      warning is pre-existing, `zoomAt` in BoardView); no Rust touched, so the cargo gates are
      not implicated. Not yet verified by eye — see the pending list.** Two files:
      `livePreview.ts` gained the per-kind mark decorations (`cm-syntax` plus
      `cm-mk-emphasis`/`cm-mk-literal`), a `HeadMarkWidget` carrying the G3b size rule
      (`headMarkSize`), a `QuoteMarkWidget`, a heading block-gap line decoration, and quote-block
      bookkeeping; `App.css` gained the marker and scale tokens and applied them to the editor,
      the preview pane and the file lens. Heading sizes and weights now ride `var(--md-h1…3)`
      and `var(--md-h-weight)` from inside `HighlightStyle`, which the existing colour vars
      already proved works — the style is still built once and the tokens resolve per theme.
      _Three scope decisions taken during the build, all deviations from what the sheet
      claimed:_
      **(1) The scale is shared as ratios, not as one absolute base.** `.board-node-text`
      deliberately runs its own compact override (0.8rem body, every heading flattened to
      0.95rem) because canvas cards are thumbnails; forcing the reading scale there would
      break card layout. So the heading steps and block gap are `em`-relative and each surface
      sets its own base. **Canvas text blocks were then left alone entirely** — even the
      reading face — rather than half-converted: the sheet's "all five surfaces" is really
      four reading surfaces (note editor, diff lens, file lens, preview pane), and cards keep
      their own deliberate scale. Worth revisiting only if canvas text blocks stop being
      thumbnails.
      **(2) Heading marks give way to the real characters on the caret's line.** A
      `Decoration.replace` cannot be typed inside, so a permanent widget would make `##` →
      `###` impossible by typing — only by selection. The build uses the `onCursorLine` guard
      that already governs bullets and images: stacked mark in the gutter while reading, raw
      compact characters when the caret is on that line. Cost is a small horizontal shift when
      the caret enters a heading, exactly the one bullets already have. This was never drawn
      on the sheet, which only ever showed the reading state.
      **(3) The reading face is scoped to markdown notes.** `.editor:not(.editor-plain)` takes
      Sitka Text and the shared scale; a plain-text note keeps the interface face, since it is
      as likely to hold config or code as prose. `.file-lens-text` stays monospace.
      _Pending hands-on — a visual change, so compiling clean proves little. The dev instance
      running during the build hot-reloaded both files, so the change is already live in it.
      What needs eyes:_ (a) `max-width: var(--md-measure)` on `.cm-content` — whether capping
      the measure disturbs click-to-position or the scrollbar at wide window sizes; (b) the
      heading stack's vertical centring at each level, and whether the zero-width host really
      holds it steady on lines that carry the block gap; (c) the quote glyph landing exactly on
      the rule's axis, and the block reveal firing on caret entry; (d) Sitka Text at 16px in
      both themes against the interface sans around it — the one pick made from a specimen
      rather than from the app; (e) whether the 18px gutter is enough for a level-6 stack; and
      (f) the preview pane and editor genuinely reading as one render now.
      _2026-08-19 follow-up: **the inline bold pair now stacks too.**_ Reported after the
      build: the `**` was compact but still ran along the line. Verified the compact type _was_
      applying (0.7em, weight 400) — what was missing was the vertical stacking, which
      round 1's F deliberately withheld from inline marks on a recommendation the original ask
      had already contradicted ("maybe even kinda stack them on top of each other so it fills
      less space horizontally"). F's exclusion is therefore **superseded for marker runs of two
      or more characters**: an `EmphasisMark`/`StrikethroughMark` of length ≥2 (`**`, `~~`) is
      replaced by a `MarkStackWidget` that stacks in the flow, so the pair costs one glyph of
      width instead of two. A single character (`_`, `*`, a backtick) still has nothing to
      stack and keeps the compact inline treatment; the caret's own line shows the real
      characters, as with heading marks, so `**bold**` stays editable by typing. The size rule
      and the stack DOM were hoisted on this second use — `stackGlyphSize` and `glyphStack`
      now serve both the heading marks and the inline pairs, so a two-glyph stack is 10px in
      both places. Gates clean again.
      _Note for the next session: `livePreview.ts` was edited in the working tree while this
      slice was being built_ — the `ListMark` case became a list-cell treatment
      (`listLine`/`listDepth`/`listBullet`/`listMark`/`hidden`) and `BulletWidget` went away
      with it. The marker work above sits alongside that cleanly and all gates pass on the
      combined tree, but the two were written independently and have not been looked at
      together by eye. Worth checking that list marks and the new per-kind marker colours read
      as one system rather than two.

- [ ] **Link targets collapse to their label; tooltip width fix** (2026-08-19) — requested
      while the marker slice was landing: a file mention should "hide the real path and show
      the `[]` only, unless we have the cursor in it, or if we hover it for a bit". A mention
      writes an ordinary markdown link, so this is about every inline link, not only
      `@`-mentions — there is nothing in the file that distinguishes one. **Three decisions
      taken, all as recommended, then built the same day; gates clean.**
      **(1) The caret reveal is node-scoped, not line-scoped** — the path returns when the
      caret touches _that_ link's range (either end counts, so a caret parked just after a
      link can still edit it). A new `onNode` helper beside the existing `onCursorLine`: a
      line holding three links opens only the one you are in, where the line-scoped guard
      would reflow all of them.
      **(2) Hover shows the path in the app's own tooltip**, via a mark decoration carrying
      `data-tip` — `Tooltip.tsx` already has a 300ms dwell and the `overflow-wrap: anywhere`
      that exists precisely so paths can break, and `links.ts` already proves the pattern of
      hanging a `data-*` attribute on a mark decoration. Rejected: expanding the path inline
      on dwell (the line reflows under the pointer that is holding the hover) and
      CodeMirror's own `hoverTooltip` (a second tooltip UI to style and keep consistent).
      **(3) The brackets stay**, dimmed — only `(path)` is hidden, so a link still reads as a
      link instead of as ordinary prose. A reference link (`[label][ref]`) has no URL child of
      its own and is left exactly as it was.
      _Verified while reading, not assumed:_ Ctrl+Click does not break — `links.ts` resolves
      its target from the document and carries it in a `data-link` attribute, never from the
      rendered text.
      _Worth naming: this crosses a line the quote work did not._ A `>` is syntax; a path is
      **content**. The note's own text is now invisible until the caret enters the link or the
      hover dwells. Mitigations are the two reveals plus the file being untouched on disk, but
      it is a further narrowing of the round-1 visibility invariant and the first one to hide
      something that is not a marker.
      **Tooltip width fix, shipped with it** (its own small bug, found by report: hovering the
      titlebar close button showed a vertical column of characters "that looks like a
      function"). `.tooltip` is `position: fixed` with `left` set and no width, so an anchor
      near the window's right edge left it only the handful of pixels to the edge, and
      `overflow-wrap: anywhere` then broke the text at every character. The measured re-fit in
      `Tooltip.tsx` cannot recover, because it measures the box _after_ the collapse. Fixed
      with `width: max-content`, so an explicit width replaces shrink-to-fit and the `left`
      offset stops squeezing it; `max-width` still caps long paths and the existing clamp now
      works on a real measurement. This also fixes minimize/maximize and any other tip
      anchored near an edge — and it is a prerequisite for (2), since a collapsed tooltip is
      exactly what a hovered link near the right edge would have produced.
      _Pending hands-on:_ that the collapse and both reveals read well at speed, that the tip
      fires on the label rather than needing the exact bracket, and the close-button tip.
      _2026-08-19 list geometry — feedback: "the bullet indentation doesn't look perfect",
      and put the marker "in the exact place the dot would be". The reference was named
      explicitly — the rendered pane is right, the editor is what moves._ Three faults, one
      cause: the editor indented by the characters the note holds, while the rendered pane
      indents by **nesting depth** — two spaces or four both make one level there, and about
      8px of proportional space here. **(a)** The `•` widget is gone; a list marker is now the
      note's own character (`-`, `*`, `+`, `10.`), which also ends the horizontal shift the old
      widget caused whenever the caret entered a list line, since there is no substitute glyph
      left to swap back. **(b)** A list line indents by `depth × --md-list-step` and the marker
      hangs into the step it opens, its cell ending one `--md-list-gap` short of the text — so
      every item's words start on one edge whatever its marker is, and wrapped lines land under
      the words rather than under the bullet. Continuation lines an item carries (a hard-wrapped
      sentence, a second paragraph) take the same indent; lines a nested list owns take theirs
      from their own marker. **(c)** The typed indent and the marker's trailing spaces are
      hidden — still the note's own text, still selectable and deletable, just not drawn, since
      the depth they encode is now drawn by the step.
      `--md-list-step` is `2.5em`, which is exactly what the preview pane was already doing by
      browser default; the pane's `padding-left` is now spelled out in that token instead, so
      the editor has a number to match rather than a default to be measured against. **The
      rendered pane therefore does not change** — deliberately, it is the reference. One
      convention deviation: `.cm-list-mark` is unscoped where the other marker rules are
      `.editor`-prefixed, because the line's indent rides on the decoration's own inline style
      and the cell has to follow live preview wherever it is mounted (the diff lens included).
      Gates clean; no Rust touched.
      _Not seen by eye, and one number is a guess:_ `--md-list-gap: 0.5em` puts the dash where
      the browser's disc sits, reasoned rather than measured — if it reads too far from or too
      close to the text, that token is the single knob. Also unchecked: caret travel through
      the hidden indent (two dead left-arrow presses at a two-space level), and the diff lens,
      where an added list line's inline `padding-left` now beats `.cm-lens-add`'s 0.5rem
      compensation.
      _Left alone deliberately:_ a nested list in the rendered pane still carries
      `--md-block-gap` above and below, which the editor has no equivalent for — a vertical
      mismatch the left-axis fix does not touch, and an unrequested change to the reference
      surface.

- [ ] **Map lens: remembered camera, ghost reference lines, plain title boxes, zoom
      slider, export moved to File** (2026-08-19) — a third feedback batch on the map
      lens, all five asks settled the same day and built. Design pass first, one
      question each; every recommendation was the pick.
      **(1) The camera survives.** The lens recomputes on every activation, so its tab
      remounts and the surface used to refit — you lost your place each time you
      glanced at a note. `BoardView` gained `camera` (read once at mount) + `onCamera`;
      the App keeps a `Map<mapTabId, Camera>` in a ref and hands it back. No camera →
      fit on mount, exactly as before, so canvases and the annotation lens are
      untouched. Rejected: keeping the tab mounted (a stable key would also fix
      recompute flicker, but a tab switch still unmounts, so it doesn't answer the
      ask). Deliberately left alone: real `.canvas` tabs still refit on activation —
      the same three lines would fix them, unasked.
      **(2) Reference lines inverted.** The 2026-08-17 model — hide the lines of a card
      with more than three outgoing edges — showed exactly the sparse, least
      interesting lines and hid the hub's, which was backwards ("those are usually the
      most irrelevant"). `HIDE_EDGES_PAST` and the hub concept are gone. Now **every**
      line draws, in a ghost layer at ~0.11 opacity (0.16 dark): enough to read the
      shape of the map, quiet enough not to clutter. Hovering a card lifts its lines
      out of the ghost layer in the plain line color; clicking **pins** them in a color
      from the six presets, picked by position in the click order, and the card wears
      that same color — so two pinned cards' bursts can't be confused. Pins are
      additive and sticky (clicking another card keeps the first); clicking a pinned
      card unpins it; clicking the background clears them all. Ghosts paint first so
      lit lines lie on top. The degree balls went back to being pure counts — the whole
      card is the toggle now, which deleted the ball's click plumbing. One fix the
      inversion forced: a lens no longer renders the fat invisible click-twin each line
      carries, or now-that-every-line-draws they would blanket the surface a plain drag
      pans. Alternative offered and declined: separate green/orange balls for
      incoming/outgoing traces.
      **(3) Cards with nothing to show are plain title boxes.** Compact cards were
      110×68 with a grey "file" tag under a two-line title — vertical air for nothing.
      Now the full 220×150 card is for **a note with text to excerpt**, and everything
      else is 110×50: a referenced file the lens can't render, and a note with nothing
      written in it (the compute already reads every note, so blankness costs nothing
      to know). The "file" tag is gone — icon plus name already say what it is —
      while "missing" stays, because that one is news. Images are the exception at
      110×96: they show their own content, so the box keeps room for the thumbnail.
      Needed `IMAGE_FILE` hoisted from `App.tsx` into `paths.ts` (its second real use).
      **(4) A zoom slider.** The board's overlay bar was already at the top, so the
      slider joined its zoom cluster: logarithmic, `min=-1 max=1`, the middle exactly
      100%. Zoom bounds widened from 0.25–2 to **0.1–10** (module-wide, so canvases get
      the range too; `fit` still clamps at 100%). `zoomAt` was refactored into
      `zoomAround(px, py, next)` so a wheel step and the slider's absolute level share
      one path instead of a third copy of the transform, and the "100%" button now
      keeps the view's middle put instead of jumping.
      **(5) "Save as canvas…" left the surface.** The map's snapshot writes a file, so
      it belongs with the file verbs: **File ▸ Export as canvas…**, gated on the map
      being the open tab, plus the same entry on the map surface's right-click menu.
      The bar button is gone; the annotation lens keeps **Save into image**, because
      flattening is what that tab is for. `saveMapAsCanvas` → `exportMapAsCanvas`.
      **Verified live** (second instance over the devtools protocol, scratch project of
      7 notes — a 6-out hub, back-links, an empty note, refs to a `.rs`, a
      `package.json`, an icon `.png` and a dead link; full cleanup, settings.json
      confirmed untouched): 15 ghost lines at rest and nothing lit; pin the hub → 8
      lines in preset 1 with the card ringed to match; pin `d.md` too → both sets stay,
      the second in preset 2; hover a third card → one extra line lifts uncolored;
      unpin → its lines fall back; background click → all 15 ghosts again. Card sizes
      at 100%: 220×150 for notes with text, 110×50 for the empty note and the two file
      refs, 110×96 for the image, no clipped titles (48 clipped a two-line name by a
      pixel; 50 is the fix). Slider ends read 10% / 100% / 1000% and stay
      centre-anchored. Camera: pan to 71%, switch to a note tab, come back — the
      surface transform came back byte-identical. File menu carries "Export as
      canvas…" only on the map tab; running it wrote `map.canvas`, opened it editable,
      and there all 15 edges draw plain with their click-twins back.
      _Pending hands-on:_ ghost opacity on a real, dense corpus in both themes (0.11 /
      0.16 was picked on a 7-note map); whether pin colors shifting when an earlier pin
      is removed reads as a bug (color = position in the click order); the 110×50 box
      against real long file names — a "missing" tag still crowds the title into its
      two-line clamp; and whether the widened zoom range wants a keyboard step.
      _Noted, not touched (pre-existing):_ a real file under a registered project that
      the corpus doesn't list still reads "missing" when its extension is a known note
      type — `package.json` under the repo project showed the badge.

## Today (2026-08-17)

- [ ] **Project map: degree balls, layout density, compact ref cards, wrapping titles,
      in-editor open** (2026-08-17) — a second feedback batch on the shipped map lens,
      arriving with confirmation that the edge-decluttering ask (item (3) under the
      2026-08-16 follow-ups) is going ahead. Five asks, design pass in flight:
      **(1) Degree balls.** Each file card wears a small ball on its left edge (green,
      the count of incoming references) and its right edge (orange, the count of files
      it references). This _supersedes the badge lean_ on follow-up item (3) — the
      balls are the discoverability hint for hidden edges, and the orange ball is the
      natural click target for the color-coded reveal. Leans: counts computed in
      BoardView from the document's edges (true for the map and for any saved canvas
      alike; stamping counts at compute time would go stale in snapshots); a
      zero-count side shows no ball; colors ride theme tokens, not literals.
      **(2) The layout reads messy at real sizes.** Open point — what "messy" means
      needs pinning before picking a fix: leans, in order — split the one flat
      referenced-files mega-cluster into per-directory clusters; sort clusters
      biggest-first before row packing; judge again only after (3)–(5) land, since
      smaller ref cards + hidden hub edges remove most of the noise. Force-directed
      layout is the big alternative, deliberately not leaned (nondeterministic, a
      tuning pit, and the grid answer wasn't given a fair chance yet).
      _2026-08-17: candidate sheet published for the md-heavy-folder half, awaiting a
      pick_ — five treatments of a 22-note `docs` folder at real card metrics, both
      themes: **A** today's capped grid (reference, 1072×1200 units), **B** columns
      scale with count (one formula, cards kept), **C** title-only tiles past a
      threshold (ladder 9/12/16, lean 12; small folders keep cards), **D** referenced
      notes keep excerpt cards + degree balls above C's tile index (recommended —
      pixels go where the connections are), **E** folder collapses to a digest card,
      double-click expands (needs the single-select state the edge-reveal slice adds;
      offered as a later zoom-out layer, not a competing pick). Candidates compose —
      "D over B's ratio" is a valid pick.
      _2026-08-17 round 2, same sheet, after the user redirected:_ the file cards are
      fine as they are — the problem is the **group backdrop** committing to a box
      around many cards. Round 2 drops the box: each card wears its folder as color +
      name, same-folder cards pack tighter (gap 20 in-folder vs ~110 between), and
      subfolders read via hue families (`docs/decisions` a deeper shade of `docs`,
      full path in the label). Four treatments, awaiting a pick: **F** a folder tab
      rising from the card's top edge (the user's own instinct, recommended — changes
      the silhouette, tab doubles as the folder-edge target), **G** 3px color spine +
      one floating label per cluster (quietest; the label is the edge target),
      **H** folder-tinted header band with the path in it (no extra geometry,
      tightest packing), **I** corner badge (weak at subfolder path lengths).
      Mechanics recorded on the sheet: group nodes can stay in the computed document
      so "Save as canvas…" keeps real groups — the lens just stops painting the box;
      folder colors cycle a fixed palette keyed by path; folder-link edges retarget
      the label/tab. Round 1's A–E stay on the sheet for the record; its C/D tile
      treatments are off the table (cards stay full).
      _2026-08-17 round 2 picked: **F, the folder tab.** Round 3 published same day,
      awaiting a pick_ — the user asked for a visible hint of the main folder on a
      subfolder's tab (round 2's hue-kinship alone read too subtle). Making the link
      an explicit device also frees subfolders to take their own palette color while
      still reading as the parent's family. Four variants, each shown at 100% (parent + two sibling subfolders) and as a field scene: **F1** breadcrumb tab — a
      `docs` segment in the parent's tab material, then the subfolder's segment in
      its color (recommended: fill beats text at map zoom, the parent is named,
      siblings read as siblings; depth 3+ collapses middle segments to F2's key),
      **F2** a small parent-color key square before the subfolder's name (quietest,
      parent unnamed), **F3** the parent's tab peeking from behind the subfolder's
      (best metaphor, parent unnamed, +6px headroom), **F4** two-tone path text in
      one tab (cheapest, weakest at field zoom).
      _Round 3 picked same day: **F1.** The folder treatment is fully specified and
      ready to build as its own slice (after the in-flight batch above lands):_ the
      lens stops painting group backdrops — group nodes may stay in the computed
      document so "Save as canvas…" snapshots keep real spec groups; every note card
      wears a folder tab at its top edge (folder color + name; root notes wear
      nothing); folder colors cycle a fixed palette assigned deterministically by
      path, so a folder keeps its color across recomputes; a subfolder's tab is
      breadcrumb-segmented — parent segment in the parent's tab material, subfolder
      segment in its own color; at depth 3+ middle segments collapse to a parent-
      color key square; in-folder packing tightens (≈20 gap in-folder, ≈110 between
      clusters, +14px vertical for tab headroom); folder-link edges retarget the
      folder's tab/cluster instead of the group backdrop.
      _The approved sheet (temporary working link, delete with this item — private
      to this account; rounds 1–3 with the picked F1 rendered at 100% and as a field
      scene, both themes):_
      (a private working page, since removed)
      _Reference metrics for F1, lifted from the approved sheet's CSS so the build
      matches the approved rendering (tab values in CSS px at zoom 1):_ tab height
      20, line-height 19, font 10.5px weight 650, radius 6px 6px 0 0, positioned at
      card left + 8 and rising 20 above the card top, 1px border in the folder color
      at 55% alpha with no bottom edge so it fuses into the card. Single-folder tab:
      padding 0 9px, text in the folder color, fill = folder color mixed into the
      card surface (10% over the light card, 22% over the dark). Breadcrumb tab:
      parent segment padding 0 7px, parent's ink, fill mixed at 14%/26% of the
      parent color, then a 1px divider in the parent color at 40%; subfolder segment
      padding 0 8px in its own color at the single-tab mix. Key square (depth 3+):
      8×8, radius 2, solid parent color, 6px right margin. Mock hues, one pair each
      (light/dark): teal #2f7f93/#7cc3d6, olive #5c7d2a/#b3cf7e, rose
      #a04f6a/#e0a0b8, purple #7a4fa0/#c4a3e2.
      _Still open — four micro-decisions the mock made silently, with leans:_
      **(a) the real palette** — the four mock pairs need to become ~6 hand-tuned
      light/dark pairs (tabs are lens-only chrome, never persisted, so they are not
      bound to the spec's six canvas colors; lean: extend the mock's four with two
      more, assignment = stable hash of the folder path → index); **(b) long folder
      names** — lean: tab max-width ≈ card width − 16, middle-ellipsize the path,
      full path as the tooltip; **(c) the tab as a hit target** — lean: it behaves
      as part of its card (drag pans, double-click opens the note) in v1, no
      folder-level verb on it yet; **(d) where a folder-link edge lands** — lean:
      the cluster's first card's tab, and subfolder clusters sort adjacent to their
      parent (path sort already does this) so families sit together.
      _F1 implemented 2026-08-18, all gates clean, verified live over the
      devtools protocol; micro-decisions (a)–(d) built as leaned, one noted
      deviation on (b)._ What shipped: the lens stops painting group backdrops
      (the groups stay in the computed document, so "Save as canvas…" keeps
      real spec groups — verified in the written snapshot); every foldered
      card wears a `.board-tab` at the approved metrics, derived on the lens
      from the document's own groups by geometric containment, so any computed
      map works; breadcrumb segments for depth 2, middles collapsing to the
      key square at depth 3+; the palette is six light/dark pairs as theme
      tokens (`--folder-0..5` — the mock's four plus an amber and a blue),
      assigned by a stable hash of the folder path in `BoardView`; packing
      tightened in `projectMap.ts` (gap 20 in-folder + 14 vertical tab
      headroom, clusters 110 apart card-to-card with the unpainted group rect
      overlapping the gaps); folder-link edges land on the folder's first
      card, edges dedupe on endpoints (a folder link and a direct link to its
      first note draw one line) and self-edges are skipped; the tab is part of
      its card — a press falls through and pans, double-click opens the note,
      full path in the tooltip. The (b) deviation: no JS middle-ellipsis — the
      breadcrumb already collapses the middle, so overflow is per-segment CSS
      ellipsis with the parent segment yielding first (flex-shrink), tooltip
      carrying the full path. Verified live (scratch registered project:
      root hub + `docs` + `docs/deep` + `x/y/z`, both themes screenshotted,
      full cleanup including a stray snapshot): zero group boxes on the lens,
      tab geometry exact (card left + 8, rising 20, max-width card − 16),
      single/breadcrumb/key-square all correct, in-folder gap 20 and cluster
      gap 110 exact, hub's out-ball 3 after the dedupe, snapshot kept all
      three groups. _Pending hands-on:_ the 10.5px tab text at typical zoom,
      the six colors on both themes, long folder names, whether the tighter
      packing reads as clusters without the boxes, and the amber/blue pairs
      (they're mine, not the sheet's).
      **(3) Cards with no visible content get much smaller.** A card that renders
      only its head line (any non-`.md` target — code refs, assets, missing) takes
      the full default card size today, all body wasted. Lean: size decided at
      compute time in `projectMap.ts` by extension (layout needs sizes up front, and
      extension is the honest signal it has), compact ≈ half width × head height ×
      room for a two-line wrapped title.
      **(4) File titles wrap.** `.board-node-name` is nowrap+ellipsis today. Lean:
      let it wrap on file cards everywhere (map and editable canvases — a wrapped
      name is strictly more readable and cards clip their own overflow), clamped so
      a long name can't eat a note card's excerpt.
      **(5) Double-click opens the file in the editor, even outside scope.** Today a
      non-note target opens externally, and an out-of-corpus reference resolves
      "missing" so double-click does _nothing_ — on a map full of code references
      the dead double-click is the loudest half of the ask. Wanted: open in-app; plus
      a setting for non-`.md` files to open with the system default instead. Fork
      needing a pick (recorded with the ask): a read-only text lens tab for any real
      file (same idiom as the map lens — never drafted, never persisted) versus full
      external-file editing, which is the planned external-file-mappings item pulled
      forward (id model, grants, drafts/history all implicated). Sequences with the
      "missing"-badge look already on the handoff list — same resolution seam.
      **Picks 2026-08-17, all recommendations:** build (1), (3), (4) as leaned,
      plus the confirmed decluttering (follow-up item (3) below) and the grab
      cursor (follow-up item (1)); (5) resolved as the **read-only text lens**
      — external-file editing stays the planned mappings item; (2) runs its own
      candidate pass (recorded above, awaiting a pick).
      **Implemented 2026-08-17, all gates + tests clean (36), verified live
      over the devtools protocol; committed as `e21fc8d` (map surface) +
      `d6944d8` (file lens).** What shipped: - `projectMap.ts`: non-markdown targets get compact cards (110×68,
      extension decides at compute time); cluster layout became row packing
      that mixes card sizes (a row is as tall as its tallest item). - `BoardView`: per-node in/out degrees computed from the document's own
      edges (a snapshot saved as a canvas keeps counting right); file cards
      wear the balls — green in-count left, orange out-count right, a zero
      side shows nothing, white digits flip dark with the theme's tints. On
      the read-only lens a card with more than 3 outgoing edges hides those
      lines; clicking the card or its orange ball reveals them, each edge
      cycling the spec's six preset colors; click-away or a second click
      hides again. **(Superseded 2026-08-19 — see the map-lens item under that
      date: hiding by out-degree showed the least interesting lines, so every
      line now ghosts and a click pins one card's set.)** Render-only — "Save as canvas…" stays all-edges-shown,
      uncolored. Cursors: grab at rest, grabbing mid-pan, pointer over
      cards, grab over group backdrops. File titles wrap to two clamped
      lines everywhere (link chips keep one line — theirs is a URL). - **The resolution seam fix** (the handoff's "missing"-badge look): a
      path under a base that the corpus doesn't list reads "missing" only
      when it is note-shaped; any other extension resolves as a real file,
      so code references stop rendering dimmed. - **The file lens**: `file:` tabs with every lens etiquette mirrored
      (grep `isFileTab`), backed by a new `read_file_text` command (2 MB
      cap, binary refused with the reason, UTF-8 BOM stripped); the header
      shows the full path, a read-only badge and "Open externally"; the tab
      wears the file-type icon. Double-click routing: notes in-app as ever,
      images always the system viewer, markdown always the lens, everything
      else follows the new setting. File cards' menu gains "Open" beside
      "Open externally". - **Setting**: `openFilesExternally` in settings.json (absent = in-app),
      a Settings → Notes segmented row, `set_open_files_externally` command.
      **Verified live** (second instance over the devtools protocol, scratch
      project with a 5-out hub note, a back-link and four `.rs` refs; full
      cleanup, history-store dir included): compact 110×68 ref cards beside
      220×150 note cards, "file" badge not "missing"; balls exactly in=1/out=5,
      in=1/out=1, in=1/no-out; 1 of 6 edges drawn at rest; orange-ball click →
      6 drawn with five distinct preset accents and the card ringed; clicking
      the card body toggles the same reveal; click-away hides; grab → grabbing
      mid-pan (the `board-panning` class), pointer over cards; the name
      line-clamps at 2; double-click `s1.rs` → lens with path, badge, exact
      text (BOM stripped, after a fix this check caught) and icon tab; `file:`
      tabs never reach localStorage; the tab closed silently back onto the
      map; the setting wrote `true` and cleared back to absent in the real
      settings.json.
      _Pending hands-on:_ both themes for balls, reveal colors and the lens;
      whether 9px ball digits read at typical zoom; wrap on real long names;
      whether hide-past-3 feels right or the threshold wants tuning; the lens
      on real code-file sizes; and the layout judgment (2) with the noise now
      gone.

## Today (2026-08-16)

- [ ] **Project map follow-ups: cursor, card menu, edge decluttering** (2026-08-16) —
      three asks on the shipped map lens, recorded together because they are all
      map-surface polish. _(1) and (3) landed with the 2026-08-17 slice above;
      (2) landed 2026-08-18; (4) remains._
      **(1) Grab cursor.** The map's left-drag pans, so the surface should say so: the
      hand/grab cursor always, except while hovering something that opens (a card →
      pointer). Essentially settled — a few CSS rules on the read-only board
      (`grab` at rest, `grabbing` mid-pan, `pointer` over cards); no design pass
      needed.
      **(2) Card context menu grows file verbs.** Right-click on a file card should
      offer opening the file, deleting it, and revealing it in File Explorer — the
      explorer rows' own verbs, so the map card and the tree row speak the same menu.
      Today the read-only menu is "Open note" alone. Open points: Delete on a
      computed map deletes the _real_ note (recycle bin, same as everywhere) and the
      map must recompute after, or the dead card lingers; and what the menu offers on
      a referenced non-note file (lean: Open externally + Reveal, no Delete — the map
      shouldn't delete files the corpus doesn't own).
      _Implemented 2026-08-18 as leaned, all gates + tests clean (36), verified
      live over the devtools protocol._ What shipped: on the lens a note card's
      menu is "Open note" plus the explorer row's own `noteOps` — Copy path,
      Reveal in File Explorer, Delete note — supplied by the app through a new
      `fileVerbs` prop, so the map card and the tree row literally share the
      code; a referenced non-note file offers Open / Open externally / Reveal
      only (new `reveal_path` command — absolute existing paths only, since
      referenced files live outside the corpus); a missing target adds nothing,
      and a card whose menu would be empty now falls back to the surface menu
      instead of opening an empty box (pre-existing lens quirk, caught live).
      Delete recomputes the map when it really deleted (`deleteNote` now
      reports whether it did — cancel recomputes nothing), and `openMapTab`
      lists the corpus fresh from disk instead of from state, because a
      recompute can follow a deletion by less than a render. Accepted knock-on:
      the recompute remounts the lens, so the camera re-fits after a delete.
      Verified live: both menus' exact entries, the empty-menu fallback,
      `reveal_path` refusing relative and non-existent paths, and
      delete-then-reopen showing the deleted note as a _missing reference_
      (the hub still links it — the honest picture) with its emptied folder's
      cluster gone. _Pending hands-on:_ the Delete click through the real
      confirm dialog (native — can't be driven headlessly), Reveal actually
      opening File Explorer, and whether the camera re-fit after a delete
      feels acceptable.
      **(3) Hide a card's edges past 3; click reveals them color-coded.** A card with
      more than 3 outgoing reference edges hides those lines (a hub note otherwise
      buries the map in curves); clicking the card shows its arrows, each in a
      distinct color so they can be told apart in the burst. Design needed before
      code: clicking doesn't select anything on the read-only surface today (left-
      drag pans, a click is nothing) — reveal needs a single-select notion on the
      lens, plus a click-away to hide again; whether the hidden state shows a hint
      (lean: a small edge-count badge on the card, so hidden edges are discoverable
      rather than invisible — _superseded 2026-08-17_: the degree-balls ask under
      that date is the hint, and the orange out-ball is the reveal's click target); whether the threshold counts outgoing only (the ask
      says "out of the same file" — lean: yes, incoming lines stay); and the colors
      (lean: cycle the spec's six presets, so a revealed burst reads on both themes
      and a "Save as canvas…" snapshot keeps legal JSONCanvas colors if the reveal
      state ever persists — it shouldn't; the snapshot stays all-edges-shown).
      **(4) An open button on file cards** (added same day) — a visible affordance on
      the card to open its file; double-click already does it, but nothing on the box
      says so. Open points: always visible or hover-revealed (the MAP chip precedent
      says worded-and-visible won over hover once already; lean: hover-revealed here
      — every card always wearing a button gets loud at map density, and the card
      count badge from (3) already competes for the corner); map lens only, or every
      canvas file card (lean: both — the affordance is about file cards, not about
      the lens, and the board's cards have the same invisible double-click today);
      and what it does on non-note targets (same answer the double-click gives:
      notes open in-app, real files open externally — _superseded by the
      2026-08-17 slice: the routing is now the double-click's own — notes
      in-app, images to the system viewer, markdown to the lens, the rest per
      the `openFilesExternally` setting_).
      _2026-08-18: candidate sheet published, awaiting a pick_ — four
      placements at real card metrics, both themes, live hover states, plus a
      four-glyph ladder (composable, "A with 2"): **A** hover-revealed corner
      icon button (recommended — the product reason is map density, and the
      pointer is already on the card when the question is asked), **B** the
      same button always visible (the MAP-chip precedent applied per card —
      the sheet's field strip shows what a real map wears all day), **C** a
      worded amber OPEN chip (richest; competes with the app's amber
      where-you-are language repeated per card), **D** inline glyph in the
      head row (quietest ink, but near-invisible at map zoom). Glyphs: 1 ↗
      arrow (lean), 2 box-and-arrow (muddy at 12px, and notes open in-app),
      3 chevron (reads "expand"), 4 straight arrow (echoes the edge arrows).
      Scope stays the recorded lean — every canvas file card, not just the
      map. _The sheet (temporary working link, delete with this item —
      private to this account):_
      (a private working page, since removed)
      _Picked same day: **A with glyph 2** (hover-revealed corner button,
      box-and-arrow), the user adding explicitly that double-click keeps
      opening too — the button is an addition, never a replacement.
      Implemented 2026-08-18, gates clean, verified live over the devtools
      protocol through the real input path:_ `.board-open-btn` on every file
      card with an openable target (missing cards wear none), hidden until
      the card is hovered, routing through the same `openNode` the
      double-click uses; the press stops propagation so the surface pan /
      card drag can't eat the click; a raised draw tool hides the buttons
      (strokes go over cards). Verified: opacity 0 at rest and 1 on a real
      hover; a real click on a note card's button opened the note, on a ref
      card's the file lens with the exact path; the buttons ride an editable
      snapshot canvas too and stand down under the pen. _Pending hands-on:_
      the reveal feel (fade timing, the 20px hit target), the glyph at real
      zooms (the sheet flagged the box muddying at 12px), and hover on a
      card whose top-right is tight against a long wrapped title.
- [ ] **Double-click a project heading opens the project** (2026-08-16) — requested:
      today becoming "current project" takes opening one of the project's files; wanted
      a double-click on the project itself that moves there. Three shapes went up —
      open the map (the front door), hoist the explorer pane via override state, or
      open the most recent note — and **the recommendation was picked same day: open
      the project's map**, because it needs no second source of truth ("current
      project" keeps deriving from the open tab) and it lands the 2026-08-14 pick that
      was waiting on "opening a project" becoming a real event (its "opens onto its
      board" reading is superseded by the map pivot: the front door is the map).
      **Implemented 2026-08-16, gates clean, verified live:** double-click on a
      Notes-panel project heading opens its map (clicks originating on the heading's
      buttons are ignored; the two clicks toggle the fold twice — net zero); **a map
      tab now claims its project as the current project**, so the explorer pane, title
      bar and creation targets move with it (the changes lens still claims none). The
      palette's "Move to project" / "Remove from project" no longer appear on lens
      tabs, where they always no-op'd. Verified over the devtools protocol: pane went
      "No project" → the double-clicked project with its map tab active, a double-click
      on the heading's + did nothing, single-click expansion unharmed.
      _Pending hands-on:_ whether the fold's double-toggle flicker on double-click is
      visible enough to bother; whether double-click wants to work on the
      current-project pane's own heading too (skipped — that project is already
      current, and its chip sits right there).
- [x] **Convert a folder between virtual and real** (2026-08-16, built 2026-08-20) —
      requested: right-click a folder (or a file in one) offers converting a virtual
      folder to a real one and a real folder to a virtual one. Converting needs a
      destination pick — a virtual folder's backing directory lives in the
      virtual-folders home, so "make it real" must ask where the directory should go
      (and the reverse may ask which project the mount joins). Also requested alongside:
      manually moving files between a virtual folder and the real folder it becomes, so
      a conversion doesn't have to be all-at-once. Not designed yet; open points: what
      conversion means for note ids and open tabs (a backing-directory move re-roots
      every contained note's id — drafts, history and tabs all key off it), whether
      "convert" is move-the-directory or create-and-migrate, and how conflicts at the
      destination surface.
      _2026-08-20 — built, and **the destination pick is what got designed away**._ An
      id is `project/<at>/…` whichever shape the folder is in: `base_of` sends it into
      the mount's backing folder, and a real folder of that name shadows the mount. So a
      conversion that **keeps the name** changes no id at all — no draft to move, no
      history to move, no tab to retarget, no ledger to rewrite. The id re-rooting the
      open points worried about is a property of _moving the folder somewhere else_, not
      of converting it, so conversion doesn't ask where: "make it real" lands in the
      project under the same name, "make it virtual" lands in the virtual-folders home at
      `<project>/<at>`, which is where `create_virtual_folder` puts a new one. Wanting
      the directory somewhere specific is Detach + Associate, which already exists.
      _What shipped:_ `folder_to_real` and `folder_to_virtual` in `notes.rs`, beside the
      other mount verbs. `checked_mount_at` split so the conversion can reuse the name,
      depth and overlap checks without the "no real folder here" rule it exists to
      violate (`checked_mount_name`). A `move_dir`/`copy_dir` pair — `rename` first, copy
      then remove across volumes, the trade `move_note` already makes for one file.
      **Each direction sequences its settings write on the side that can't hide files:**
      real→virtual registers the mount _first_ (inert while the real folder is still
      there, and rolled back if the move fails), virtual→real moves _first_ and detaches
      after, so a failure part-way always leaves the real folder in charge. Refusals:
      a conflicted or missing mount, a real folder already at the name, and a
      destination that already holds a detached virtual folder's files — merging two
      sets quietly is the one thing worth refusing.
      _UI:_ "Convert to a real folder" / "Convert to a virtual folder" on the folder's
      own row, and the same pair on a **note's** row inside it with the folder named
      (`Convert "docs" to a real folder`) — that was the "or a file in one" half of the
      ask. Shared `convertFolderEntries`, which also decides when there is nothing to
      offer: the notes root, a project heading, a conflicted mount, a missing one, and
      anything **inside** a virtual folder — a subfolder of a mount has no directory of
      its own in the project, so both conversions are meaningless there and the backend
      would only refuse. That last guard was the one thing the first live pass didn't
      cover, and it was clicked through afterwards: a subfolder of a _real_ folder still
      offers the conversion; the same row, once its parent is a mount, offers nothing,
      and neither does a note in it.
      real→virtual answers with its destination so the toast can say where the files
      went, since nobody picked it.
      _Verified live_ (debug build over the devtools protocol, scratch project of three
      notes in the real notes root — one in the project, one in the folder, one two
      levels down; full cleanup, `settings.json` byte-identical afterwards, and the
      pre-existing `asapnotes/TEST` mount left alone): the three ids are **identical**
      across both conversions; both notes read back through the mount and again through
      the real folder, including the depth-4 one; the files really did land in
      `…/virtual/zz-conv-scratch/docs` and come back; the folder row picked up the
      `mount` class and the toast named the destination; the menus carry the entries in
      both shapes and in the file-row form, and the project heading carries neither; and
      the three refusals answered with the intended sentences. Renaming a note inside
      the folder was driven in both shapes as part of the fix above.
      _Pending hands-on:_ the confirm on an **external** mount (a folder the user owns
      elsewhere) — the wording and warning kind were built to match the delete-virtual
      confirm, but converting one has only been reasoned about, not clicked; and whether
      the entry belongs above Detach or below it.
      _Still open from the ask:_ moving individual files between the two shapes so a
      conversion needn't be all-at-once. `move_note` already carries a note's draft and
      history to a new id, so what is missing is only a way to aim it at a folder — a
      "Move to…" picker, or drag-and-drop in the explorer (there is none anywhere yet).
- [ ] **Project board: auto-generate the layout from the project's structure**
      (2026-08-16) — requested: an option on the project board to generate its content
      from what the project already knows — notes as file nodes, an `.md` referencing
      other `.md`s (mention links) becoming edges, and the folder a note lives in
      grouping its notes (the spec's `group` nodes are the natural fit). Wanted on the
      project board specifically, and interesting for any canvas holding a project's
      notes. Also in the same ask: the project's canvas "should be by default a canvas
      file" — read as the board being the project's default open surface, which is
      picked reading (1) of the canvas-as-default-open item under 2026-08-14 ("project
      opens onto its board", waiting on "opening a project" becoming a real event);
      flag if a different reading was meant.
      _2026-08-16 design pass — four decisions up as options, **three picked as
      recommended, one refined by the user**:_ **(1) additive only** — Generate places
      what's missing (unplaced notes, new reference edges, new folder groups) and never
      moves or removes anything hand-placed; running it twice is safe by construction,
      no rebuild verb, no preview machinery. **(2) real edges in the file** — generated
      reference edges are normal JSONCanvas edges other tools can see, deduped by
      endpoints on re-run; accepted consequence, stated plainly: deleting a reference
      in the `.md` does not remove its edge — the board is a snapshot, not a mirror.
      **(3) folders become group backdrops** — the spec vocabulary already renders.
      **(4) grid per folder group**, with the user's own refinement: nesting worried
      them ("wouldn't it become strange if there's more than 1 layered?") and the
      answer is **one flat layer of groups keyed by full folder path** — `recipes` and
      `recipes/desserts` are two side-by-side groups, the path label carrying the
      hierarchy, groups never nest (which would also compound the parked
      group-drag-doesn't-carry-members question). Still open before code: where the
      verb lives (lean: board toolbar + surface context menu + palette, like every
      other board verb), and reference extraction (markdown links resolved relative to
      each note, the same resolution mention links use; no Rust-side extraction exists
      today, so it's either N note-reads on generate — fine for an explicit verb — or
      a small backend command).
      _Extension requested 2026-08-16:_ the generated map should cover **references to
      files and folders, not just `.md` → `.md`** — an `.md` linking an asset, any real
      file, or a folder gets a visual representation of that reference. Files are the
      easy half: the spec's `file` node already points at any path and the board's
      target resolution already answers "image / other real file / missing", so a
      referenced file becomes a placed file node plus an edge. Folders are the open
      design half: a `file` node pointing at a directory (spec-legal, but what does its
      card show and what does double-click do) versus routing the edge to the folder's
      _group_ backdrop when that folder is already on the board as a group — an edge to
      a group is spec-legal and reads as "references this cluster". Also open: whether
      images the note embeds inline count as references worth an edge, or only explicit
      file/folder links do — lean: skip embedded images, map pointed-at links.
      **Re-designed 2026-08-16, same day — the pivot is the user's:** _"the goal is to
      view the project connections"_ — the project surface becomes **a computed,
      read-only map**, not an editable board that generation adds to. Three picks:
      the map **replaces** the editable board as what the project chip opens (any
      `.canvas` file stays fully editable — it just isn't the project's front door,
      and existing `board.canvas` files keep opening as normal canvases); a
      **"Save as canvas…"** escape hatch ships day one (snapshot the computed layout
      into a real `.canvas` to arrange, annotate, ink — the honest answer to "I want
      to move this one node": fork a snapshot, the live map stays true); the surface
      is called **MAP**. What this supersedes from the morning picks, recorded so the
      history reads honestly: _additive generate_ and _real edges in the file_
      dissolve — there is no file and no generation step, the map recomputes from the
      notes on open and is never stale, which also deletes the accepted
      snapshot-not-mirror wart along with the merge/dedupe machinery. What survives:
      _flat path-keyed groups_ and _grid layout_ carry over as the map's layout
      algorithm, and the whole file/folder-reference extension above applies to the
      map as-is. Implementation lean: the map is a lens-idiom tab (like the changes
      lens — computed, read-only, never persisted) rendering through the existing
      canvas engine with editing disabled; reference extraction reads the project's
      notes on open.
      **Implemented 2026-08-16, all gates clean, verified live over the webview
      devtools protocol.** What shipped: `map:` lens tabs in App — same prefix rule
      and etiquette as `changes:` (never persisted or restored, never drafted, one
      tab at most, retargeted by the next open, closes without asking, guarded out
      of rename/move/preview); activating the tab recomputes, which is what keeps a
      computed view trustworthy. `src/canvas/projectMap.ts` (dynamically imported,
      its own chunk — startup and summon pay nothing) computes the document: cards
      for the project's markdown notes, one flat layer of `group` backdrops keyed by
      full folder path (mounts included — a mount's folder is a group like any
      other), reference edges from markdown inline links resolved against each
      note's real directory (mention links are markdown links, so one extractor
      covers both; external URLs and in-page anchors don't count), referenced real
      files placed and linked, edges deduped per (source, target), grid-per-cluster
      layout packed into wrapping rows. The two flagged leans are built as leaned,
      both reversible inside `projectMap.ts` alone: a folder link routes to the
      folder's group when one is on the map — an explicitly folder-ish target
      (trailing slash) with no group is skipped, never invented as a file card —
      and embedded images get no node and no edge, pointed-at links do. `BoardView`
      gains `readOnly`: the lens renders through the one engine with left-drag as
      pan, nothing selectable/movable/deletable, menus reduced to their open-verbs,
      and the toolbar reduced to zoom plus **Save as canvas…**, which snapshots the
      computed text into a unique-named `<project>/map.canvas` and opens it as a
      normal editable canvas.
      **Verified live** (second instance over the devtools protocol, a scratch
      project plus the real repo project): cards, flat side-by-side path-keyed
      groups (`docs` beside `docs/decisions`, the TEST mount its own group); two
      links to the same note drew one edge; the embedded image and the external URL
      drew nothing; the trailing-slash folder link with no group was skipped;
      dragging a card panned the camera and moved nothing; the card menu is
      "Open note" alone; double-click opened the note with the map tab intact;
      editing a note on disk and reopening the map recomputed (4 edges → 5); the
      saved `map.canvas` is plain spec JSONCanvas with relative paths and opened
      fully editable (add + draw bars back); map tabs stayed out of localStorage
      and the drafts store; the tab closed silently. **One real bug the live check
      caught:** the backend hands out backslashed directories, which never matched
      `resolvePath`'s forward-slash results — every reference fell into the
      placed-files cluster, cards duplicated; `projectMap` now normalizes
      separators at its seams.
      _Pending hands-on:_ the layout at real corpus sizes (row wrap width, cluster
      gaps, fit-on-open); the "missing" badge on referenced project files —
      existing target resolution calls any real-but-unlisted file under a project
      "missing", which reads wrong on a map full of code references and deserves
      its own look; both themes; whether left-drag-pans feels right on a lens.
      _Known limit, the walk's own design:_ a root-resident project lists one
      folder level deep, so its map is shallow; registered projects (every real
      one today) walk deep.
- [ ] **Rework the project-board button on project headings** (2026-08-16) — feedback,
      verbatim intent: the current hover-`▦` on project headings reads as trash — it
      only appears on hover, the glyph is weak, and it sits awkwardly mid-row. Wanted:
      always visible, a better icon, and a placement that doesn't interrupt the
      heading. Candidate-sheet material (icon options × placement options, both
      themes); the affordance itself is settled — a project's board stays one click
      from its heading.
      _2026-08-16: candidate sheet published._ Two axes, composable: placement **A**
      today's hover-`▦` (reference) / **B** always-visible icon at the right edge /
      **C** inline icon after the project name / **D** a worded "board" chip; glyph
      ladder `▦` / offset cards / dashboard panes / kanban square / frame.
      **Placement picked same day: D, the worded chip** — always visible and worded
      won over icon-only. Glyph went to a round 2 on the same sheet after the user
      asked for marks that show a _diagram_: kanban (4) and frame (5) — their leans —
      beside workflow (6, two boxes joined by a connector), network (7) and waypoints
      (8), each rendered inside the chip at its real 11px. Recommended workflow;
      **picked same day: 7, network** — the user's reasoning carried it past the
      recommendation: _"the goal is to view the project connections"_, and that goal
      also re-designed what the chip opens (see the project-map item above). Final
      design, ready to build: **a worded MAP chip, network glyph, always visible on
      project headings**, opening the computed read-only project map. No code yet.
      **Implemented 2026-08-16 with the map slice, gates clean, verified live:**
      `.map-chip` on both project-heading surfaces (Notes panel and the
      current-project pane) — worded MAP, the sheet's network glyph at its real
      11px, always visible, amber riding `--tint-amber` so both themes come free,
      pushed to the right edge with the hover-`+` beside it. It opens the project
      map; the hover-`▦` and `openBoard` are gone (`board.canvas` files stay
      ordinary openable canvases — they just aren't the front door). The map tab
      wears the same glyph, so the tab reads as what the chip opened; the project
      context-menu entry and the palette command now say "Open project map".
      _Pending hands-on:_ the chip beside long project names at the explorer's
      narrow widths, both themes, and whether MAP at 0.62rem reads at a glance.
- [ ] **Ink (canvas step 3) — design picked, building** (2026-08-16) — the last slice
      of the canvas item under 2026-08-10. The two decisions that item flagged as
      needing an answer up front, plus two more the code surfaced, all went up as
      options and **all recommendations were picked 2026-08-16**:

  1. **One ink node per drawing session.** Activating the pen starts an ink node;
     every stroke until the tool is put down joins it, and the node's rect is the
     strokes' bounding box, growing as you draw. Strokes store points relative to
     the node's origin, so a move never rewrites them. An ink node then selects,
     moves, deletes and z-orders like any node with no new selection code.
     _Rejected:_ one layer-node per canvas (can't move or delete one annotation
     without all of them) and time/proximity clustering (invisible boundary,
     confusing when the guess is wrong).
  2. **Raster per node, always — there is no crossover.** Each ink node renders
     into its own `<canvas>` bitmap; committed strokes draw into it, re-rasterized
     debounced on zoom so lines stay crisp. The bitmap is only a cache — the vector
     points in the file stay the truth. This answers the flagged "decide the
     SVG→raster crossover before it is slow" with one renderer and no number to
     tune; per-frame cost during a drag is only the live stroke on a screen-space
     overlay, never a re-rasterization. _Rejected:_ SVG-until-slow (two renderers
     to keep pixel-identical forever) and SVG-only (exactly the failure mode the
     item said to decide against).
  3. **Erase removes whole strokes.** A scene mutation, so undo, autosave and
     round-trip come free and the file stays pure vector. _Rejected:_ pixel erase —
     it forces either bitmaps baked into the JSON (file size, no longer readable
     data) or erase-ops a foreign reader would render wrongly. Nearly one-way, so
     decided deliberately.
  4. **v1 tools: pen + eraser + a few colors.** A Draw toggle, an eraser, a small
     preset color row riding the spec's "1".."6" colors (so foreign tools show the
     same colors), two widths. Pressure from pointer events where a real pen
     provides it. Highlighter and more deferred; strokes already carry color, so
     later tools land against the same data.

  _Knock-ons accepted with the picks:_ the ink node is the documented JSONCanvas
  extension the format decision reserved (schema to be appended to that decision
  entry when it ships); the canvas registry type gains `ink` — a sixth migration
  hop with `v5_note_types` frozen as the previous shape; and an ink node's div must
  be pointer-transparent with stroke-distance hit testing at the surface, because
  its bounding box overlaps other nodes and a card-style div would swallow their
  clicks.

  **Implemented 2026-08-16, all gates + tests clean (36), verified live over the
  webview devtools protocol.** What shipped:

  - **Format** (`jsoncanvas.ts`): the `ink` node type — `strokes` as
    `[x, y, pressure]` triples relative to the node origin, nominal `width`,
    optional `color` on the node-color rule; strokes parse tolerantly (a
    malformed stroke is skipped, missing pressure reads as the neutral 0.5)
    and serialize with two-decimal points. Schema documented in the format
    decision entry. One accepted normalization, recorded there: unknown fields
    _inside_ a stroke are rewritten on save, unlike unknown node fields.
  - **Rendering**: raster per node, always — `InkCanvas` draws each node's
    strokes into its own bitmap (per-segment width follows pressure, round
    caps), re-rasterized debounced 150 ms when zoom settles and on theme swap
    (a `MutationObserver` on the root's `data-theme`, since canvas 2D can't
    follow `currentColor`). During drags and zoom the bitmap only rides the
    surface transform; the in-progress stroke draws on a screen-space overlay,
    so no frame ever pays for rasterization.
  - **Tools**: Draw and Erase in the board bar (gated by the type's `ink`
    feature, the same way `images` gates drops), a seven-swatch color row
    (theme ink + the spec's six presets) and two widths while the pen is up;
    Esc puts the pen down (owning the key the way an editing block does).
    Strokes group into one ink node per pen session; the node's rect is the
    strokes' padded bounding box and grows as it draws, shifting existing
    points when the origin moves. "Draw more here" (context menu or
    double-click on a stroke) re-enters the session on an existing node.
    Coalesced pointer events are consumed for real pen sample rates, with a
    1.5-screen-px jitter floor.
  - **Ink nodes are nodes**: select, move, delete, z-order, edges and undo all
    ride the existing machinery — a stroke commit or a whole eraser pass is
    one journal entry each. The div is pointer-transparent (its mostly-empty
    bbox must not shadow nodes beneath), so stroke presses, double-clicks and
    context menus are stroke-distance hit-tested at the surface; the resize
    corner and anchors re-enable their own pointer. Resizing scales the points
    with the rect while the nominal width stays, and ink nodes get a smaller
    resize floor than cards. Erasing shrinks the rect back around what
    remains; an emptied node is removed with its edges.
  - **Registry**: canvas features become `images` + `ink` — sixth hop,
    `v5_note_types` frozen (composed from the frozen v4), era test added.

  **Verified live** (second instance over the devtools protocol, scratch canvas
  seeded with a foreign ink node carrying an unknown `pen` field, a foreign
  top-level key and a text node; full cleanup after): the v5 migration fired on
  the real settings.json; the foreign strokes rasterized (pixel-checked); two
  pen drags autosaved into _one_ new ink node with the foreign fields riding
  through untouched; each stroke was one Ctrl+Z and two redos restored both;
  an eraser drag across one stroke removed that stroke alone, shrank the rect,
  left the foreign node intact, and one undo restored the whole pass; Esc
  returned to select; pressing a stroke moved its node (+50 exactly); resize
  scaled rect and points ×1.5 with width preserved.

  _Pending hands-on (a pointer-and-eyes list, like every canvas slice):_ how
  drawing _feels_ — smoothing, the jitter floor, pressure with a real pen
  (the devtools mouse always reports the neutral 0.5); eraser reach; both
  themes for strokes, swatches and the active-tool wash; the bitmap crispness
  ladder across zoom levels; and whether the pen staying active after a stroke
  (deliberate — sessions) reads as sticky or as stuck.

  _Left deliberately:_ a highlighter (one more preset against the same data),
  pixel erase (rejected in the design — nearly one-way), stroke smoothing
  beyond the sample floor, and scrollbar-style stroke minimaps. The
  image-annotation item below builds on this layer and sequences next.

- [ ] **Settings → MCP section** (2026-08-16) — requested, lands once the MCP sidecar
      exists (item under 2026-08-06): a section in Settings that pops up instructions
      and details for the sidecar — what it is, how to set it up locally (the client
      config snippet to paste, where the server binary/script lives), and if possible
      a status readout (is a client connected / when was it last used). Not designed
      yet; open points: what "status" can honestly mean for a stdio server the app
      doesn't spawn (the client does), and whether the per-project access grants
      (already designed into the sidecar item) surface here or stay in Projects.
      _2026-08-19: the status question is answered in
      [mcp-tool-surface.md](mcp-tool-surface.md)_ — the **last entry of the sidecar's
      own tool-call log**, a fact we hold, rather than a connection state a stdio server
      the app doesn't spawn could honestly report. That doc sequences this item last in
      its build order, and its setup snippet waits on the doc's open distribution
      question (whether the helper binary ships with the installer).
      _2026-08-19, after the sidecar shipped: the backend half of this item is done and
      only the UI is left._ `mcp_status` returns the resolved roots, the grant on every
      project, the write-scope setting and the last 20 tool-call log entries;
      `src/notes.ts` exposes it as `mcpStatus()`. So the section needs building, not
      designing: a grant table per project, the write-pin toggle, and the honest status
      readout (last call, not "connected"). The setup snippet's text exists in
      [mcp/SETUP.md](../mcp/SETUP.md).
      _2026-08-20: unblocked._ Distribution is settled — the helper ships with the app —
      so the snippet prints a real path: `mcp_status` now also returns `helperPath` and
      `helperExists`. Show the path when it exists and the build command when it does
      not, which is the case in a dev tree.
- [ ] **View the MCP's change log** (2026-08-16) — requested, sequences with the
      sidecar: a way to see what was changed by the MCP specifically, so its edits
      are reviewable. The recent-changes view (2026-08-13) already captures and shows
      external edits — including the future sidecar — but can only say "not this
      app". This ask is the finer attribution: since the sidecar is ours, it can
      identify itself (its writes tagged as an `mcp` origin in the same snapshot
      store, or its own append-only log of tool calls with note + section + summary).
      Open points: whether this is a filter/origin badge on the existing changes view
      (lean — one machinery, one place to look) or a separate log surface, and
      whether tool-call metadata (which tool, which section) is worth storing beyond
      the content diff.
      _2026-08-19: the storage half is picked in
      [mcp-tool-surface.md](mcp-tool-surface.md)_ — the **sidecar's own append-only
      tool-call log** (writes only; a read log would be a surveillance record of the
      user's corpus and answers no question the user asked), carrying when / tool /
      note / section / summary. The snapshot store keeps its two origins: a helper
      binary writing a file _is_ an external edit, and the log carries more than an
      `mcp` origin tag could. What stays open here is the surfacing lean — badge the
      matching external edit in the changes view (match on note + timestamp) versus a
      log surface of its own.
      _2026-08-19: the log is **written** now_ — `mcp-calls.jsonl` in app data, one JSON
      line per write carrying `atMs` / tool / note / section / a one-line summary, with a
      1 MB soft cap that drops the oldest half (a resident tray app should not grow a file
      the user never looks at). `mcp_status` already returns the tail of it. Reads are
      not logged, and a test asserts that. Only the surfacing lean is left to decide.
- [ ] **MCP can read and edit canvases** (2026-08-16) — requested, extends the
      sidecar's tool surface past `.md`: ideally the MCP also allows reading, editing
      and general usage of `.canvas` files — the files are already an open JSON
      format other tools can parse, so the contract holds. Open points: tool shape
      (raw JSON read/write vs. structured verbs like "add a node", "connect A to B" —
      structured is friendlier to agents and safer against clobbering, but is a
      bigger surface), whether the per-project grants gate canvases the same as
      notes (lean: yes, same `off`/`read`/`write`), and how canvas edits land in the
      change-tracking above (a JSON diff isn't the readable hunk view; may need a
      node-level summary).
      _2026-08-19: built the same day as the rest, so this item is done bar the change
      tracking._ The grant lean held — canvases are notes, the registry claims `.canvas`,
      so ids, grants and the walks already worked on them. The **tool shape** resolved as
      _both, split by direction_, which is the answer neither option alone was:
      `read_canvas` returns a **summary** (nodes with type, position and content, edges
      with labels, and for ink a stroke **count**, never the coordinates — a drawn board
      carries tens of thousands of numbers that mean nothing to a reader), with
      `raw: true` handing over the document for a caller that means to edit it;
      `write_canvas` takes the whole document and **validates** it first — unique ids,
      every edge pointing at a node that exists, a rectangle on every node — reporting
      every problem at once. Unknown node types and unknown fields ride through untouched,
      because a conforming reader skips what it doesn't know and refusing would make this
      the one tool that can't round-trip another tool's file. Being the surface's only
      whole-file write, overwriting an existing canvas **requires** `expect_unchanged`;
      creating a new one does not.
      _What is left of this item:_ the third open point — how canvas edits land in the
      change-tracking view, where a JSON diff is not a readable hunk. The call log already
      records a node/edge count per write, which may be the node-level summary that ask
      wanted.

## Today (2026-08-14)

- [ ] **Freeform canvas (canvas step 2) — design picked, building** (2026-08-14) —
      the second slice of the canvas item under 2026-08-10: nodes become arbitrary
      content on the same engine. Five open questions went up as options and **all
      recommendations were picked 2026-08-14**. What the code turned up first, because
      it reshaped three of the five: **(a)** JSONCanvas has no image node — an image is
      a `file` node pointing at an asset, so the freeform vocabulary _is_ the board's;
      **(b)** `edges` are already preserved verbatim in `doc.raw` but never drawn, so a
      canvas from another tool silently hides its arrows today; **(c)** `.canvas` files
      get no snapshots (`history.rs::tracked` requires the markdown view), so neither
      save policy has a version net behind it; **(d)** `draftName`'s `untitled-\d+\.md`
      regex and `deriveName`'s hardcoded `.md` + first-line naming make an untitled
      canvas a _named_ draft that would save under a name derived from `{`; **(e)** the
      shipped `canvas` registry type has **no** features, so `images` is a fifth
      migration hop with a new frozen snapshot.

  _Picks:_

  1. **Canvases autosave, and the policy is per view, declared in the provider table** —
     code, not the registry, because the registry is user data and must not be able to
     make notes autosave. Debounced after the last commit, plus a flush on blur / tab
     switch / window hide / close; Ctrl+S stays as an immediate flush. Shadow drafts are
     skipped for autosaving views so dirty state keeps one source of truth. The
     external-change guard must not pop its modal on an autosave path: an mtime mismatch
     **stops autosaving**, toasts once, and requires an explicit Ctrl+S (which pops the
     existing prompt). Lazy creation gets sharper rather than weaker — pan/zoom/fit don't
     commit, so looking at a board still writes nothing and the file appears on the first
     placement. The decisive argument: pasting an image already writes its asset
     immediately, so an unsaved canvas leaves an orphan asset with no node referencing
     it — half the surface autosaved already. _Rejected:_ geometry autosaves but text
     doesn't — serialization is whole-document, so a geometry write must serialize
     in-flight text or write stale text; it only works if layout leaves the `.canvas`
     file, which contradicts the format decision.
  2. **One format, one code path; only the chrome defaults differ.** A project's
     `board.canvas` leads with "Add note" and the project picker, any other `.canvas`
     leads with "Add text / Add image", and **no node kind is ever refused** — a board
     can hold a sticky note, a canvas can hold note cards (which is how a canvas becomes
     a hub, and the direct answer to the bare board reading as thin). Enforced separation
     was rejected on a fact, not a preference: foreign files mix and we must render them
     anyway, so enforcement would be a lie at the edges. Knock-on: `resolveBoardTarget`
     grows a third answer — "not a note, but a real file" — for assets, resolved through
     `convertFileSrc`. Two sub-picks: `link` nodes render as a chip with the URL and
     click opens externally, **never** an iframe or fetched preview, which the
     no-unrequested-network invariant forbids; `group` nodes render (backdrop + label)
     with authoring deferred.
  3. **Text nodes reuse `Editor`** with `docKey` = node id — mentions, live preview,
     linkify, format keys and paste-image come free, and mount-per-focus is one rebuild
     per focus change, which the existing `docKey` effect already does. A slim second
     CodeMirror under `src/canvas/` was rejected: no bundle saving (CodeMirror is already
     in the main chunk) against a second editor configuration to keep in sync. Single
     click selects, **double-click or Enter** edits, **Esc or click-away** blurs (an
     editing block owns Esc, the way the picker already does); the drag affordance moves
     to the node's header strip so a pointerdown inside the editor never starts a drag;
     text clips rather than inner-scrolls, and growing the node is the answer.
     **Undo splits at focus:** CodeMirror owns Ctrl+Z while a block is focused (the
     `closest("input")` guard grows to skip `.cm-editor`), and the whole editing session
     lands as **one** entry on the canvas journal at blur — so you cannot Ctrl+Z into the
     middle of a finished text edit, which is both the predictable answer and the cheap
     one. Ctrl+Z past the start of a block's own history **falls through** to the canvas
     journal, which CodeMirror's `undo` returning false gives us for free. **The
     interaction that bites if missed:** with autosave a write can land mid-typing, so
     serialization reads the _live_ editor's text through a ref (emit on every change,
     journal entry only at blur) — otherwise an autosave writes stale text over what is
     on screen.
  4. **Multi-select and marquee now**, because the `Set` selection change threads through
     drag, resize, delete, z-order and undo, and only gets worse to retrofit once edges
     and ink add more selectable things. Left-drag is the marquee; pan moves to
     middle-drag, Space+drag, and the wheel (already the primary pan). Resize stays
     single-node. If the pan feel turns out to matter more than expected hands-on, the
     same code behind Shift+drag is the fallback.
  5. **Edges: rendered always, authored geometry-only.** Rendering lands regardless of
     the authoring decision, because we already carry the data and hide it. Authoring
     picks the nearest sides and writes them; labels and colors are preserved but not
     authored (foreign values ride through, the same rule unmodeled node fields follow).
     Sequenced **after** multi-select so the selection model absorbs "an edge is
     selectable" once instead of twice.

  _Riders landing with this slice_ — the three "canvas as the default open" readings
  sequenced here by the kicked-off item below:

  - **`.canvas` creatable** — "New canvas" as a real verb (File menu, palette, explorer
    context menu); `draftName` generalized past `.md`; an untitled canvas names itself
    from a per-type default base (`canvas`, `canvas 2`, …) through the provider table
    instead of `deriveName`'s first-line derivation.
  - **New notes default to `.canvas`** — `defaultNoteType` in settings.json. The subtlety
    that _is_ the feature: `newNote()` serves the deliberate verbs, the summon/welcome
    path, and the startup fallback, and capture must stay `.md` — so it splits into
    `newCapture()` (always `.md`) and `newNote(type)`. "New canvas" ships as an explicit
    verb regardless, so the setting is a convenience rather than the only route.
  - **A chosen canvas opens on summon** — read as "the window opens on this canvas", not
    "every summon switches tabs", which fights capture-now and the tab model. Built so
    nothing loads before the first paint: the tab paints active with a placeholder and the
    module import fires after the first animation frame, which keeps idle rule (3)'s
    intent (a restored canvas tab loads on activation, not at startup) rather than
    relaxing it. Verify with the existing summon→paint log, not by argument.

  _Build order:_ node vocabulary + static blocks → focused-block editor → autosave →
  images (paste + drop-at-point; the drop payload carries a position, so a dropped image
  lands under the cursor) → multi-select/marquee → edges → riders.

  **Implemented 2026-08-14, all gates + tests clean (35), verified live over the webview
  devtools protocol.** What shipped:

  - **Format layer** (`jsoncanvas.ts`): `edges` modeled first-class (endpoints, sides, ends,
    color, label) instead of riding in `raw`, plus node `url` / `label` / `color`. Unknown
    node types, unknown keys and unknown top-level keys still round-trip untouched; an edge
    missing an endpoint is kept but not drawn.
  - **Surface** (`BoardView.tsx`): all four spec node types render — file cards (with the
    note excerpt), images (a file node whose target is a picture, sized from its natural
    aspect once at creation), link chips, and group backdrops painted behind everything.
    Text nodes render through the app's one markdown renderer, hoisted out of `Preview.tsx`
    into `src/markdown.ts` on its second use, cached by the text itself because the surface
    re-renders every drag frame. Connections draw as beziers between facing sides with
    arrowheads and labels; dragging a side handle onto another node authors one.
    Multi-select is a `Set` throughout: left-drag marqueees, middle-drag / Space+drag /
    wheel pan, group move, Ctrl+A, resize stays single-node.
  - **One live editor, N static blocks**: the focused text node mounts the real `Editor`
    (`docKey` = node id) with `className="editor board-block-editor"` so every live-preview
    rule scoped to `.editor` applies. Undo splits at focus — the `e.defaultPrevented` guard
    lets CodeMirror keep Ctrl+Z while a block is focused, and its `undo` returning false on
    an empty history is what makes Ctrl+Z fall through to the canvas journal for free. One
    journal entry per editing session, at blur. Serialization folds in the live editor text
    on every keystroke, so an autosave mid-typing can't write stale text.
  - **Autosave** per view policy in the new `src/views.ts` (`persist`, `nameBase`): debounced
    real-file writes plus a flush on hide/switch/close, drafts skipped, and the close path
    short-circuited so the Save/Discard prompt can't fire for a canvas. An mtime conflict
    stands autosave down, toasts once, and writes a draft until an explicit Ctrl+S resolves
    it through the existing prompt. A silent save skips the corpus re-list unless the file
    wasn't listed yet.
  - **Images**: the canvas type gains `images` (fifth migration hop, `v4_note_types` frozen
    as v3 + the featureless canvas entry), paste onto the surface, drop-at-point (the drop
    position is physical pixels → window scale factor → webview zoom, with a
    not-on-the-surface fallback to the middle), and an "+ Image" file picker.
  - **Riders**: `newNote` split from `newCapture` (summon and the startup fallback stay
    markdown whatever the setting says) plus `newCanvas`; "New canvas" in the File menu, the
    palette, the welcome panel and both explorer context menus; `draftName`'s regex
    generalized past `.md`; `deriveName` bypassed for a view whose text can't name itself,
    via `uniqueName` hoisted out of it; `defaultNoteType` and `openAtLaunch` in
    settings.json with validating setters (`set_open_at_launch` refuses a non-canvas), a
    Settings → Notes section, and the launch canvas set from a palette command on the canvas
    itself. The launch handover fires on the animation frame _after_ the restore path
    paints, so no chunk fetch or parse ever precedes a frame.

  **Verified live** (second instance over the devtools protocol, scratch canvas carrying every
  node kind, two edges plus a dangling one, a foreign top-level key and a `wormhole` node;
  full cleanup after): the registry migrated on the real settings.json; all six nodes rendered
  with the right badges, accent and rendered markdown (`<h1>`, `<strong>`, `<ul>`); 2 of 3
  edges drawn with the label, the dangling one skipped; the file read back with the foreign
  key, all three edges and the unknown node type intact; the launch canvas opened the window
  and a non-canvas was refused; a node drag wrote the file with no Ctrl+S and Ctrl+Z put it
  back; a marquee took all six and a click collapsed to one; an anchor drag wrote a fourth
  edge; the block editor mounted on double-click, typing autosaved into the file mid-edit,
  Escape left the block without hiding the window, and one Ctrl+Z undid the whole session.

  **Two real bugs the live check caught:** the excerpt loader's liveness ref was cleared on
  unmount and never re-armed, so a mount/unmount/mount cycle (which dev's double-invoke
  guarantees) discarded every excerpt — the card text feature from slice 1 was silently dead
  in dev; and a click inside a multi-selection kept all of it selected, because the press has
  to preserve the group for a drag — releasing without moving now collapses to the one node
  pressed.

  _Pending hands-on:_ drag/marquee/pan feel with a real pointer (the gesture split is the
  part a devtools check can't judge), both themes for edges, groups, link chips and the block
  editor, the cursor landing at position 0 when a block opens (consistent with how notes
  open, but "at the end" may read better for appending), edge hit-target size at low zoom,
  the Settings → Notes section with a long launch-canvas path, and whether autosave ever
  feels _too_ eager.

  _Left deliberately:_ authoring colors and edge labels (rendered and preserved, not
  created); group membership — dragging a group doesn't carry the nodes inside it, since spec
  membership is geometric and "what moves with a group" is its own design question; group
  resize (scale or stretch is undecided, so resize stays single-node); and ink, which is
  step 3.

  **Both `decisions/` entries promoted 2026-08-14:**
  [canvas is a native view](decisions/2026-08-14-canvas-is-a-native-view.md) and
  [canvas files are JSONCanvas](decisions/2026-08-14-canvas-files-are-jsoncanvas.md).

- [ ] **Settings/About split + editable keybinds** (2026-08-14) — requested: About
      stops being Settings' first section and becomes its own overlay (Version /
      Auto-update / Made by / Support, opened by Settings → About asapnotes and a
      palette command); Settings keeps the rest. Lean taken: **Notes folder moves
      to Settings** (a Storage section) — where the data lives reads as
      configuration, not credits. Keybinds: **picked "app shortcuts + summon
      hotkey" editable** (over hotkey-only, over everything-incl-editor-keys, over
      read-only): the app-level chords (new note, save, close/cycle tab, palettes,
      explorer, search, preview, zoom) become actions with default chords in
      `src/keybinds.ts`, overrides stored as `keybinds` in settings.json (only
      overrides persist; an override replaces all of an action's default chords,
      so rebinding "New note" retires both Ctrl+N and Ctrl+T); the window key
      handler matches an exact-chord table instead of an if-chain (Shift on the
      next-tab chord keeps meaning reverse). The **global summon hotkey** gets its
      own recorder: `summonHotkey` in settings.json, a `set_summon_hotkey` command
      that re-registers live and updates the tray tooltip; the recorder restricts
      it to letters/digits/F-keys/Space with Ctrl or Alt, so the stored string
      always parses on the Rust side. Editor-owned chords (bold, headings, find…)
      stay read-only rows marked as fixed, and double as a deny-list the conflict
      check refuses alongside already-bound chords. While recording, the app key
      handler stands down entirely (guard on the recorder element), so pressing
      Ctrl+W records instead of closing the tab.
      **Implemented 2026-08-14, all gates + tests clean, verified live over the
      webview devtools protocol.** New `src/About.tsx` (small overlay: Version /
      Auto-update / Made by / Support; Esc and click-away close, palette command
      added); Settings is Appearance / Storage (notes folder) / Projects /
      Keyboard shortcuts. New `src/keybinds.ts` owns the action table, chord
      normalization (letters uppercase, else the event's own key name — so
      recording and matching can't disagree about a layout's shifted symbols),
      the effective-bindings table, and both conflict checks. App's key handler
      matches the table (one special case kept: Shift over the next-tab chord
      cycles backwards); every menu detail, tab/rail tooltip, and the welcome
      primer read the effective chords, so a rebind is what the chrome
      advertises. Rust: `keybinds` + `summonHotkey` in settings.json (overrides
      only), `set_keybinds`, and `set_summon_hotkey` — which re-registers live,
      restores the old chord if the new one is refused, and retitles the tray.
      **One real bug the live check caught:** hotkey (un)registration is
      thread-bound on Windows — from the command's worker thread, unregister
      silently failed ("HotKey already registered" on the next swap back) and a
      worker-thread registration would never deliver events; the swap now runs
      on the main thread (`run_on_main_thread` + a channel for the result).
      Verified live: recorder refuses Ctrl+B ("fixed — Bold"), records Ctrl+M
      onto Explorer (row shows it, settings.json holds only the override), the
      new chord toggles and the old one is dead, row ↺ empties the file and
      revives the default, About stands alone (version yes, notes folder no),
      summon swaps cycle A→Q→Y→A cleanly, a garbage chord is refused with the
      stored one untouched, and a stored chord registers at startup. Pending
      hands-on: the recorder feel (click, press, Esc cancel, blur), a real
      summon on a rebound hotkey (the devtools check can't press global keys),
      the tray tooltip after a rebind, conflict message styling, both themes,
      and the wider Settings overlay (42rem, label column 34%) with a long
      path — the width ask from the same batch.
- [ ] **Canvas work kicked off — setups first** (2026-08-14) — the project board is
      the agreed first slice (see the canvas item under 2026-08-10). The "canvas as
      the default open" ask was pinned down same day — **all four readings picked**,
      sequenced into the slices they depend on: (1) _project opens onto its board_
      — lands with the board slice as the affordances (board button + context-menu
      entry + palette command); the per-project default-open behavior lands when
      "opening a project" is a real event; (2) _.canvas creatable/openable_ and
      (3) _new notes default to .canvas_ (a setting — capture stays .md by default)
      land with the freeform-canvas slice, since a board of file nodes is not a
      capture surface; (4) _a chosen canvas opens on summon_ also freeform-slice,
      and must not touch summon latency (the canvas module stays a dynamic import,
      so the welcome/summon path can only ever open it lazily).
      _Slice-1 design leans (recorded before code):_ **a board is a document like
      any other** — the canvas view serializes to JSON text through the same
      onChange → dirty/draft path every editor uses, Ctrl+S writes the file, so
      drafts, close-confirm, rename and move all come free (hands-on question:
      does save-to-persist feel right for node drags, or should boards autosave?);
      the registry gains the `canvas` type now that a view exists (fourth
      migration hop, same deep-equal rule); opening a board whose `board.canvas`
      doesn't exist yet is an unsaved tab — the file appears on first save, which
      is the "created lazily on first placement" rule falling out of the existing
      machinery; node `file` paths are relative from the board (same rule as
      mentions), inverse-resolved through `noteIdOf`.
      **Slice 1 implemented 2026-08-14, all gates + tests clean (34), backend
      and UI flow verified live** (second instance over the webview devtools
      protocol, scratch notes-root project: registry migrated on the real
      settings.json, `.canvas` save/read/list, board button → empty board tab,
      add-picker placing a node, Ctrl+S writing `board.canvas` with a plain
      relative `file` path, board-level Ctrl+Z, full cleanup). What shipped:
      the `canvas` registry type (view `canvas`, icon `file-canvas`, amber,
      no features yet — images/ink land when implemented; a frozen
      `v3_note_types` snapshot keeps the hand-edit rule); `src/canvas/`
      — `jsoncanvas.ts` (parse keeps every field it doesn't model, so foreign
      canvases round-trip; malformed JSON opens the board **locked** with the
      message, because editing an unreadable file would shed its content) and
      `BoardView.tsx` (pan/zoom camera, dot grid riding it, node drag /
      SE-resize with a 3px click slop, drag-end brings the node to front,
      single-select, Delete removes from board, board-level undo/redo journal,
      "+ Add note" picker filtered to the project's notes not yet placed,
      zoom −/%/+/Fit, double-click opens the note, right-click menus through
      the app's shared context menu, text/unknown nodes from other tools
      rendered read-only); the module is a code-split lazy import (own ~8 kB
      chunk — startup pays nothing). Entry points: hover `▦` on project
      headings (current pane included), "Open project board" first on the
      project heading context menu, and a palette command naming the current
      project. External-edit reload maps to a full board reset keyed off
      `initialDoc` (the board's `setDoc`), so a stale node set can never
      overwrite a newer file. Guards: the board owns Ctrl+Z under its focus
      (the seen-mark journal excludes `.board`), its wheel handler stops the
      app zoom, Esc with the picker up closes the picker not the window, the
      editor context menu skips canvas tabs. Known edge, deliberate: a
      never-placed board tab left open across a restart drops with the
      "file is gone" toast (same as an orphaned named draft). Pending
      hands-on: drag/resize/pan/zoom feel, both themes, the picker, undo
      depth, rename/move of board.canvas, and the save-vs-autosave question
      above.
      **First hands-on follow-up (2026-08-14):** the bare title-card board read
      as pointless — file cards now show the note's opening text under the name
      (read lazily per card, re-read when the note's mtime changes, clipped
      with a fade; taller default card). And the no-changes close prompt is
      gone, three fixes deep: the app tracks the open buffer's on-disk baseline
      and a close whose buffer matches it skips the Save/Discard ask (drops the
      then-redundant draft too, active and background tabs alike); an emptied
      canvas serializes back to the empty text it opened from; and the
      vanished-file safety net no longer fires for files that never existed
      (the focus-bounce dirty edge above, now an mtime-reference check).
      **Verified live 2026-08-15** over the devtools protocol against a scratch
      notes-root project: excerpts render on placed cards, a never-saved board
      stays clean through a focus bounce and writes no draft, a note typed into
      and undone back to its file content closes with no prompt and its draft
      dropped, and — the check that matters, since this fix's failure mode is
      silently discarding work — a note with real unsaved edits still stops the
      close. Re-run that last one if the close path is touched.
- [ ] **Draw on images from a markdown note** (2026-08-14) — requested: double-click
      (or right-click) an image in an `.md` note pops the image up so it can be
      drawn on, like the canvas ink option — an image-annotation surface reusing
      the canvas engine's ink layer. Builds on the canvas engine; sequenced after
      the project board proved it.
      _Designed 2026-08-19, both recommendations picked; building._ The two open
      points resolved:
      **(1) The ink lands in the image itself — flatten and overwrite, with the
      recycle bin as the net.** Saving rasterizes the strokes into the image at
      its natural resolution and overwrites the file; the previous bytes go to
      the recycle bin first (the same net deleting a note uses), so every
      earlier version stays recoverable without sibling-file clutter. The
      annotation is real pixels, so the note, canvas cards and every external
      tool see it with zero new render machinery — the files-are-the-contract
      answer. Stated plainly: strokes are re-editable only during the session;
      after a save they are pixels. _Rejected:_ a sibling annotated copy with
      the note's link rewritten (files multiply, other notes referencing the
      same asset keep seeing the clean copy), and sidecar strokes composited at
      render (re-editable forever, but invisible to every other tool and each
      image render path must learn to composite).
      **(2) The surface is a lens-idiom tab on the canvas engine.** An
      `annotate:` tab — same etiquette family as `file:`/`map:` (never
      persisted, never drafted, one at most, closes without the note plumbing
      ever seeing its content) — rendering `BoardView` with a computed
      one-image-node document sized at the image's natural pixels (canvas units
      = image pixels, so the flatten maps 1:1). Layout locked (the read-only
      lens gates), ink tools live, pen raised on open with a preset color, a
      "Save into image" verb in the bar. _Rejected:_ a modal overlay — the app
      has no modal surface idiom, and it gets none of the tab etiquette for
      free.
      Scope calls made with the design: annotatable formats are png / jpg /
      webp — the ones the webview can re-encode; gif (animation would be
      silently flattened), svg (vector — rasterizing is a real loss) and bmp
      (no encoder) refuse with the reason. Entry points: double-click on an
      image in the editor's live preview or the preview pane, plus a
      context-menu entry; remote (http) images are not annotatable. Closing
      the tab with unsaved strokes asks first — lens tabs close silently, but
      strokes are real user work. After a save, image URLs get a version
      query so the webview's cache can't show stale pixels.
      _Implemented 2026-08-19, all gates + tests clean (36), verified live
      over the devtools protocol._ What shipped: - `src/canvas/ink.ts`: stroke rendering (presets, accent resolution,
      pressure taper) hoisted out of `BoardView` on its second use — the
      flatten must draw a stroke identically to the surface. - `src/canvas/annotate.ts` (lazy, like all canvas machinery): the
      computed document (one file node at the image's natural pixels, so
      canvas units _are_ image pixels and the flatten maps 1:1),
      `flattenAnnotation` (draws image + strokes into an offscreen canvas
      at natural resolution, re-encodes in the file's own format — a
      silent PNG fallback from `toBlob` is detected and refused rather
      than writing PNG bytes under a `.jpg` name), and `withoutInk` (after
      a save the strokes are pixels; they leave the lens document too). - `BoardView` gains `annotate`: rides every read-only gate (nothing
      selects, moves or deletes; presses on cards fall through) but the
      ink tools stay live — pen raised on open in preset red (theme ink is
      picked for the app surface, not for arbitrary image pixels), Esc
      puts the pen down, Ctrl+Z/Y drive the stroke journal, left-drag pans
      only while no tool is up, and the save verb reads "Save into image". - App: `annotate:` lens tabs (never persisted/drafted, one at most,
      excluded from rename/move/project verbs, ✎ tab glyph); the session
      lives in a ref so drawing never re-renders the app, survives tab
      switches, and even survives a bulk close (reopening the image
      resumes it). Closing or retargeting with unflattened strokes asks
      through the native confirm. Entry points: dblclick on a live-preview
      image widget or a preview-pane image (raw link rides a data
      attribute), right-click leads with "Draw on image"; gif/svg/bmp and
      remote URLs refuse with the reason. - Backend `overwrite_asset`: raw-body bytes, percent-encoded path
      header, absolute existing file of a flattenable extension only —
      `trash::delete` first, then write, so every earlier version is in
      the recycle bin. - `src/assetVersions.ts`: version stamps for rewritten files; every
      image resolver (live preview via `imageIn`, `renderMarkdown`,
      `resolveBoardTarget`, the lens itself) appends `?v=N` after a
      rewrite, so the webview's cache can't show stale pixels.
      **One real bug the live check caught:** an `<img>` loaded from the
      asset protocol is cross-origin to the page — the flatten canvas was
      tainted and `toBlob` refused. The flatten now fetches the bytes and
      decodes via `createImageBitmap` (same-origin blob, no taint).
      **Verified live** (CDP second instance, scratch registered project,
      full cleanup, settings.json checked clean): dblclick on the png →
      annotate tab, read-only board, pen up, color-1 swatch active, node at
      natural 320×200; a real-input stroke made one ink node; Ctrl+Z/Y
      within the session; "Save into image" → toast, strokes left the lens,
      file rewritten on disk (bytes grew, recycle bin holds the original),
      stroke midline pixel exactly preset red `#c8402f` with corners
      untouched; `?v=1` on the lens image and on the note's live-preview
      widget after returning; strokes survived a tab switch away and back;
      gif → "would lose data" toast, remote → "only images on this machine";
      right-click menu led with "Draw on image"; the saved-clean tab closed
      silently, and a dirty close raised the native confirm (which headless
      can't press — by design).
      _Accepted knock-on, found live:_ re-activating the annotate tab
      remounts the surface, so the journal restarts — strokes drawn before a
      tab switch can't be Ctrl+Z'd after it (the eraser still removes them,
      and nothing is flattened until an explicit save). Same per-session
      shape as text blocks committing at blur.
      _First hands-on pass 2026-08-19 (paste image → dblclick → draw), three
      hits, all fixed and re-verified live the same day:_ **(1) Ctrl+S
      no-op'd on the lens** — the bar button was the only save verb, so
      "save then close" silently became "discard on close", which also
      explained the md not updating (nothing had been written). Ctrl+S (and
      the File-menu save) now routes to the flatten; the annotate tab wears
      the unsaved dot while strokes are unflattened, with its own tooltip.
      **(2) Closing the lens landed on a neighbor tab, not the note the
      image came from.** The session now remembers its origin tab; every
      close path (clean, prompt-Save, prompt-Discard) lands back on it when
      it is still in the strip.
      **(3) The native OK/Cancel close confirm read as "save?"** — replaced
      with the app's own Save / Discard / Cancel stop (the same
      `CloseConfirm` a dirty note gets; Save flattens, and the tab only
      closes when the write really happened). Bonus: the prompt is in-app,
      so the dirty-close path is now drivable headlessly — verified: dot
      appears on draw and clears on Ctrl+S, all three close paths return to
      the note, prompt wording and buttons exact, and the note's
      live-preview image bumped to `?v=2` after the prompt-Save.
      _Pending hands-on:_ how drawing over a real screenshot feels at fit
      zoom (the lens opens fit-to-window, so strokes land in canvas units —
      crispness after flatten at high zoom-out deserves a look); the preset
      red on real image content and the swatch row's usefulness here; jpeg
      re-encode quality (0.92) on a photo after a couple of annotate cycles;
      and whether pen-up-by-default feels right when the tab was opened
      just to look.
- [ ] **Bigger default window + remember the last size** (2026-08-14) — requested:
      the first-run window should be ~30% wider and ~20% taller, or the app should
      just remember the last size across restarts (it already survives hide-to-tray,
      since the window object never dies — only a real quit lost it). Picked: **both**
      — default 800×600 → 1040×720, plus size persistence — and **size only, stay
      centered** (over remembering position: centered-on-summon is predictable and
      immune to unplugged monitors). **Implemented 2026-08-14, all gates clean,
      pending hands-on check.** New `src/windowSize.ts` (init from `main.tsx`):
      restore runs once at app launch while the window is still hidden — read the
      localStorage `windowSize`, `setSize` + re-center (setSize keeps the top-left
      corner, so a fresh launch would sit off-center without it) — so a summon never
      sees the window move; recording rides `onResized` debounced 300 ms, skipped
      while maximized or minimized (only the normal size is worth restoring; minimize
      reports a meaningless size), stored in logical units so DPI changes don't warp
      it, with a 320×240 floor filtering degenerate events and corrupt entries.
      Five new window grants in `capabilities/default.json` (set-size, center,
      is-maximized, is-minimized, scale-factor) — clippy validated them at compile.
      Pending hands-on: quit fully, relaunch, and see the resized shape come back
      centered; first-run shape needs a cleared localStorage (or the second-instance
      trick) to see 1040×720.

## Today (2026-08-13)

- [ ] **Explorer sections as separate panels, resizable splits** (2026-08-13) — feedback:
      the window ground already shows explorer / editor as panels floating on the dark
      chrome; extend that same treatment _inside_ the explorer — each section (current
      project, Recent, Notes) its own box with the chrome showing between them — and let
      those in-between gaps double as grab handles so sections can be resized vertically.
      Same idea floated for the content column: the title bar (logo + project) as its own
      panel above the editor's — which already holds: the tab strip + title bar are one
      panel and the editor another. From the same feedback batch: Recent-collapsed-by-
      default, current-project-first, expandable folders, drag-resizable persisted explorer
      width, and the readable amber selection all already exist — no action.
      _2026-08-13 design pass (candidate sheet published, awaiting a pick — no code):_
      three candidates at real app metrics, light+dark: **(A) today** — one surface,
      hairline seams — as reference; **(B) sections as panels** — toolbar / current
      project / Recent / Notes each a panel on the chrome, 6px gaps, column still scrolls
      as one; floating mode becomes a dark tray so the gaps don't show the editor through;
      **(C) B + draggable splits** — the gaps are grab handles, current project and Notes
      hold their own scroll, sections auto-size until first dragged (a drag records that
      section's share, persisted on release like the explorer width; double-click resets
      to auto; a hidden section returns its space). Recommended C — the resize ask is
      explicit, B is exactly C's visual layer, and the only real question (do chrome
      gutters read too heavy?) is what the A/B tiles answer. **Picked 2026-08-13: C.**
      **Implemented 2026-08-13, gates clean, pending hands-on check.** The explorer nav
      goes transparent (chrome shows through 6px gaps; floating mode instead paints the
      nav `#1a1a1a` — a chrome tray, so the gaps don't show the editor through); the
      toolbar, current project, Recent, Notes, and the search view each carry the panel
      surface (`.explorer-card` / own background). Only the project panel's share is
      adjustable — Recent sizes to its content, so both gaps around it drag that same
      boundary (pointer capture like the width drag; clamp 48px..column−140px; persisted
      on release as `appearance.explorer.pane` + a localStorage mirror; double-click
      resets to size-to-content, which deletes the key). Sizing is flexbox: pane
      `flex: 0 1 auto` (or `0 1 <pane>px` once dragged), Notes `flex: 1 1 0`, both with
      min-heights and own scroll, so a squeezed window shrinks panels instead of losing
      one. The old `.explorer-body` single scroll and its hairline-seam rule are gone.
      Pending hands-on: drag both gaps, double-click reset, restart to confirm the share
      survives, floating mode, search view, no-note and empty states, both themes.
      _2026-08-13 follow-up (requested, implemented, gates clean, same pending check):_
      the Recent and Notes panels can be closed from a hover-revealed × on their header
      (the same treatment as the heading + button); the space goes to the panels above —
      with Notes closed the project panel fills the column and the gaps stop being drag
      handles (nothing left to trade with). Reopening lives in the View menu ("Show
      Recent panel" / "Show Notes panel", label-flip toggles beside the explorer entry).
      Closed state persists as `appearance.explorer.hideRecent`/`hideNotes` with
      localStorage mirrors. Two edges handled: creation targeting a closed Notes panel
      reopens it (same spirit as creation expanding a collapsed project — the inline
      input must be visible); and with nothing left to show, a single quiet panel says
      the View menu brings them back.
- [ ] **Icon rail slightly wider** (2026-08-13) — feedback: the collapsed slat that
      expands the explorer should be very slightly wider. One value (`.rail` width,
      currently 1.2rem); riding along on the sections candidate sheet as a width ladder.
      **Implemented 2026-08-13 at the recommended 1.4rem** (+3.2px; the ladder's 1.6rem
      read as a gutter). The floating explorer's left offset tracks it (`calc(1.4rem +
12px)` clears the slat). Pending the same hands-on pass as the sections item.
- [ ] **Investigate: a "recent changes" view over the .md notes** (2026-08-13) —
      requested: a way to see recent additions and edits to the markdown notes
      specifically, so updates across notes can be tracked in one place. Presentation
      intent: works sort of like a diff view — added text shown in context — but
      quieter, without being visually disturbing; deletions can be very compact
      (a collapsed marker rather than full struck-out blocks). Open questions for the
      investigation: where the history comes from (the notes aren't guaranteed to be
      in git — snapshots? the drafts machinery? file mtimes only give "when", not
      "what"), how far back it needs to reach, and where the view lives (a panel, a
      palette command, a per-note lens). Investigation first, no design settled.
      _2026-08-13 visual design pass (candidate sheet published, awaiting a pick — no
      code; the history-source investigation is still the other half):_ entry point is
      a third view button in the explorer bar beside Files/Search (glyph `±`, badge
      ladder: dot / inline count / corner count pill), the view replaces the tree the
      way search does and keeps search's one-line-row + gutter idioms. Three shapes:
      **(A) ledger** — file rows with `+n −n` chips and day headers, no text;
      **(B) quiet hunks** — per-file collapsible groups, added lines as normal ink
      with a 2px green edge + faint wash, context muted, deletions collapsed to a
      "··· n removed" pill that expands to strikethrough-free muted rose; **(C) B +**
      A's day headers, a totals strip, hover jump-to-line (`↗`), and the amber trail
      edge on the open note's group. Plus a four-step deletion-quietness ladder
      (invisible / gutter tick / pill / expanded). Recommended C with the corner-pill
      badge and pill-default deletions; add/del colors from the syntax palette
      (`--syn-string` / rose), so the view speaks the existing color system.
      **Picked 2026-08-13 (composed on the sheet, no code):** badge = **inline amber
      count** (not the pill); the view is **three states of one panel** — landing is
      A's ledger; clicking a file row drills into **that note's changes alone** (B's
      treatment, every addition shown, `⋯` between hunks); a **"Read through ›"**
      action on the totals strip stacks all files' details into one scroll with
      hairlines between notes. The strip is the constant in every state: totals plus
      the `‹` way back. Carried from C into detail + stream: hover `↗` jump-to-line.
      Deletions stay the pill, expanding to strikethrough-free muted rose. Blocked on
      the history-source investigation above before any code.
      _2026-08-13 history-source investigation (the blocking half — findings +
      recommendation, awaiting a pick; no code):_ nothing in the app stores past
      content today — drafts hold only the current unsaved buffer (cleared on save),
      the recycle bin holds deletions, and mtimes say when, never what. Four sources
      weighed: **git** (rejected as the source: the notes root isn't a repo and isn't
      guaranteed to be one, commit granularity isn't an edit timeline, uncommitted
      work is invisible, and it needs a shell-out to a git that may not exist or a
      heavy library; possible later enrichment for linked repos), **mtime-only**
      (can't show added text — fails the picked design), **OS-level file history**
      (not dependable across machines, content not queryable), and an **app-data
      snapshot store** — recommended. Shape: `history/<note-id>/<timestamp>.md`
      beside `drafts/`, the same id-mirrored idiom; capture rides the two signals
      that already exist, so no watcher, no timer, zero idle cost: (1) every
      `save_note` snapshots — reading the pre-save disk content first when the note
      has no history yet, so even the first save after shipping diffs; (2) the
      window-focus re-sync grows a scan (over `note_paths`, the corpus walk search
      already uses): compare each file's mtime to the store's latest, read + snapshot
      the changed ones, dedupe by content hash (touched-but-identical is common) —
      this is what catches other tools and agents editing notes, which is the "track
      updates across notes" ask. First sight of a note stores content as a baseline
      (renders as nothing, not as everything-added); the store always holding every
      note's latest content is the invariant that keeps the scan cheap (mtime
      compare, read only what changed). Accepted consequences: the store starts as a
      one-time copy of the corpus (text-sized; the >2 MB search cap applies),
      in-app `move_note` carries history like it carries the draft while an external
      rename reads as vanish+appear, and `delete_note` hard-removes history like it
      hard-removes the draft (app-internal state, not user content). Retention:
      prune on the same focus scan, no timer — proposed 30 days kept, view defaults
      to ~7. Diffing is computed on demand in Rust (the ledger needs counts across
      every file, so hunks/counts travel over IPC, not file pairs): recommend the
      `similar` crate — a user-facing diff lives or dies on hunk readability, which
      is exactly where a hand-rolled Myers would spend its budget (same reasoning as
      `ignore` for gitignore syntax). This is not the rejected search-index problem:
      an append-only log of what the app observed, never a mirror that must
      reconcile with the files. Sub-decisions open, with leans: the unsaved draft is
      **not** the diff tip in v1 (saved content only — the dirty buffer is already
      visible in the editor); no backfill (history reaches from ship-day forward;
      git could backfill linked repos later if ever wanted).
      _Constraint added 2026-08-13:_ **markdown notes only** — capture, store, and
      view all filter to types with the `markdown` view (`.md`/`.markdown`); the
      other registry types (json/yaml/csv/config/log/…) are never snapshotted, which
      also keeps the one-time baseline copy to the actual notes corpus.
      _Re-scoped 2026-08-13:_ **the view tracks external edits only** — the ask is
      "what did the AI change", not a log of the user's own typing. Every snapshot
      carries an origin: `app` (the user's own Ctrl+S — recorded silently, because
      a diff needs the last app-known state as its "before", never shown as a
      change) vs `external` (observed changed on disk by the focus scan — what the
      ledger and drill-in show). Honest limit, stated in the design: external means
      "not this app" — an agent, the future MCP sidecar, but also a hand-edit in
      another editor or a `git pull`; the app can't attribute further. Bonus noted
      for later, out of this item's scope: both origins in one store is already the
      data shape for a per-note "history / restore an older version" feature.
      _Store limits added 2026-08-13:_ three caps, enforced in one prune pass on
      the focus scan (amortized to first focus of the day, no timer): **age**
      (30 days), **per-note count** (~25 versions, oldest first — bounds an agent
      hammering one note), **total store budget** (~50 MB soft cap, oldest across
      all notes first — the backstop that makes the worst case a number). A note's
      latest snapshot is never pruned: "the store holds every note's last-known
      state" is the invariant the scan and the diffs stand on. Defaults in one
      const block, no settings UI in v1.
      **Implemented 2026-08-13 as designed above, all gates + tests clean,
      pending hands-on check.** Backend: new `src-tauri/src/history.rs` owns the
      store (`history/<timestamp>-<origin>.md` dirs mirroring note ids), the
      save hook in `save_note` (pre-save baseline on first sight, post-save
      snapshot, both silent `app` origin), the `scan_changes` command the focus
      handler now calls (mtime vs latest-snapshot compare, content-dedupe, first
      sight = baseline), the daily-amortized prune (`.pruned` marker file), and
      the two diff commands (`recent_changes` ledger counts, `change_details`
      hunks — `similar` crate, 2 context lines, new-side line numbers for the
      jump). Snapshot filenames are zero-padded so name order is time order; a
      colliding timestamp bumps forward. `move_note`/`delete_note`/
      `delete_folder`/`delete_mount` carry/remove history exactly as they do
      drafts. Twelve unit tests beside `project_config.rs`'s. **Backend verified
      end-to-end against the live corpus** (second instance on the real notes
      root, commands driven over the webview devtools protocol): 122 markdown
      baselines and nothing else on first scan, an external edit surfacing as
      `+2 −1` with correct hunks, an app save staying silent and becoming the
      next diff's "before", touch-without-change deduped, `delete_note` taking
      the history dir with it. View: new `src/Changes.tsx` behind the `±` button
      (inline amber count of changed notes) — the three picked states, deletion
      pills expanding to muted rose, `⋯` between hunks, hover `↗` jump (reuses
      `openHit`), totals strip constant with `‹` back and "Read through ›";
      colors ride `--syn-string`/`--tint-rose`/`--tint-amber` so both themes
      come free. The scan+ledger refresh runs at startup (after first paint) and
      on every window focus, riding the existing re-sync — no watcher, no timer.
      All three states + the jump also exercised live over the same driven
      instance (the ledger's first real content: this file's reformat, caught as
      an external edit). Deliberately left out: View-menu/palette entries and a
      shortcut (the design names only the view button), and the per-note
      restore-a-version idea stays future. Pending hands-on: the ± badge and
      each of the three states in both themes, drill-in on a note an agent
      really edited, a deletion pill expand, `↗` jump landing right, and the
      empty state after seven quiet days.
      _2026-08-13 follow-up (requested + designed via two picked options,
      implemented, gates + tests clean, pending hands-on):_ **(a) the diff
      opens as a document, not inside the panel** — clicking a ledger row (or
      "Read through ›") opens a read-only diff tab in the editor area
      (`changes:<note id>`, or bare `changes:` for the all-notes stream; `:`
      can't occur in a note id, so the prefix can't collide). The panel is now
      the ledger alone — the in-panel drill-in/stream states are gone, their
      hunk rendering moved into the new `DiffDoc` (same `chg-*` idiom, sticky
      totals strip, readable column). Diff tabs are real tabs (strip, Ctrl+W,
      Ctrl+Tab, middle-click) marked `±` in amber, but never persisted across
      restarts and guarded out of every note-only path (save, rename,
      move-to-project, preview, drafts, close-confirm, Edit context menu).
      **(b) seen marks** — a `seen.json` ledger beside the snapshots ((note,
      timestamp) pairs; new command `set_changes_seen`; pruned with the same
      age cutoff), summaries carry a `seen` flag, and the `±` badge counts
      unseen notes only. Marking: hover `✓` on a ledger row, right-click menus
      on rows / day headers / panel body / diff-doc note headers (mark row,
      day, all, note as seen or unseen), and a strip toggle on the diff doc.
      Seen rows dim in place (opacity + persistent green check) — history
      stays browsable, chosen over hide/collapse. **Ctrl+Z walks marks back**
      (Ctrl+Shift+Z / Ctrl+Y forward): an app-level undo journal of mark
      batches, optimistic UI + backend write, active only when CodeMirror or
      an input doesn't own the key — a row-toggle marks only the events it
      actually flipped, so undo restores exactly one click's worth. Pending
      hands-on: open-diff-from-row, the all-notes stream tab, tab behaviors
      (close/cycle/restart drops it), mark/unmark at each menu level, Ctrl+Z
      in panel vs editor, badge arithmetic, both themes.
- [ ] **Rework the recent-changes diff view: rendered markdown with changes
      highlighted** (2026-08-13) — requested, builds on the recent-changes item
      above. Opening a note's changes should show the note as it normally reads —
      the markdown formatting still applied, the same file, fully readable — not
      a raw diff document; the changes are marked on top of that rendering
      (added text highlighted in green), so the eye finds what's different
      without losing the note itself. Also requested: while the diff is on
      screen, a small popup at the bottom offering "jump to the next
      difference", so walking through a long note's changes doesn't mean
      scrolling and hunting. The rendered view should also **auto-close** —
      opening another note's changes or leaving the changes flow closes it,
      rather than diff tabs piling up in the strip. Not designed yet — open
      points: how deletions appear in a rendered view (the pill idiom may
      carry over), how highlights map onto formatted output when the change
      is inside markup (a heading, a list item, a code fence), and whether
      this replaces the current hunk view or sits beside it as the default
      lens.
      _Added 2026-08-13, same rework:_ the ledger panel almost always crops
      the file name — the name and its project share one row line, so the
      project label eats the width. Wanted: group the ledger by project as
      sections (a small project heading, file rows beneath it), so the file
      name gets the full line to itself.
      _2026-08-14 design pass (candidate sheet published, five decisions,
      all picked — no code at the time):_ the surface question was the fork,
      because the app has two "reads like a note" surfaces. **(A) rendered
      preview** (the eye's markdown-it output) marks whole blocks — a
      reworded clause washes its paragraph, and with no line numbers the
      jump lands on an element; **(B) the editor read-only** (live preview:
      sized headings, real bullets, images, markers dimmed) marks exact
      lines and gets scroll-to-line, links and images for free; **(C) B with
      word-level marks** — a whisper of wash on the line, the changed words
      carrying the color, from the diff crate's inline-change API.
      **Picked: C** (with the note that word marks must not introduce stray
      spacing — the sheet's own C tile had a whitespace bug that read as
      indentation). Other four: the hunk document is **replaced**, not kept
      behind a toggle; the ledger groups as **project sections with a day
      stamp on the row** (over day-groups-with-project-subheads, and over
      two-line rows); the lens is **one reusable ± tab**, not an overlay;
      deletions stay the **pill** expanding to muted rose, and the jump
      control is the **named pill with keys** (`Change 2 of 7`, F8 /
      Shift+F8), with a scrollbar tick map left as a later add. Sub-calls:
      baseline is the **window's oldest snapshot** (not "since last seen" —
      the document must not move under a mark click), and the lens is
      **read-only** in v1 (the marks stand against a snapshot).
      **Implemented 2026-08-14 as picked, all gates + tests clean (32),
      verified end-to-end live.** Backend: one new command `note_lens`
      (history.rs) returning the note as of the last external edit in the
      window, the added lines with **UTF-16** column ranges of the changed
      words (byte offsets would land a mark early on any line with an em
      dash — there is a test), the removed runs anchored after the surviving
      line above them, and `ownEditsSince` for when the user has saved since.
      Word ranges come from `similar`'s inline-change API (new `inline`
      feature): a wholly new line comes through unemphasized, which is
      exactly the "no ranges = mark the whole line" case. Retired with the
      hunk document: `change_details`, `hunks`, `DiffLine`, `Hunk`, and
      `external_pairs`' now-unused `only` parameter. Frontend: new
      `DiffLens.tsx` — a read-only, non-focusable CodeMirror carrying the
      same `livePreview` + markdown extensions the editor mounts, with the
      marks as line/mark/block-widget decorations (the three primitives
      livePreview already uses); deletion pills are widgets that expand in
      place through a state effect; the jump control walks each run of added
      or removed lines and, past either end, steps to the next changed note
      — so "Read through ›" needs no mode of its own. Opening lands on the
      first change (`y: "nearest"`, so an already-visible one doesn't
      scroll). `changesLedger.ts` now owns the ledger shape (project
      sections, relative stamp, the note order the lens steps through) since
      both the panel and App read it. Lifecycle: `openDiffTab` retargets the
      one ± tab instead of appending, and the lens closes when the explorer
      leaves the changes view, on Esc, or when it hands over to the real
      note ("Open note ›" opens it at the change on screen). Live check
      (second instance driven over the webview devtools protocol, scratch
      note edited outside the app): `+3 −3` with the single word "red"
      marked on the reworded line, the brand-new bullet marked whole, two
      deletion pills expanding and collapsing, the ledger showing three
      project sections with stamps, the ± tab retargeting rather than
      stacking as the jump crossed into the next note, and the tab going
      when the explorer switched back to Files. Pending hands-on: both
      themes, a long note's jump walk, images/links inside the lens, and how
      the whisper-wash reads next to the word marks at real reading size.
- [ ] **Projectless note hoists the loose files as a top pane** (2026-08-13) —
      requested: a note in no project should get the same explorer treatment a
      project note gets — the top pane shows all projectless files (saved and
      drafts) instead of the column starting at Recent. Picked over hoisting
      inside the Notes panel (no split-drag, no consistent header there).
      **Implemented 2026-08-13, gates clean, pending hands-on.** New
      `looseCurrent` state (open note exists, isn't a diff tab, has no
      project) drives a pseudo-project pane titled "No project" (the project
      selector's wording): all loose notes + loose drafts merged one-entry-
      per-name, newest first like Recent; same pane surface, split-drag
      share, `+` button, and root context menu as a real project. While
      hoisted, the loose list leaves the Notes panel (the same exclusion the
      current project gets), Recent keeps its normal collapsed spot below,
      and root-targeted creation (`New note` on the bar, "New note here" on
      the root) puts its inline input in the hoisted pane without reopening a
      closed Notes panel. Pending hands-on: switch tabs project↔loose↔diff
      and watch the pane swap, drafts (untitled + named) listed and opening,
      create row landing in the pane, split drag + hidden-Notes fill, both
      themes.
- [ ] **Audit: things removed outside the app — notes, folders, roots**
      (2026-08-13) — requested: audit what happens when a note, folder, project root,
      or a virtual folder's backing directory is removed outside the app (another
      tool, a `git clean`, an unplugged drive) — nothing notifies us. Cases to walk:
      an open tab whose file is gone (edit, save, rename, delete from it), a linked
      project whose root is gone (startup and refocus re-list), a mount whose backing
      folder is gone, drafts pointing at deleted notes, and the notes root itself.
      For each: does it error sanely (toast, tab closes, entry drops) or misbehave
      (silent zombie rows, resurrection-on-save, crash)? Fix list comes out of the
      audit — this item is the check.
      _2026-08-13 audit run (code walk over notes.rs / App.tsx / Explorer.tsx /
      history.rs; every backend claim verified live against a driven second
      instance on the real corpus — a scratch note created, hard-deleted outside
      the app, then each command exercised. Findings below, fix list at the end,
      awaiting a pick — no fixes coded):_
      **(1) Open tab whose file is gone.** Half is deliberate and works: the
      focus re-sync sees mtime `null` and leaves the buffer alone, the save
      guard treats `null` as no-conflict, so Ctrl+S silently recreates the file
      (verified live) — the documented "named draft keeps its name" design.
      The other half misbehaves: **activating** any tab whose file is gone (no
      draft) is a silent no-op — `openItem`'s `readNote` rejection is uncaught
      in every activation path (tab click, Ctrl+Tab, palette, explorer row,
      and `closeTabs`' neighbor handoff), so no toast, and the tab stays;
      tabs persist across restarts, so the row fails silently forever until
      manually closed. Worse: closing the active tab when its **neighbor's**
      file is gone leaves a zombie — the tab is removed, the handoff fails
      silently, `open` still points at the closed tab, the editor keeps
      showing it with no active tab in the strip, and Ctrl+W no-ops from
      there. Also: since a clean buffer has no draft, the vanished note's
      content lives only in that buffer — switching away or closing loses it
      with no ask. **Delete** on a vanished note errors with the app's
      ugliest message (verified: ``Error during a `trash` operation: … Class
not registered (0x80070002)``) and errors _before_ the draft/history
      cleanup, so the draft survives and the tab stays — the user's intent
      (be rid of it) fails. **Rename/move** toasts a raw io error ("The
      system cannot find the file specified. (os error 2)") — sane, unhelpful.
      **(2) Linked project root gone:** the walks skip unreadable dirs by
      design, so the project's notes silently vanish while the heading stays
      (it comes from the registry) — indistinguishable from an empty project;
      no signal anywhere. Startup handles the _active_ restored tab vanishing
      (drops it, falls back) but background restored tabs become (1)'s zombie
      rows. Creating a note into the missing root quietly re-creates the
      directory (`create_dir_all` on the save path). **(3) Mount backing
      folder gone:** same silent-empty (the mount heading stays via bareDirs,
      and it is not "conflicted"); `delete_mount` is the one command that
      already handles a gone backing folder gracefully. **(4) Drafts pointing
      at deleted notes — sane by design:** the draft keeps listing, opens from
      draft content, titlebar keeps the name, Ctrl+S recreates the file. One
      gap: the files tree derives from notes only, so once the note is gone
      the draft is reachable only via the palette (and Recent while fresh).
      **(5) Notes root gone:** `notes_root()` re-creates it on every command,
      so a deleted root comes back empty, silently. Root on an _unreachable_
      drive: every command errs, and the startup effect has no catch — the
      app sits on the blank pre-startup screen forever with no toast; the
      focus-handler refresh chains (`listNotes().then(setNotes)` etc.) also
      lack catches. **(6) History store:** `scan_changes` skips missing files
      silently (verified); prune never removes a note's latest snapshot, so a
      vanished note's last-known content stays in the store indefinitely —
      accepted (tiny, and a recreated note then diffs against its
      pre-deletion content), recorded so it isn't rediscovered.
      _Fix list (proposed order):_ **(a)** tab activation fails loud and
      cleans up — catch the `readNote` failure, toast "its file is gone",
      drop the tab, and make `closeTabs`' handoff skip to the next survivor
      (or welcome) instead of leaving the zombie active state; **(b)**
      `delete_note`/`delete_folder` treat already-gone as already-deleted —
      guard `exists()` like `delete_mount` does, skip the trash call but
      still clean draft + history and return Ok so the tab closes; **(c)**
      the focus re-sync, on seeing the open note's mtime go `null`, marks the
      buffer dirty and writes the draft — the buffer is the only copy, and
      this re-arms the close-confirm and draft safety nets; **(d)** missing
      project/mount roots say so: `list_mounts` gains `missing` beside
      `conflicted`, the explorer shows the same quiet detail treatment
      ("folder is missing"), projects likewise; **(e)** catch around the
      startup effect (toast + land on a usable state instead of a
      forever-blank window) and on the focus-handler refresh chains;
      **(f)** cosmetic: friendlier rename/move message for a gone file
      ("its file is gone — save first to recreate it").
      **Implemented 2026-08-13, all six in order, gates + tests clean,
      pending hands-on check.** (a) every activation path funnels through
      `openItem`, which now catches the read failure, toasts ("its file is
      gone"), and drops the tab; a new `handOff` walks the surviving tabs
      (welcome panel when none opens) and replaces every neighbor-activation
      — close, Close others, Close saved, deleted-subtree — so the zombie
      active state can't arise; the close-confirm's Save and the explorer
      rename bail out when activation failed rather than acting on the wrong
      tab. (b) `delete_note`/`delete_folder` guard `exists()` like
      `delete_mount`: already-gone skips the trash call, still cleans draft +
      history, returns Ok so the tab closes. (c) the focus re-sync, on the
      open note's mtime going `null` with a clean buffer, sets dirty and
      writes the draft — the only copy is back under the close-confirm and
      draft safety nets. (d) `list_mounts` gained `missing` beside
      `conflicted`; `list_projects` now returns `{name, missing}` (true only
      for a registered root — a notes-root project exists because its folder
      was just listed); the focus refresh re-lists projects so the flag
      tracks reality; the explorer shows the quiet "folder is missing" detail
      on project headings (current pane included) and on non-conflicted mount
      rows. (e) the startup effect is caught — toast + a blank capture
      instead of the forever-blank window — and the focus refresh chains
      report through one toast deduped by message (cleared on a successful
      re-list, the settings-error rule). (f) `move_note` answers a gone
      source with "its file is gone — save first to recreate it", surfaced by
      rename and move-to-project alike. Pending hands-on: delete a note
      externally then click its tab (toast, tab drops), close the active tab
      beside a vanished neighbor (hands off to a survivor, never a zombie),
      delete a vanished note/folder from the app (succeeds, cleans up),
      remove a project root and a mount backing folder and refocus (headings
      say "folder is missing"), refocus with the open note deleted (dirty dot
      appears, draft written), rename it (friendly message), and start with
      the notes root unreachable (toast + blank note, not a blank window).
- [ ] **Show the `.md` extension everywhere** (2026-08-13) — requested: the default
      extension was the one suffix chrome hid (explorer rows, tabs, palette, welcome
      recents, the title pill, rename prefill, search and changes headings all
      stripped it). Picked: **always show, everywhere** — over an Appearance setting
      and over explorer-rows-only. **Implemented 2026-08-13, gates clean, pending
      hands-on check.** One rule now — names render as they are on disk — so `.md`
      shows (tinted in the explorer like every other extension) and the old
      asymmetry where `.markdown` showed but `.md` didn't is gone. One deliberate
      exception: an `@`-mention's inserted link text still strips `.md` — that's
      prose in the note, not chrome (commented at the site). Rename prefills the
      full name; typing a bare name still gets `.md` appended, a typed
      registry-claimed extension still sticks. Pending hands-on: explorer rows in
      both tint modes and themes, tab widths with several tabs open, palette and
      mention-dropdown rows, and a rename round-trip.
- [ ] **Config/data files stop listing by default + personal ignore patterns**
      (2026-08-13) — requested: `.json` (and config files generally) shouldn't show
      uninvited; the settings-rework item recorded exactly this lean in 2026-08-09
      ("JSON and other non-text formats stay excluded unless someone opts them in")
      but the registry shipped them allowlisted — this closes that drift. Picked:
      **both** mechanisms in one pass. **Implemented 2026-08-13, gates + tests
      clean (27), pending hands-on check.** (1) Registry entries carry `listed`
      (absent = true, so a hand-edited registry keeps behaving): markdown / text /
      latex stay listed, json / yaml / config / csv / xml / log don't. An unlisted
      type keeps its view, icon, color and openability — `is_note` still claims it,
      only the walks' default-verdict gate moved to the new `is_listed`. Third
      registry migration hop: an untouched v1 or v2 (2026-08-12, frozen literally
      as `v2_note_types`) registry upgrades in place; any hand-edit is never
      touched. (2) settings.json gains personal `files` patterns (gitignore
      syntax): `walk_rules` compiles them ahead of a project's `.asapnotes.json`
      list — one ordered list, last match wins, so the portable project file
      overrides the personal layer; the notes root's own files get the personal
      layer alone. Bad personal patterns report through the `project_config_errors`
      channel ("settings.json files: …"), skipped in walks like project ones.
      Re-include still works end to end: a `!**/*.json` (either layer) lists json
      with its amber icon and tint intact. Accepted gap, extending the recorded
      drafts one: drafts of unlisted types don't list (the drafts walk keeps
      default rules on purpose). Hand-edit only — the registry/patterns UI stays
      with the settings-rework item's (b). Pending hands-on: relaunch once
      (settings.json should gain the `"listed": false` flags via migration), the
      `.deps.json`-class rows and loose jsons vanish everywhere (tree, search,
      scan counts, Recent), a project `!` re-include pulls one back tinted, a
      personal pattern in settings.json hides something on refocus, and a garbage
      pattern toasts once.
- [ ] **Ctrl+Shift+P opens the command palette** (2026-08-13) — requested: same as
      Ctrl+K. Implemented (one keydown branch, ahead of plain Ctrl+P so the note
      switcher doesn't swallow it), gates clean, pending hands-on. Ctrl+K stays
      the advertised shortcut in menus and the welcome primer. Pure task noise —
      delete on check.
- [ ] **File menu: surface the virtual-folder options** (2026-08-13) — requested: the
      many virtual-folder verbs that exist today (New folder, New virtual folder,
      Associate virtual folder…, Detach, Delete virtual folder) are reachable only by
      right-clicking explorer headings — the File menu (`menus` in `App.tsx`) has none
      of them. Add them under File. Open design point: most of these verbs need a
      target project/folder, which a menubar entry doesn't have — decide whether they
      act on the open note's location, prompt for a target, or only the target-less
      ones (e.g. associate into a picked project) appear.
      **Picked 2026-08-14: creation verbs only, acting on the open note's folder.**
      Implemented same day, gates clean, pending hands-on check. File gains New
      folder / New virtual folder / Associate virtual folder…, each naming its
      target in the label (`New folder in "docs"`) so the implicit target is
      stated, running the same explorer flows (inline name-first row / picker).
      The trio appears only when the open note sits in a project — a loose note's
      root can't hold folders (a top-level folder is a project), and a diff tab
      has no folder. Detach and Delete stay right-click-only, deliberately:
      destructive verbs against an implicit target invite deleting the wrong
      folder, and the heading menu names its target by position. Pending
      hands-on: the trio with a project note / loose note / diff tab open, each
      verb landing its input or picker in the right place.
- [ ] **Settings: credits line doesn't fit the label–value layout** (2026-08-13) —
      feedback: in Settings → About, the "Made by Anfifo · ☕ Buy me a coffee" line
      (`settings-credits` in `Settings.tsx`) floats free above the table, while every
      other entry follows the section's little-title → value row pattern (Version /
      Notes folder / Auto-update). Make it fit that layout — e.g. as table rows
      (Made by → Anfifo, Support → Buy me a coffee) or otherwise aligned with it.
      **Picked the two-row shape and implemented 2026-08-14, gates clean, pending
      hands-on check.** The free-floating flex row is gone; About now ends with
      `Made by` → Anfifo and `Support` → ☕ Buy me a coffee, each a normal row, so
      the section has one layout instead of two. The links read as plain values
      (inherit ink, underline on hover) except the coffee one, which keeps its
      amber — the one value in About meant to stand out. Dropped with the flex
      row: the `·` separator, the bold on the name (a value cell is already the
      emphasis), and the WebView2 baseline workaround the row needed, which a
      table cell doesn't. Pending hands-on: both themes, and that the ☕ doesn't
      grow the row.

## Today (2026-08-12)

- [ ] **Option to delete folders and virtual folders** (2026-08-12) — requested, not
      designed yet. Folder headings have create/attach verbs but no removal: a real
      folder can't be deleted from the explorer at all, and a virtual folder only
      offers "Detach", which leaves the backing directory behind in the
      virtual-folders home. Wanted: delete on both, following `delete_note`'s
      never-hard-delete rule (recycle bin via the `trash` crate). _Decided
      2026-08-12:_ delete always raises a **confirm that says the folder and its
      contents are really being deleted** (even though it goes to the recycle bin —
      the warning talks about deletion, recoverability is the safety net, not the
      pitch); for a virtual folder whose backing directory lives **outside the
      virtual-folders home** (an associated mount pointing at a folder the user
      owns elsewhere), the same popup additionally reminds where the real folder
      is and that it's that folder being trashed — "Delete" on any virtual folder
      means detach + trash the backing folder, with plain "Detach" staying as the
      keep-the-files option. Open tabs/drafts under the deleted subtree need the
      same closing treatment `delete_note` does.
      **Implemented 2026-08-12, pending hands-on check.** New Rust `delete_folder`
      (resolves like note ids, so a real folder inside a mount trashes inside the
      backing directory; refuses the mount point itself — that's `delete_mount` —
      and top-level folders, which are projects) and `delete_mount` (trash the
      backing folder, then the same detach `remove_mount` does); both hard-remove
      the drafts subtree, the way `delete_note` removes one note's draft.
      `MountInfo` gained `external` (backing folder outside the virtual-folders
      home) so the confirm on an associated mount can add "Its files live in
      <path> — that folder is what gets deleted." Menu wiring: subfolder headings
      get "Delete folder"; a mount heading gets "Delete virtual folder" beside
      "Detach" — except a conflicted mount, where the visible folder is the real
      one that took the name, so its entry is "Delete folder". After a delete the
      frontend closes every tab under the subtree (the active one hands off to a
      neighbor or a fresh note), drops session-only `newFolders` entries, and
      re-lists notes+drafts. Deliberately excluded: project headings — a project's
      lifecycle (unlink, and someday delete) is its own thing.
      **Backend verified end-to-end 2026-08-12** against a live app instance
      (isolated second instance, commands driven over the webview's devtools
      protocol): all guards fire with their messages (top-level refused, missing
      folder refused, mount point refused), a deleted subfolder + its draft
      subtree go while a sibling note stays, `external` reads false for a
      home-backed mount and true for an associated one, both `delete_mount`
      variants detach cleanly (no settings residue), and all three deleted
      folders landed in the recycle bin with their original paths. Still needs
      eyes (UI half only): the three context-menu entries, the confirm wording —
      especially the path callout on an associated mount — and tabs closing when
      their folder is deleted.

- [ ] **Confirm before closing an unsaved note/change** (2026-08-12) — requested: closing
      a tab holding an unsaved temporary note (or unsaved changes to a saved note) should
      raise the usual "are you sure?" confirmation instead of discarding silently. On
      confirm, the content should still be recoverable for a few days if possible — but
      recovery may require digging (e.g. the recycle bin / a trash-like holding area),
      not a first-class UI. Design notes: shadow drafts already autosave every edit to
      the app-data drafts folder, so the pieces exist — decide whether "discard" moves
      the draft to the recycle bin (matching `delete_note`'s never-hard-delete rule) or
      to a dated drafts-trash area pruned after N days. Interacts with the existing
      explorer discard-with-confirm on unsaved drafts and with the "empty untitled
      drafts accumulate" polish item.
      _2026-08-12 design pass (proposal, awaiting a pick — no code):_ a load-bearing
      correction to the premise first: **closing a tab today loses nothing.**
      `closeTab` deliberately leaves the shadow draft behind (and activating the
      neighbor flushes any pending debounce first), so the note reopens dirty from its
      draft later. The actual problem is that this safety is _invisible_ — the note
      looks gone, and untitled drafts pile up in the drafts folder unannounced (the
      accumulation polish item is the same root). Two candidate shapes:
      **(A) make close a decision point** — a tab whose buffer is dirty (or an
      untitled tab with non-empty content) raises a three-way choice on close:
      _Save_ (existing save path; untitled gets its derived name), _Discard_ (draft →
      recycle bin, reusing the `trash`-crate rule; a new `discard_draft` moves rather
      than `fs::remove`s), _Cancel_. Needs an in-app modal — the native dialog plugin
      is two-button — but the app already has sheet patterns. Drafts stop
      accumulating, recovery is the recycle bin (no N-day pruning area to build or
      explain). **(B) keep the current always-keep-a-draft behavior and surface it** —
      a toast ("kept as draft") on close and a visible drafts affordance; zero dialogs,
      zero data risk, but drafts keep accumulating and the requested confirm never
      appears. Recommendation: **A** — it's what was asked, it fixes accumulation as a
      side effect, and the recycle bin beats a bespoke drafts-trash (one recovery
      story, no pruning code). Rejected: dated drafts-trash pruned after N days — a
      second, hidden deletion policy in an app whose one rule is "deletion means the
      recycle bin".
      **Picked A and implemented 2026-08-12, gates clean, pending hands-on check.**
      Closing a tab that still holds unsaved content — dirty buffer when it's the
      active tab, a shadow draft when it's in the background — now raises an in-app
      Save / Discard / Cancel sheet (`CloseConfirm.tsx`; Enter saves, Esc cancels).
      Save runs the one existing save path (a background tab activates first, so
      name derivation and the changed-on-disk guard both apply) and closes only if
      the save really happened. Discard flushes the buffer into the draft and moves
      the draft to the recycle bin — new Rust `discard_draft`; `delete_draft` stays
      the silent cleanup for content that's safe elsewhere — and the explorer's
      discard-with-confirm now recycles the same way instead of hard-deleting. A
      never-typed untitled tab closes silently and its empty draft is removed, so
      empty untitled drafts stop accumulating. Deliberately left alone: bulk closes
      (Close others / saved / all) keep today's leave-a-draft-behind behavior — one
      decision per deliberate close, not a modal stack. Pending hands-on: the
      sheet's feel, a discarded draft landing in the recycle bin, saving from a
      background tab, and Cancel returning focus to the editor.

- [ ] **Allow closing the last tab → welcome panel** (2026-08-12) — requested: today
      the last untitled note can't be closed; make it closable. With zero tabs open,
      the editor area shows a **welcome panel**: a start screen listing the main
      actions as clickable entries (new note, scan a folder for projects, attach a
      virtual folder, open a recent note…) plus short pointers to the tool's commands
      and shortcuts (Ctrl+K palette, Ctrl+P switcher, global summon), so it doubles as
      a first-run "what can this do" surface. **Summon behavior is unchanged**: hiding
      to tray and summoning again still lands in a ready-to-type note instantly — the
      welcome panel appears only when the user deliberately closes the last tab, never
      as a default state. (If the window is summoned while the welcome panel is up,
      decide: keep showing it, or auto-create a fresh untitled note — the requested
      intent leans to a new note being the quick default.)
      _2026-08-12 design pass (proposal, awaiting a pick — no code):_ the zero-tab
      state becomes real: `closeTab`'s last-tab branch stops calling `newNote()` and
      instead clears `open` to null; the editor area renders a `WelcomePanel` whenever
      `open` is null (today that's only the pre-startup instant). Panel content:
      the main actions as clickable rows reusing existing callbacks (new note, scan a
      folder for projects, associate a virtual folder, the top ~5 recent notes), then
      a short shortcuts primer (Ctrl+K palette, Ctrl+P switcher, the global summon
      hotkey) so it doubles as first-run orientation. Summon with the panel up:
      **auto-create a fresh untitled note** (the stated lean) — one `openRef.current
=== null → newNote()` check in the show/summon handler, keeping "summon lands in
      a ready-to-type note" an invariant rather than a special case. Startup is
      untouched: something always opens (restored tab / draft / recent note / blank),
      so the panel appears only after a deliberate last-tab close. Implementation
      caution: chrome paths that assume a note is open need a sweep — `canPreview`/
      `canFormat` default to true with nothing open, the status bar/menus/title
      readouts render from `open` — each needs a sane zero-tab presentation, and
      Ctrl+W with the panel up should do nothing rather than throw. Alternative
      considered: the welcome panel as a persistent pseudo-tab — rejected, it
      re-introduces "the tab you can't close", which is the complaint this item
      exists to fix.
      **Picked and implemented 2026-08-13, gates clean, pending hands-on check.**
      New `WelcomePanel.tsx` (start actions / top-5 recents merged notes+drafts /
      shortcuts primer, muted styling in both themes) renders whenever the new
      `welcome` state is set — a state of its own rather than `open === null`,
      because null is also the pre-startup instant and the panel must never
      flash during startup. Every close path that empties the strip lands there
      (last-tab close, Close all, Close saved, deleting the folder holding the
      only tabs); summon with the panel up auto-creates a fresh note, as picked.
      Chrome sweep: preview eye / format toolbar / Format menu hide (the editor
      clears its own status readout on unmount, so the status bar empties too);
      the search pill already fell back to "Search"; Ctrl+W already no-ops.
      Two deviations from the sketch: "associate a virtual folder" is not among
      the actions — it needs a target project, which the zero-tab state doesn't
      have — so the target-less "New project…" and "Settings" stand in; and the
      bulk closes land on the panel too, keeping "zero tabs ⇔ welcome panel" an
      invariant instead of a special case. Note: an earlier unmerged take on
      this item exists on the `worktree-welcome-panel` branch (2026-08-12, base
      five commits stale); this implementation supersedes it and folded in its
      recents dedupe — the branch and its worktree can be deleted.
      Pending hands-on: close the last tab, click each action and a recent,
      summon past the panel, both themes.

## Today (2026-08-11)

- [ ] **Explorer: indent guides for expanded folders** (2026-08-11) — feedback: hard to
      tell what's inside vs. outside an expanded folder. Draw a vertical guide line per
      nesting level that follows the indentation, so where a folder's subtree ends is
      visible at a glance.
      _2026-08-13 design pass (candidate sheet published, awaiting a pick — no code):_
      the mechanism falls out of how the tree already nests — indentation is
      `margin-left: 0.8rem` on the `details > ul` / `details > details` subtree
      containers, so a guide is a pseudo-element on those two selectors (1px, absolutely
      positioned 4px left of the container edge, i.e. under the parent chevron's center,
      spanning the container's full height). Sibling containers at a level abut, so the
      segments join into one continuous line per subtree; no markup change, no JS, no
      layout shift (not a border). Three candidates on the sheet, real explorer metrics,
      light+dark: **(A) always-on hairlines** — rgba(0,0,0,.10) light /
      rgba(255,255,255,.12) dark; one CSS rule; **(B) hairlines only while the pointer
      is over the tree** — quieter at rest, but the confused glance usually precedes the
      pointer, so the information is missing exactly when asked for; **(C) A plus an
      active trail** — the guides on the open note's path in quiet amber; needs one
      class from `renderTree` (it knows the open id); composes on top of A later.
      The sheet also carries an ink ladder (.06/.10/.16 light, .08/.12/.20 dark) and a
      12.8px-vs-16px indent comparison. Recommendation was A (smallest step); **picked
      2026-08-13: C**, plus one correction from the sheet — the space before the file
      icon read as dead air.
      **Implemented 2026-08-13, gates clean, pending hands-on check.** The guides are
      the one pseudo-element rule on the two nested-container selectors (middle ink:
      rgba(0,0,0,.10) light / rgba(255,255,255,.12) dark); `renderTree` computes one
      `trail` flag per level from the open note's id and stamps it on every container
      at that level — all of a level's containers jointly draw one line, so a partial
      class would read as a broken guide (amber: rgba(138,106,0,.55) /
      rgba(220,191,90,.5)). Indent stays 12.8px. The dead air was `.explorer li`'s
      1.1rem left padding — it aligned file _names_ with folder names before icons
      existed; now file rows share the heading rows' 0.4rem inset, so the icon sits in
      the chevron's column. Known consequence, deliberate: the Recent list is a
      `details > ul` like any other, so it draws a guide too — consistent, but worth
      one look. Pending hands-on: expand two sibling folders and check the boundary
      reads at a glance, open a note deep in a mount and check the amber trail, both
      themes, and the tighter file-row inset next to headings.
- [ ] **Explorer: file-type icons + colored extensions** (2026-08-11) — suggestion:
      each file row gets the classic icon for its type before the name, provided the
      icons come from a freely-licensed source (the repo is going public, so no
      lifting an editor's icon set). Additionally the extension part of the name is
      tinted with the color conventionally associated with the type — e.g.
      `test.json` renders "json" in a distinctive but still readable color. Hooks
      into settings-rework (b) below: the note-type registry already carries `icon`
      and `color` per type in `settings.json`, but nothing renders them yet — this
      is the rendering half, and those fields should be its source of truth.
      _2026-08-12: icon source researched and recommended — **Lucide (ISC license)**._
      ISC permits copy/modify/distribute for any purpose (keep the copyright notice
      in copies); its `file-*` family covers the registry's needs (`file-text`,
      `file-json`, `file-code`, `file-spreadsheet`, `file-cog`, `file-terminal`, …);
      and it is already the app's icon idiom — the toolbar's inline stroke SVGs and
      the registry's existing `icon` ids (`file-text`, `file`) are of exactly this
      shape, so no second visual language enters the repo. Icons land as inline
      `currentColor` SVGs like the toolbar's (no dependency added). One design
      consequence to decide with the rendering: today the registry has only two
      types (markdown, text), so per-extension "classic" icons (json ≠ csv ≠ yaml)
      mean splitting the plain-text entry into a few finer types (e.g. data/config/
      log) — which the registry supports as pure data. Colors are values in the
      registry's `color` field; pick them tuned against both themes the way the
      syntax palette was, not lifted from any product's theme.
      _2026-08-12: a three-way candidate sheet (quiet icons + tinted extension /
      both tinted / icon-only tint, real explorer metrics, light+dark, size ladder,
      live contrast table; tints drawn from the `--syn-*` palette) is published and
      awaiting a pick — no repo assets touched until one lands._
      **Picked 2026-08-12: full tint (icon + extension) is the default, with an
      icon-only-tint option in Settings → Appearance** (that section already exists —
      the theme picker lives there — so no need to defer the option). Implementation
      plan, agreed to build next:
      (1) **Registry split** — the shipped `noteTypes` grow from two entries to a
      handful (markdown / text / data / config / log / …) so per-extension icons and
      colors have a type to live on; pure data change in `default_note_types()`.
      Existing `settings.json` files hold the old two-type registry, so a one-shot
      migration replaces `noteTypes` **only when it deep-equals the old shipped
      defaults** — a hand-customized registry is never overwritten.
      (2) **Color is a token id, not a hex** — same rule as `view`/`icon`: the
      registry's `color` names an in-tree tint slot (`blue`, `amber`, `rose`,
      `purple`, `green`, `orange`, `gray`, `teal`), each defined per theme in
      `App.css`, because one literal color can't be right on both grounds (the
      syntax-palette work proved it). A value starting with `#` passes through
      as-is for users who want it anyway. Tint values are the candidate sheet's,
      reusing `--syn-*` where an association exists.
      (3) **Rendering** — explorer rows (Recent included) get an inline Lucide
      stroke SVG (in-tree glyph table keyed by the registry's `icon` id) plus an
      extension span carrying the tint; `.md` stays stripped as today, so markdown
      rows show a tinted icon and no suffix. Search results / tabs / palette rows
      deliberately not in this pass.
      (4) **The option** — `appearance.explorerTint: "full" | "icon"` (default
      `full`), dual-written like theme/zoom, one segmented control in Settings →
      Appearance; `icon` renders the extension in the row's muted detail ink.
      **Implemented 2026-08-12, gates clean, migration verified against the live
      settings.json** (the file upgraded to the nine-type registry on relaunch —
      markdown/text/json/yaml/config/csv/xml/log/latex, colors as tint ids).
      Explorer rows (Recent included) now render the glyph + tinted extension;
      `.md` stays stripped, so markdown rows show a blue icon and no suffix.
      Deliberately left alone: search results, tabs, palette rows, and the
      mention dropdown still render plain names — worth one look at the explorer
      before deciding whether they should follow. Pending hands-on: eyeball rows
      in both themes, flip File-type color to "Icon only" in Settings and back,
      and restart once to confirm the choice sticks.
- [ ] **Bug: `.md` files not showing as markdown** (2026-08-11) — reported: `.md` files
      aren't being presented as markdown. Needs a repro to pin down where (explorer
      display, editor features, or type resolution) — suspect the note-type registry
      move, since `isMarkdown` was replaced by registry lookups. Diagnose before fixing.
      _2026-08-12 read-only diagnosis pass — ruled out, so the repro session starts
      ahead:_ (1) the registry data on this machine is healthy (`settings.json` has
      `md`/`markdown` → view `markdown` with all five features); (2) startup ordering
      is safe — `setNoteTypes` runs inside the same awaited `Promise.all` as the
      restored-tab open, so the registry is filled before the first editor mounts;
      (3) resolution handles case and separators (`extOf` lowercases and only needs
      the last dot; Rust side is `eq_ignore_ascii_case`); (4) no `.asapnotes.json`
      exists in any linked project, so `files`-rules interplay isn't it; (5) drafts
      are flat `untitled-*.md` ids. Two structural weak points found (neither proven
      to be the report): the registry is **module state mutated outside React** —
      `setNoteTypes` triggers no re-render itself and today rides on `applySettings`'
      sibling `setState`s; and the editor's extensions are **frozen at mount, rebuilt
      only by `docKey`** — a type/feature change arriving between mount and the next
      open (e.g. a hand-edit of `settings.json` reloading on focus) updates the chrome
      but not the open editor's surface. Next step is a live repro: when it happens,
      check whether the _chrome_ (toolbar/preview eye) also thinks it's not markdown —
      that splits type resolution from a stale editor mount in one look.
- [ ] **Default exclusions miss compiled output** (2026-08-11) — reported: some compiled
      JSON artifacts still show up despite the ignore rules. The default rule set
      (registry allowlist + `SKIP_DIRS`) needs to be smarter about generated/build
      output — identify what leaked through and extend the defaults (per-project
      `.asapnotes.json` overrides already exist as the escape hatch).
      _2026-08-12 diagnosis — the leak is identified (walk simulated read-only over
      the three linked projects with the exact skip rules):_ the dominant source is
      **.NET build output**: `bin/` and `obj/` are not in `SKIP_DIRS`, so
      `*.deps.json`, `*.runtimeconfig.json`, `project.assets.json`, nuget dgspecs,
      staticwebassets caches — dozens per project — all list. Smaller leaks:
      `*.egg-info/` (Python packaging metadata: `SOURCES.txt`, `requires.txt`…),
      `package-lock.json` (generated lockfiles at every JS package root), and
      rotating `logs/app-*.log` trees. Also found on the way: **dot-files with
      allowlisted extensions (`.prettierrc.json`) are listed but unopenable** — the
      walk has no leading-dot rule for files, while `checked_name` rejects any id
      segment starting with a dot, so they show in the explorer and error on click.
      Proposed fix (pending the go-ahead, one edit in `notes.rs`): add `bin` and
      `obj` to `SKIP_DIRS`; skip directories whose name ends `.egg-info`; give files
      the same leading-dot skip directories already have (also fixes the unopenable
      rows); and skip `package-lock.json` by name as the one generated _file_ the
      extension allowlist can't express. Judgment call left open: `logs/` dirs —
      `.log` was deliberately allowlisted, so either accept rotating logs as content
      or skip dirs named `logs` and lean on `.asapnotes.json` re-include; leaning
      skip, since a dir full of dated rotating files is generated output by any
      reading. `package.json`/`tsconfig.json` remain visible on purpose — hand-written
      config is arguably content, and hiding it is what per-project rules are for.
      **Implemented 2026-08-13 as proposed (with the `logs/` skip), gates + tests
      clean, pending hands-on check.** `SKIP_DIRS` gained `bin`/`obj`/`logs`,
      `skip_dir` learned the `.egg-info` suffix, and `listed` — the one file gate
      both walks and the scan counts share — rejects dot-files outright (ids can't
      express them, so a listed row could only error on open) and skips
      `package-lock.json` under default rules only, so a project's `!` pattern can
      still pull a lockfile back in, exactly like a `!`-matched folder still
      descends past `SKIP_DIRS`. Pending hands-on: refocus with a .NET repo linked
      and watch the `bin/`/`obj/` artifact rows vanish; `.prettierrc.json` should
      no longer list.
- [ ] **Dropdown/popup text size: smaller default + customizable** (2026-08-11) —
      feedback: dropdowns/popups (menus, palette, context menus) read too big. Make
      their text size a user setting, and set the default ~20% smaller than today
      without breaking layout (check padding/row heights still line up at the new size).
      _2026-08-12 design pass (proposal, awaiting a pick — no code):_ the survey
      explains the feedback precisely: **palette rows have no font-size of their own**
      — `.palette li` inherits the root 16px, ~20% larger than every other piece of
      chrome (menubar/dropdowns/context menus sit at 0.8rem, explorer 0.85rem, the
      palette's own input at 0.95rem). So "20% smaller" and "consistent with the rest
      of the app" are the same fix. Proposal: one token, `--popup-font-size`, default
      `0.8rem`, consumed by the three popup surfaces (menu dropdowns, context menus,
      palette rows — the mention dropdown already follows the palette); their paddings
      and row heights switch from rem to `em` so geometry tracks the font size and no
      per-size layout audit is needed. The user setting is a small stepped control in
      Settings → Appearance (e.g. 85% / 100% / 115% applied to the token), stored in
      `appearance` alongside theme/zoom with the same localStorage boot-mirror
      dual-write. Alternative considered: scale each surface separately (palette-only
      fix now, menus untouched) — cheaper, but the feedback names all three, and one
      token is the difference between a setting and three.
      **Picked and implemented 2026-08-13, gates clean, pending hands-on check.**
      `--popup-font-size` (default 0.8rem) now drives menu dropdowns, context
      menus, palette rows, and the mention dropdown, with their paddings/gaps/
      min-widths converted to `em` so geometry follows the size. One survey
      correction discovered on the way: context menus were not at 0.8rem — the
      menubar's dropdowns inherit it from the menubar, but `.ctx-menu` renders at
      the pointer outside that scope and sat at the root 16px, so context menus
      shrink the full ~20% too (their padding values were converted so the
      default is pixel-identical for the surfaces that were already 0.8rem).
      Palette section headers and `.menu-detail` scale relative to the token.
      The setting: Settings → Appearance → "Popup text size" (Small 85% /
      Default / Large 115%), `appearance.popupScale` in settings.json with the
      localStorage boot-mirror dual-write; one `style.setProperty` on the root
      element is the whole apply mechanism. Deliberately left alone: the
      palette's input (0.95rem) and footer hints — the feedback names row text,
      not the query box. Pending hands-on: open menu/context menu/palette at
      each step, check row alignment and hover pills at 85%.

## Today (2026-08-10)

- [ ] **Canvas surface: project board, freeform canvas, ink — and the note-type
      registry under them** (2026-08-10) — agreed design, **no code yet**. Requested
      after feedback that heavy note-takers value a freeform page where text and
      images are boxes dropped anywhere, plus the wish that clicking a project opens
      a _view_ instead of only expanding a tree.

  **Shape: one canvas engine, two node vocabularies.** Pan/zoom, hit testing,
  selection, marquee, drag, resize, z-order are built once and configured twice —
  (a) **project board**: nodes are note _files_, laid out freely, click opens the
  tab; layout lives in the per-project config planned in the virtual-folders item
  below; (b) **freeform canvas**: nodes are arbitrary content — text boxes, images,
  ink. This is why the cheap half is a stepping stone rather than a detour.

  **Editing inside a canvas: one live editor, N static blocks.** One CodeMirror
  instance per text box would blow both RAM and mount time, so blocks render through
  the existing preview path and a real editor mounts only in the focused block.

  _Decisions taken 2026-08-10:_

  - **Built natively in-tree — not as a plugin system.** The latency worry that
    prompted the plugin idea is answered by lazy loading, not by an extension host:
    a code-split canvas module loaded on tab activation costs nothing at idle.
    Plugins buy third-party extensibility instead, which is a separate goal, and
    loading untrusted code into a resident tray app is in direct tension with the
    no-unrequested-network invariant. Also: canvas is currently the _only_ candidate
    consumer, and an API designed for one consumer is the wrong API.
  - **The seam is a note-type registry, not a plugin API.** A note type declares its
    extensions, view provider, icon, and supported features; views become providers
    (`editor` / `preview` / `canvas`) selected by type and dynamically imported.
    This is worth doing on its own: that knowledge is scattered today across
    `NOTE_EXTS` (notes.rs), `hasNoteExt` (paths.ts), Editor's `plainText` flag, and
    md-only branches in App — and the settings-rework item below already asks for
    exactly this registry (user-configurable note extensions + per-type colors).
    Commands are the second registry and are already half-built via the Ctrl+K palette.
  - **Format: JSONCanvas (open spec) + a custom ink node type.** Keeps plain boards
    and canvases readable by other tools and by the planned MCP, instead of a private
    schema. Accepted trade, recorded so it isn't rediscovered: JSONCanvas nodes are
    axis-aligned rectangles with no rotation and no freehand, so the ink node is a
    documented extension — a conforming reader will open the file but skip strokes.
  - **No canvas library** (tldraw / konva / react-flow class). Pan/zoom over a
    transform matrix is a few hundred lines; a library is idle rent plus a heavy
    framework, both of which need a stronger case than this.
  - **Idle-footprint rules, binding on the implementation:** (1) dynamic import only —
    no top-level import of the canvas module or its deps, or every user pays for it
    at startup; (2) no watchers, polling, or timers outside an open canvas; (3) a
    canvas tab restored as the _active_ tab must still load on activation, not at
    startup — otherwise persisted tabs quietly move the cost back into summon.
  - **Undo is a canvas-level history stack.** CodeMirror owns undo per text block,
    but move/resize/delete/z-order are canvas operations and users expect one Ctrl+Z.
    Budget for it explicitly rather than discovering it late.

  _Order and rough cost (build in this order — the cheap half proves the engine):_

  1. **Project board** (~2–3 d) — note-file nodes, layout in per-project config.
  2. **Freeform canvas** (~1 wk for a credible MVP) — surface + transforms ~2 d;
     block model with lazy editor mount + images ~2 d; Rust read/write and
     tab/explorer/search/draft integration ~2 d; unified undo ~1 d.
  3. **Ink on top of images** (~2–3 d) — pointer events give pressure/tilt with a
     real pen; expect a raster layer rather than thousands of SVG paths once stroke
     counts grow, and decide erase semantics (whole-stroke vs. pixel) up front.

  Images are largely free: `save_asset` / `import_asset`, the asset protocol, and
  paste/drag-drop already exist.

  _Deliberately deferred:_ a third-party plugin API — revisit only once a second
  consumer exists to prove the shape, at which point the isolation model (sandboxed
  view with a capability-gated bridge vs. process-isolated host) is the real
  decision, not the contribution points. Handwriting recognition, node rotation,
  and connectors/arrows are out of scope for the first pass.

  _Overlaps to design together, not bolt on:_ the workspace/project-model doc (board
  layout is per-project config) and the settings rework (the note-type registry is
  the same registry). Both are below. **2026-08-10: settled in
  [docs/project-model.md](project-model.md)**, with one correction to the assumption
  above — board layout is **not** a config key but its own `board.canvas` JSONCanvas
  file, whose nodes are the spec's `file` nodes. One format for both vocabularies,
  readable by other tools and the planned MCP, and node drags stop rewriting a
  settings file; costs one more visible file per project. The registry landed as
  designed: `{ id, extensions, view, icon, features }`, where `view`/`icon` are ids
  into in-tree tables (so a user can add extensions from JSON but never a view — the
  native-not-plugin line, enforced by the data model), and `features` is a closed set
  the chrome keys off instead of `isMarkdown`. `.canvas` ships as a type with
  `view: "canvas"` behind the dynamic import.

  **2026-08-10: the registry itself has shipped** (settings-rework item) — data in
  `settings.json`, `features` gating the chrome, `view` narrowed in `src/noteTypes.ts`.
  What canvas still owns of that seam: the `canvas` entry (deliberately not shipped —
  nothing implements that view yet, and a listed `.canvas` opening as raw JSON is worse
  than not listing it) and a real **view provider table**: with two views the table is one
  branch in `Editor`, and the dynamic import belongs in it when the third arrives.
  **2026-08-14: step 1 (project board) is implemented** — see the "Canvas work
  kicked off" item under 2026-08-14 for what shipped and what's pending. The
  `canvas` registry entry shipped with it (the view now exists), and the
  provider seam landed as the planned dynamic import (a canvas tab renders the
  code-split board module; markdown/text stay the one branch in `Editor`).
  Steps 2 (freeform canvas — text/image nodes, one live editor) and 3 (ink)
  are still open, and the picked "default open" behaviors (new-note default,
  summon canvas) ride on step 2.

  **2026-08-14: step 2 (freeform canvas) is implemented** — see the "Freeform canvas
  (canvas step 2)" item under 2026-08-14 for the picks, what shipped and what is pending
  hands-on.

  **2026-08-16: step 3 (ink) is implemented** — see the "Ink (canvas step 3)" item under
  2026-08-16. All three steps of this item are now built; what remains of the canvas
  thread is the hands-on passes recorded on each step's own item, and the
  image-annotation surface below that builds on the ink layer.

  _Promoted to `decisions/` 2026-08-14_, both entries this item called for:
  [canvas is a native view, not a plugin](decisions/2026-08-14-canvas-is-a-native-view.md)
  (the seam, and why the plugin API is deferred) and
  [canvas files are JSONCanvas plus an ink extension](decisions/2026-08-14-canvas-files-are-jsoncanvas.md)
  (which softens the plain-text-files-are-the-store line the same way the plain-text formats
  item does, and links to it).

- [ ] **Dev environment for a public repo — questions written, F5 shipped** (2026-08-10) —
      triggered by "why doesn't F5 work?": it did nothing because no launch config existed.
      **Done:** [`.vscode/launch.json`](../.vscode/launch.json) committed (F5 launches
      `@tauri-apps/cli/tauri.js dev` directly in the integrated terminal) and
      `.gitignore` widened to let it through — previously only `extensions.json` was
      un-ignored. First attempt used the `node-terminal` debug type running
      `npm.cmd run tauri dev` and silently did nothing — terminal opened, Node version
      probe printed, command never ran (confirmed by process scan: no cargo/rustc/
      asapnotes.exe, nothing on 1420, while the same command in a plain terminal
      reached `Running target\debug\asapnotes.exe` in 12 s). Invoking the CLI script
      directly drops the shell from the path, which also makes the config portable.
      Chosen over a Rust-debugging config, which needs a debug adapter
      (CodeLLDB or C/C++) that isn't installed here: verifying it wasn't possible, and
      unverified config shouldn't go into a repo about to be public.
      **Open:** everything else about the dev environment is written up as a question
      list in [`dev-environment.md`](dev-environment.md) — license (the one real
      blocker), CI, tests, toolchain pinning, CONTRIBUTING + what happens to CLAUDE.md,
      and the small day-one embarrassments (stray `test.md`, stale README status, no
      screenshot). It ends in an ordered decision checklist; nothing there is
      implemented. Lands together with the "Prepare repo for going public" item below,
      which owns the _content_ half (scrubs, history) while this owns the machinery.

## Today (2026-08-09)

- [ ] **Explorer: easier creation, wider resize, context menus everywhere**
      (2026-08-09) — three panel gripes designed and implemented in one pass,
      pending hands-on check. (a) **Name-first inline creation** (chosen over
      keeping untitled tabs): hover-revealed `+` on every section/project/folder
      heading (plus one in the panel header bar) opens an inline input row where
      the file will land — Enter writes the (empty) file immediately and opens
      it; Esc/blur cancels; a typed allowlisted extension sticks, else `.md`;
      collision and invalid-name guards toast. Ctrl+N / tab `+` stay
      capture-first — only explorer-driven creation names first. (b) **Resize**:
      the 480px hard cap is gone; the drag now ranges to `window − 280px`
      (docked; floating gets `window − 48px`), and since the drag can no longer
      cross the auto-collapse threshold, only an actual window shrink collapses
      the panel (chosen over deleting auto-collapse entirely). (c) **Context
      menus**: empty panel body (new note / new project / scan folder…) and
      project+folder headings (new note here / copy path / open in File
      Explorer — folders _open_ rather than being selected in their parent,
      via `open_external` on the path `Copy path` already computes, so no
      directory resolver was added to the backend); row menus' "New note
      here" now triggers inline creation next to that note. `openContextMenu`
      stops propagation so nested targets resolve innermost-first. Deliberately
      deferred: project rename (needs folder-move backend), collapse-all (nested
      folder `<details>` are uncontrolled). Known wrinkle: a folder auto-opened
      to host the create row closes again after creation (React drops the
      forced `open` attr) — reveal-active-note (Tier 3) is the real fix.
- [ ] **Explorer context menu: create folder + add virtual folder** (2026-08-10) —
      requested, not designed yet. Right-clicking in the explorer (empty body,
      project heading, folder heading) should offer (a) **New folder** — a real
      directory on disk, created inline in the same name-first row the new-note
      flow already uses; and (b) **Add virtual folder** — attach a folder that
      does _not_ live under the project's disk tree, i.e. the virtual-entry half
      of the per-project file config item below (which also owns the "color
      virtual entries differently" rule). (a) is a small addition to the existing
      context menus (new Rust command + a `kind` on the inline create row);
      (b) can't ship before the project-config format is decided, since the
      mapping has to persist somewhere. ~~Open: does "add" mean pick an existing
      folder, or create one elsewhere and link it?~~ **Answered 2026-08-10 in
      [docs/project-model.md](project-model.md): pick.** One verb — mount an
      existing folder at a name — because the system folder picker already creates
      folders, so a second flow would be a second code path for nothing.
      **2026-08-11: (b) shipped with step 4** — "Add virtual folder…" on a project or
      folder heading picks a folder and attaches it under its own name; the mount root
      carries a link glyph and its real path, its subtree a tint, and "Detach virtual
      folder" is on the same menu. **(a) New folder shipped 2026-08-11**, pending
      hands-on check: the same headings now offer "New folder" beside "Add virtual
      folder…" — create makes a real directory right where you clicked (the inline
      name-first row, with a `kind`), add attaches one that lives elsewhere (and the
      system picker is where _those_ get created). New Rust `create_folder`: resolves
      the folder id the same way note ids resolve (so creating under a mount lands in
      the mount's real directory), refuses a name a mount sits at (a real folder would
      hide it), depth capped one segment under `MAX_DEPTH`. Known gap, deliberate: the
      explorer tree derives from note files, so a still-empty new folder is remembered
      only for the session (`newFolders`, same idea as empty mounts) — after a restart
      it isn't listed until a note lands in it; the real fix is the backend walk
      returning directories, which belongs with reveal-active-note (Tier 3).
      **2026-08-12: the verb set grew and renamed** (feedback: creating a virtual
      folder shouldn't require the picker). The heading menu now offers three
      creations — **New folder** (real directory here), **New virtual folder**
      (name-first row; the backing directory is created in the **virtual-folders
      home** and attached — new `create_virtual_folder`, sharing `add_mount`'s
      validation via `checked_mount_at`/`register_mount`), and **Associate virtual
      folder…** (the renamed pick-an-existing flow). The home is `virtualFoldersRoot`
      in `settings.json`, defaulting to `virtual/<project>/<at>` in app data —
      deliberately not the installation folder (updates replace it) and never inside
      a project (virtual means the contents live elsewhere). Detaching leaves the
      backing folder in place, so creating the same name again revives its files.
      Pending hands-on: create a virtual folder on a project heading, drop a note in
      it, detach, re-create the same name and see the note come back. Related open
      end: a drafts-location setting was mentioned in the same breath — separate
      item, not designed.
- [ ] **Settings rework: menubar entry, theme, file-type config, per-project config**
      (2026-08-09) — captured design intent, needs design before code. (a) **Settings
      moves to the top**: its own menubar entry; Help probably stops being a top-level
      menu and folds into Settings. (b) **Theme selector** — done 2026-08-10 (see the
      Tier 3 item below); it already lives in Settings under a new Appearance section,
      and its setting sits in localStorage, so it moves into whatever JSON settings
      file this item lands on. (c) **App-level file-type
      config**: which extensions count as notes (today hardcoded in
      `NOTE_EXTS`/`hasNoteExt`), plus optional per-type color/highlight in the
      explorer; editable in the UI **and** as a plain JSON settings file (and via MCP
      later). (d) **Per-project settings**, optionally loaded from a JSON config file
      in the project, including **exclusions in `.gitignore` pattern syntax**; ship a
      default exclusion set that effectively excludes everything unsupported, which a
      project config can override — so a project could pull code files back in even
      though they're outside the default allowlist. Leaning on defaults: keep the
      usual `.md`/plain-text set; JSON and other non-text formats stay excluded
      unless someone opts them in. Overlaps the virtual-folders item above and the
      workspace/project-model design doc — the per-project config file is likely
      the same file; design them together. **2026-08-10: (c) and (d) are designed
      in [docs/project-model.md](project-model.md)**; (a) the menubar move and the
      Help fold are still open UI work, unaffected by it. Two files, not one, and
      the seam is **trust, not scope**: anything that grants access or names a
      machine path is personal (app-data `settings.json`), everything portable is
      `<project>/.asapnotes.json` — because a project file arrives on other
      machines by `git pull`, so an MCP grant or a mount living there would let a
      clone widen what the app can reach. The project file is created lazily and
      `.gitignore` is never touched, so linking a dozen repos writes nothing.
      Exclusions: the **default stays code** (registry allowlist + skip dirs), since
      the pattern idiom for "deny everything except" is a foot-gun; a project
      overrides with **one ordered list, last match wins**, where `!src/**/*.rs`
      both re-includes and waives the type allowlist. Note the startup constraint
      recorded there: `localStorage` stays as a boot mirror for theme/zoom/explorer/
      tabs, because those are read before first paint and summon latency outranks
      config purity.

  **2026-08-10 — (c) landed as data; steps 1–2 of the doc's order are in.** New
  `src-tauri/src/settings.rs` owns app-data `settings.json`: the whole documented schema
  (so a write never drops a key it didn't model), parsed once into app state and replaced
  on write, re-read when the frontend asks on window focus. `external_projects.json` is
  migrated into `projects` entries on first launch and deleted after the new file is
  safely written (temp + rename — this file now holds every project mapping). A parse
  failure is deliberately **not** fatal: shipped defaults take over, the message is
  toasted once, and writes are refused so the file the user has to fix is never
  overwritten. Appearance dual-writes — `localStorage` for the pre-paint read, the file as
  source of truth, reconciled from the file once it loads (tabs stay localStorage-only:
  session state, not settings). `notesRoot` is deliberately **not** written yet — honoring
  a hand-edited root is a real new capability with no UI, no validation and no answer for
  existing notes; it belongs with (a)/(b) below.

  The **note-type registry is that file's `noteTypes`**, and it retired the duplicated
  knowledge: `NOTE_EXTS` and `has_note_ext` (notes.rs) are now `Settings::is_note`,
  `hasNoteExt`/`isMarkdown` (paths.ts) are gone in favour of `src/noteTypes.ts`, the
  Editor's `plainText` flag became `view` + `features`, and App's md-only branches became
  `preview` / `format` / `images` / `mentions` / `live-preview` checks. One list, read by
  both sides from the same file. Two deliberate deltas from before: `.markdown` joins the
  allowlist, and a dropped image now needs the `images` feature (it used to insert a
  markdown image link into a `.log`). The `canvas` type is **not** shipped yet — nothing
  implements that view, so it lands with the canvas work.

  **(a) landed 2026-08-14, gates clean, pending hands-on check.** Settings is its
  own top-level menu (mnemonic S — the keybinds table and the mnemonic notes
  updated from H) holding Settings…, Keyboard shortcuts, and About asapnotes;
  Help is gone as a top-level menu and File's Settings entry with it. Folding
  Help in earned one small addition: the overlay takes a `section` prop and
  "Keyboard shortcuts" scrolls straight to its table (it's the last section,
  below the fold at any size); About is the first section, so it needs no
  scroll of its own. Pending hands-on: Alt+S, arrow-through, and the shortcuts
  entry landing on the table from menu and palette both.

  Still open here: **(b)** the explorer's
  per-type icon and color, and a UI for editing note types — `icon` and `color` are carried
  in the file but nothing renders them yet, so editing them by hand currently does nothing.
  **(d) landed 2026-08-11** — the per-project `.asapnotes.json` and its `files` patterns
  shipped as step 5 of the project-model item below (hand-edit only; a UI for it belongs
  with (b)).

- [ ] **Ctrl+Click links in every editor** (2026-08-09) — agreed design (Ctrl+Click
      chosen over plain click — plain click must keep placing the cursor): new CM
      extension `src/links.ts`, active in markdown and plain-text editors alike.
      Recognized: bare `http(s)://`/`mailto:` URLs and absolute Windows paths
      (regex over visible ranges, trailing prose punctuation trimmed), plus
      markdown link destinations via the syntax tree (relative @-mention links
      included; image URLs excluded). Holding Ctrl underlines targets + pointer
      cursor (window-level key listeners toggle `cm-ctrl` on the editor).
      Resolution in App's `openLink`: URLs → new Rust `open_external` (validated:
      http/https/mailto only); relative paths resolve against the note's dir; a
      path landing in the notes root or a linked project with a note extension
      opens **in-app** as a tab (`noteIdOf` inverse-maps abs path → id); other
      existing absolute paths open with their OS default app — **except
      executable types** (`EXEC_EXTS` in notes.rs: exe/bat/cmd/ps1/vbs/lnk/…),
      which are revealed in Explorer instead so note text can never launch a
      program. Deliberately not clickable: bare `note.md` names without a path
      (guessing is worse than nothing), `www.` without scheme, UNC paths.
      Failures are `console.error` only — flagged for the in-progress toasts
      sweep. Gates clean; pending hands-on check (underline-on-Ctrl feel, a URL,
      a relative md link to a note, an absolute path to a non-note file).
- [ ] **Toolbar tooltips + stroke icons** (2026-08-09) — feedback: native `title` hints
      too slow (~1–2 s, OS-fixed), symbolic glyphs (` ``` `, `❝`, color-emoji `🔗`)
      unclear, `<>` cramped. Candidate sheet → picked 300 ms custom tooltip + stroke
      icons. Implemented: shared `Tooltip.tsx` (one fixed-position div, delegated
      `data-tip` listener — fixed because `.fmt-inline` is a scroll container that
      would clip a CSS bubble); the six symbolic format buttons are now inline
      stroke-path SVGs (`currentColor`, letters stay letters); buttons keep
      `aria-label` since SVG buttons have no text content. Toolbar + preview eye
      converted; **other `title=` sites (tabs, explorer, status bar, search) still
      native** — mechanical follow-up: swap `title` → `data-tip` per site. Gates
      clean.
      **2026-08-14: the follow-up is done — no `title=` is left in `src/`.** All
      ~25 remaining sites (tabs + dirty dot + close/new, the rail, explorer bar
      and panel buttons, mount paths, both resize handles, search hits, status
      bar, menubar and window buttons, Settings' project row buttons, the diff
      lens, changes rows, toasts) now carry `data-tip`. Two limits the sweep
      exposed in `Tooltip.tsx`, both fixed because the long-text sites depend on
      them: the bubble was `white-space: nowrap` with no `max-width` (a search
      hit's tip is a whole line of note text, a mount's is a full path), so it
      now wraps inside `min(22rem, 90vw)` with `overflow-wrap: anywhere` — paths
      have no spaces to break at; and it was centered on the anchor with no
      clamping, so it ran off-screen at the window buttons and would have gone
      _below_ the window at the status bar. Placement now measures the bubble in
      a layout effect (before paint, so the corrected spot is the first one
      drawn), pulls it inside the horizontal edges, and flips it above an anchor
      with no room beneath. Every converted glyph-only button gained an
      `aria-label`, the same rule the toolbar's SVG buttons already follow — a
      `×` or `«` is not an accessible name. Gates clean; pending hands-on: hover
      a long search hit and a mount row, the far-right window buttons, and the
      status-bar readouts (the flip).
      2026-08-09 visual check done (summon + PrintWindow capture — the
      window sat behind another app, so screen capture alone showed the wrong thing):
      all six stroke icons render crisp and theme-correct in dark, chevrons have
      air, color-emoji link gone. Still pending hands-on: tooltip position/delay
      feel (needs a real hover) and light theme.

- [ ] **Plain-text note formats beyond .md** (2026-08-09) — agreed design (extension
      allowlist chosen over content-sniffing and over waiting for external-file
      mappings): md, txt, text, tex, log, csv, json, yaml, yml, ini, cfg, toml, xml.
      **2026-08-10: the two hardcoded lists this shipped with (`NOTE_EXTS` in `notes.rs`,
      `hasNoteExt` in `paths.ts`) are gone** — the allowlist is now the note-type
      registry's union of extensions, in `settings.json`, read by both sides from the one
      file, and "only `.md` gets markdown features" is now "each type declares its
      features". `.markdown` joined the set on the way through.
      All are listed, opened, searched, drafted, renamed; only `.md` gets markdown
      features (live styling, Ctrl+E preview, @-mentions, formatting, image paste) —
      others open as a bare text editor with those affordances hidden (toolbar,
      Format menu, preview eye/commands). Creation stays .md (capture untouched);
      non-md files arrive from disk, or via rename typing an allowlisted extension
      (renaming preserves a non-md extension; a rename crossing the md boundary
      rebuilds the editor so its extensions match). Display shows non-md extensions
      (`todo.txt`) since the UI only ever stripped `.md`. Gates all clean; pending
      hands-on check (open a .txt from an external project, confirm bare editor +
      hidden md chrome). Candidate for a decisions/ entry once eyeballed — it
      softens "markdown files are the store" to "plain text files are the store".
- [x] **Quality gates + smoke check of the uncommitted slice** (2026-08-09) — `npm run
build`, `npm run lint`, `cargo fmt --check`, `cargo clippy` all clean. App launches,
      summons on Ctrl+Alt+A, and paints the whole new chrome correctly: menubar with
      mnemonics, centered search pill showing the note name, shrinking tab
      strip, one-row toolbar with the preview eye pinned left, sectioned explorer
      (current project / Recent / Notes), status bar (Ln/Col, word count, latency 35 ms
      dev). Live preview renders sized headings, dim `##` markers, links, inline code,
      `•` bullets. Screenshot tooling note: capture window bounds via DWM
      `DWMWA_EXTENDED_FRAME_BOUNDS` (attr 9), **not** `GetWindowRect` — the latter
      includes Win11's ~7px invisible resize border, so a crop grabs pixels from the
      window behind and reads as a phantom overflow bug.
- [ ] **Hands-on check of today's work** — the items below still need a human at the
      keyboard (feel, dialogs, cancel keys); the smoke check above covers layout only.
      (a) `@`-mention dropdown: trigger at line
      start/after space, cancel keys (Esc/Backspace suppress, ←/→/space close), inserted
      relative links resolve from deep/external notes; (b) explorer third feedback round
      (chevrons, sectioned levels, lazy project trees, shallow-first startup list);
      (c) scan flow rooting a new project at `docs/`; (d) Settings ✎ change-folder;
      (e) tier-1 reflex pack: right-click menus (editor/tab/explorer), delete →
      recycle bin, Alt/mnemonic menubar, Ctrl+H/G, zoom, status bar; (f) titlebar
      search pill (click → mixed command/note palette, hides when narrow);
      (g) external-change detection: edit a note in another tool, refocus → clean
      buffer reloads in place; make it dirty first → Ctrl+S asks before overwriting.
- [ ] **Repoint existing linked projects at docs/** if wanted — the docs-root rule only
      applies to newly scanned projects; already-linked ones (e.g. this repo) keep their
      old root until changed via Settings ✎.
- [ ] **Titlebar rename affordance polish** — flip the name-edit pencil to lean the
      other way, and close the gap so the dotted underline runs continuously under
      both the note name and the pencil icon. 2026-08-08 implemented: pencil mirrored
      via `scaleX(-1)`; underline switched from `text-decoration` to a dotted
      `border-bottom` on `.title` so it spans name + pencil unbroken (hover still
      darkens both). Pending hands-on check.
- [ ] **Scan sheet note counts** — decide: should the scan sheet's note counts reflect
      the docs/ subtree instead of the whole repo? (The other half of this item — the
      cut-off "per-project settings somehow and…" spec — is now captured in the
      settings-rework item above.)

## Next

- [ ] **UI conventions review — conventions a text editor is expected to have** (2026-08-08) —
      backlog from a read-through of the whole UI layer. Deliberately **not** copied:
      line-number gutter and active-line highlight (code-editor furniture that works
      against a prose capture surface).

  _Tier 1 ("reflex pack") — implemented 2026-08-08 in one pass, pending hands-on check:_

  - **Context menus** on the editor (undo/redo, cut/copy/paste/select all,
    find/replace/go-to-line — same list as the new Edit menu), tabs (close / close
    others / close saved / close all, plus copy path / reveal / delete for saved
    notes), and explorer rows (open, new note here, rename, copy path, reveal,
    delete; unsaved drafts get discard-with-confirm instead). Generic
    `ContextMenu.tsx` reuses the menubar-dropdown look; cut/copy/paste go through
    the official `clipboard-manager` plugin (native Ctrl+X/C/V untouched).
  - **Delete note** — new Rust `delete_note`: **recycle bin** (`trash` crate),
    deliberately never a hard delete; the draft goes with it, the open tab closes,
    a native confirm runs first. Also reachable from File menu + Ctrl+K palette.
    `reveal_note` (opener plugin's `reveal_item_in_dir`) backs the Reveal entries.
  - **Real Edit menu** (undo/redo, clipboard, select all, find/replace/go-to-line);
    formatting moved to a new **Format** menu (mnemonic O, conventional placing).
  - **Ctrl+H** opens find/replace, **Ctrl+G** go-to-line (F3 keeps find-next).
    **Ctrl+Shift+K went back to delete-line** — decision: the muscle-memory
    reflex beats a rarely-chorded format; code block keeps toolbar/menu/palette.
  - **Zoom** — Ctrl+scroll / Ctrl+± / Ctrl+0 via `webview.setZoom` (0.5–3.0,
    persisted in localStorage, reapplied at startup); View menu entries; % readout
    in the status bar when ≠100.
  - **Status bar** — Ln/Col, selection size, word count, zoom, and the
    summon-latency readout's new home (the absolute-positioned corner badge is
    gone). Editor status flows through a subscription ref, not App state, so
    keystrokes don't re-render the whole tree.
  - **Keyboard menubar** — Alt toggles it (on keyup, Windows-style: any other key
    while Alt is held disarms, so Alt+Tab stays clean), Alt+F/E/O/V/H open menus by
    underlined mnemonic, arrows navigate across menus and items, Enter runs, Esc
    closes. AltGr excluded so accented-layout typing is unaffected.

  _Tier 2 — real features, need design:_

  - **Search across all notes** (Ctrl+Shift+F) — was the biggest capability
    gap (Ctrl+P fuzzy-matches _filenames_ only). Design agreed and implemented
    2026-08-09. **Engine: a plain Rust scan, no new dependencies** — chosen over
    the ripgrep crates (`grep-searcher`/`grep-regex`: real regex and speed on huge
    trees, but ~40 transitive crates and a slower cold build for power this corpus
    never needs) and over a persistent index (tantivy/SQLite FTS: rejected — derived
    state that must be reconciled against the other tools editing these files, which
    cuts against "markdown files are the contract", plus idle footprint). New
    `search_notes` reuses the exact corpus `list_notes` walks via a new `note_paths`
    helper — resolved once instead of per note, since `resolve_note` re-reads the
    external-project mapping on every call. Case-insensitive literal match, 500-hit
    cap, files >2 MB skipped, long lines windowed around the match (`excerpt`).
    **UI: a second view inside the explorer panel** (chosen over a palette mode: a
    one-line palette row can't show many matches per note). `src/Search.tsx` —
    debounced 180 ms, ≥2 chars, grouped by note, amber-highlighted matches, results
    strictly one line each with the full text in the tooltip. Two small buttons
    (▤ / ⌕) in the explorer header switch views; the tree keeps its expansion state
    (`hidden`, not unmounted). Ctrl+Shift+F, Ctrl+K "Search in notes", and View menu
    all reach it; new `EditorHandle.revealLine` does the jump-to-line.
    Verified live: query runs, counts/grouping/highlighting/one-line rows all
    correct ("recycle" → 2 results in 1 note). **Not yet eyeballed: click-a-hit →
    jump to the line** (the machine got busy mid-check). It relies on App's
    `docKey` effect running after Editor's — child-before-parent ordering, which
    holds in React 18, but it is reasoning, not an observation.
    Known limits, all deliberate: literal-only (no regex/whole-word/case toggles
    yet); a match late in a long line can sit past the ellipsis at narrow panel
    widths (the conventional behaviour — the panel is resizable and the tooltip
    has the text); a note with an unsaved draft opens from the draft, so a jump can
    land a few lines off until it's saved.
  - **External file-change detection** — implemented 2026-08-09, pending hands-on
    check. Focus-based re-sync (chosen over a filesystem watcher: no idle
    footprint, and the core flow is "other tool edits while the window is
    hidden"): new Rust `note_mtime`; the mtime seen at load is remembered per
    open note. On window focus (summon included) notes/drafts re-list and the
    open note re-stats — clean buffer + changed file reloads **in place**
    (`Editor.setDoc`: editor stays mounted, cursor kept, no dirty/draft side
    effects); dirty buffer keeps editing and Ctrl+S raises a native "changed on
    disk — overwrite?" confirm (the mtime is also re-checked at every save, so
    conflicts are caught even without a focus bounce). Known gaps: deletion on
    disk isn't announced — the named-draft orphan behavior covers it. Two narrow
    races found in a 2026-08-09 read-through, both one IPC round-trip wide, both
    unfixed (deliberate — the fix costs more than the exposure until proven
    otherwise): (1) `trackMtime` nulls `openMtimeRef` synchronously and fills it
    async, so a Ctrl+S landing in that gap skips the overwrite guard entirely;
    (2) the focus handler samples `dirtyRef` _before_ `await readNote`, so
    keystrokes typed during that await are clobbered by the in-place reload.
    Fix sketch if it ever bites: have both paths re-check the guard condition
    after the await, not before.
  - [ ] **Multi-cursor + column select** — `minimalSetup` omits `allowMultipleSelections`,
        `rectangularSelection`, `crosshairCursor`, so Alt+Click and Alt+Shift+drag do
        nothing. Ctrl+D works (via `searchKeymap`) but only ever yields one cursor, which
        is arguably worse than not having it.
  - [ ] **Tab drag-to-reorder + Ctrl+Shift+T** reopen last closed tab.
  - [ ] **Split view** — side-by-side notes, or edit ⇄ preview. Low rank: live preview in
        the buffer already covers most of the need.

  _Tier 3 — polish, mostly cheap:_

  - **Toasts** — implemented 2026-08-09, pending hands-on check. Every failure the
    app had was `console.error` only, i.e. invisible; all nine sites now raise a
    toast instead (move, image paste, image drop, scan, change-folder, rename
    collision, rename, delete, reveal) plus a tenth that was newly silent —
    a failed search scan, which otherwise read as "no results". Bottom-right
    stack above the status bar, newest at the bottom, click to dismiss, errors
    linger 6 s and info 3 s, oldest dropped past four so a failure loop can't
    build a wall. **A plain hook, not a context provider** (`useToasts` in
    `src/toasts.ts`, `ToastStack` in `src/Toast.tsx` — split so the `.tsx` file
    only exports a component, which is what react-refresh wants): every call
    site already lives in `App`, so a provider would have bought nothing but
    indirection. `errText` normalizes what a rejected Tauri command throws —
    those reject with a plain string, not an `Error`. `SearchView` takes the
    error callback through a ref rather than an effect dep, since App passes a
    fresh arrow each render and a dep would reset the debounce timer on
    unrelated re-renders. Gates all clean.
    **Not visually verified.** The only deterministic trigger is a rename
    collision, and driving that with synthetic keys risks a real rename of a
    real note if a keystroke drops (which happened once this session), so it
    was left for a human: rename any note to the name of another note in the
    same project — the guard fires before anything touches disk.
  - [ ] **Spellcheck — needs a real design; the one-line version is ruled out**
        (re-scoped 2026-08-14). The cheap take was `EditorView.contentAttributes
.of({ spellcheck: "true" })`, since the editor's content is
        contenteditable and the engine would then underline misspellings for
        free. **Dropped:** the suggestions that make it useful are only reachable
        through the engine's own context menu, and the editor's `contextmenu` is
        the app's Edit menu — with no API that exposes the suggestion list to
        page script, so they can't be folded into that menu either. Turning it on
        would ship squiggles nobody can act on. The escape hatch (a modifier
        letting the native menu through) was considered and rejected as a
        discoverability problem: an editing feature reachable only by a chord
        nobody is told about. So spellcheck becomes a real item when it's wanted:
        a bundled dictionary, a suggestion list the app owns, and its entries in
        the Edit menu — a day's work with a dictionary dependency and a licensing
        question of its own, not a one-liner. Parked at that size.
  - **Theme selector** (light/dark/system) — implemented 2026-08-10, pending hands-on
    check. `src/theme.ts` resolves the setting (system → `matchMedia`) and stamps the
    result as `data-theme` on the root element; `initTheme()` runs in `main.tsx`
    **before** `createRoot` so nothing ever paints in the wrong theme, and keeps
    following the OS while the setting stays "system". Stored in localStorage
    alongside zoom/explorer width — deliberately not a JSON settings file yet, since
    that file's format belongs to the settings-rework item above. The dark block in
    `App.css` changed from `@media (prefers-color-scheme: dark)` to
    `:root[data-theme="dark"]` with its rules left nested — a two-line diff instead of
    prefixing ~90 selectors; verified the build flattens the nesting to plain
    selectors, so there's no runtime dependency on nesting support.
    **The real payoff, now unblocked:** the twelve syntax colors in `livePreview.ts`
    went from fixed mid-lightness compromises to `var(--syn-*)`, defined per theme in
    `App.css` and tuned against the editor's own background rather than against
    white: eleven of twelve tokens clear 4.2:1 on both grounds, where the old single
    set had nine of twelve under 3.9:1 on light (the bleached look). UI is a
    segmented Light/Dark/System picker in a new Settings → Appearance section.
    Gates all clean.
    **Palette reviewed and approved 2026-08-10** via a before/after proof sheet —
    both grounds side by side with an old/new toggle, since the alternative was
    hunting for a code fence in the running app. One value is deliberately _not_ an
    improvement by the numbers: `--syn-marker` on dark went 4.76 → 4.14, because the
    `##`/`**`/`---` markers are meant to recede (and `.cm-syntax` dims them a further
    0.6 opacity on top). It's the first value to raise if they read faint at real
    size; on light it sits at 2.81, fine for a marker and not for anything you read.
    _Still unverified:_ the switch itself in a running app — the segmented control,
    the light↔dark flip, persistence across restart, and that nothing flashes the
    wrong theme at startup. The colors are settled; the mechanism isn't.
    Candidate for a decisions/ entry once that's confirmed: the "why" is that an
    explicit stamped attribute is what lets a `HighlightStyle` be theme-aware at all.
  - [ ] **Breadcrumb path** for deep external notes — the tab shows the basename only, so
        two `README` tabs are indistinguishable.
  - [ ] **Explorer**: F2 inline rename, drag notes between projects, filter box, keyboard
        tree navigation, reveal-active-note.
  - [ ] **Scrollbar search-match markers** + `highlightSelectionMatches`.

  Suggested next slice: search, external-change detection, toasts and the theme
  selector have all landed, and the remaining Tier 2 items (multi-cursor, tab
  reorder, split view) are optional polish. What's left in this list is genuinely
  small, with two corrections from 2026-08-14: the `title=` → `data-tip` sweep is
  finished, and spellcheck turned out _not_ to be a one-liner (see its entry). The
  next item with real leverage isn't in this list at all: it was the
  **project-model design doc**, which four separate items above were blocked behind —
  written 2026-08-10 as [docs/project-model.md](project-model.md), so the leverage now
  sits in the first slice of _implementing_ it (settings file + note-type registry are
  the natural first cut, since they unblock the rest).

- [ ] **Global hotkey summon + tray residency** (2026-08-06) — the defining feature. Close
      hides to tray instead of exiting; window pre-created and hidden; global hotkey toggles
      show/hide with focus in the editor; autostart at login. Official plugins:
      `global-shortcut`, `tray-icon`, `autostart`. Measure summon latency — it's the product's
      one number. 2026-08-07: implemented and verified in `tauri dev` — hidden-at-start
      window, global summon toggle (default; configurable later), tray with Open/Quit +
      left-click toggle, close-hides-to-tray, autostart enabled in release builds only.
      Measured summon→paint: **9 ms** (dev build). Remaining: hands-on feel check + a
      release-build latency number, then promote/close this item. 2026-08-08: hotkey
      switched Ctrl+Alt+Space → **Ctrl+Alt+A** (via Win+Alt+Space and Ctrl+Alt+N) —
      Claude's quick prompts took Ctrl+Alt+Space, Ctrl/Shift+Space steal editor
      completion chords, Win+Alt+Space was laggy under rapid toggling (shell
      intercepts Win), and N sat too far from the modifiers for one hand.
- [ ] **Quick-capture editor + notes root** (2026-08-06) — a minimal editor that writes one
      `.md` per note into a configurable notes folder. Capture must work before any
      organization exists. 2026-08-07 design agreed: CodeMirror 6 (markdown mode) as the
      editor; **shadow drafts** save model — every edit autosaves (debounced) to an
      app-data drafts folder, `Ctrl+S` writes the real `.md` into the notes root
      (default `Documents/asapnotes`) and clears the draft; on reopen, a leftover draft
      wins (crash recovery). In-app shortcuts: `Ctrl+N` new note, `Ctrl+S` save,
      `Ctrl+B`/`Ctrl+I` bold/italic, `Ctrl+K` switcher palette, `Esc` hide window.
      `Ctrl+T` reserved for tabs later; quick-switch lives in the palette instead.
      2026-08-07 implemented; automated end-to-end check passed: typed text autosaves to a
      shadow draft, `Ctrl+S` writes the derived-name `.md` to `Documents/asapnotes` and
      clears the draft. Remaining: hands-on feel check (palette/Esc verified in code but
      not visually), and one unexplained app exit (0xffffffff, not reproducible) to watch
      for. Polish candidate: empty untitled drafts accumulate in the drafts folder.
- [ ] **Ctrl+K command palette, phase 2** (2026-08-07) — grow the note switcher into a
      command palette (commands, then AI-assisted navigation/actions). Phase 1 ships as
      a fuzzy note switcher with the editor. 2026-08-07 implemented after looking at
      a unified search-and-commands Ctrl+K: **Ctrl+P** = a fuzzy
      note switcher (subsequence match with consecutive/word-start bonuses in
      `src/fuzzy.ts`, amber-highlighted matched chars); **Ctrl+K** = command palette —
      opens on the command list (New note first, then save/rename/preview/move-to-project/
      format/hide), recent notes below, typing fuzzy-searches both. Commands reuse the
      existing callbacks; `Palette.tsx` is now presentational + generic. 2026-08-07
      hands-on feedback round: arrow-key selection now auto-scrolls into view
      (scrollIntoView nearest; list resets to top on query change), and the panel was
      restyled Claude-floaty (narrower, 14px radius, border + deep shadow, blurred
      backdrop) with "Commands"/"Notes" section headers while the query is empty.
      2026-08-07 second feedback round: taller (74vh), footer hint bar below a divider
      (↑↓ / ↵ / Esc), and slim inset scrollbars — applied app-wide
      (::-webkit-scrollbar), not just in the palette. Remaining: hands-on check;
      AI-assisted actions still future.
      **2026-08-14: `>` narrows either palette to commands alone**, gates clean,
      pending hands-on. One optional `prefix` prop on `Palette` — `{ char, label,
items, placeholder, emptyText }` — so a query starting with the char swaps
      the list and matches on the rest; the component stays generic (it never
      names "commands"; the caller does). One rule in both modes: Ctrl+P is notes
      until you type `>`, Ctrl+K is both until you do. The footer gains a
      `>` commands hint while the prefix isn't already in use, since a prefix
      nobody can see is a prefix nobody uses. Rejected: lifting the query into
      `App` as controlled state — it would re-render the whole tree per keystroke,
      which this codebase avoids on purpose (editor status goes through a ref for
      the same reason). Pending hands-on: `>` in both palettes, the section
      headers with the prefix alone typed, and backspacing the `>` away.
- [ ] **Editor round 2: projects, preview, formatting, images** (2026-08-07) — agreed
      design, implemented pending hands-on check: folders-as-projects
      ([decision](decisions/2026-08-07-folders-are-projects.md)) with note ids as
      root-relative paths + titlebar project selector (moves note + draft);
      `Ctrl+E` full-toggle preview via markdown-it (relative images resolved through the
      asset protocol, scope `$DOCUMENT/asapnotes/assets/**`); "Aa" formatting dropdown
      (headings/bold/italic/code/lists/quote/link) sharing the keybind commands;
      paste/drag-drop images saved to `assets/` and linked relative to the note.
      Known gaps: preview toggle loses cursor position; CodeMirror syntax colors are
      light-theme-tuned; empty untitled drafts can accumulate.
      2026-08-07 titlebar redesign after hands-on feedback: note name top-left with the
      project selector inline beside it (wraps below when narrow; the name never gets
      squeezed), click name to rename — saved notes move via `move_note`, untitled
      drafts save under the typed name; "Inbox" renamed "No project"; "Aa" dropdown
      (which never closed on outside click) replaced by an "Aa"-toggled expandable
      toolbar row of grouped format buttons; keybind hints moved out of the bar into a
      "?" popover (closes on outside click / Esc). Pending hands-on check.
- [ ] **Live preview in the editor** (2026-08-07) — chosen over split view /
      click-to-edit: the edit surface itself renders markdown (sized headings, real
      bold/italic/strikethrough, `•` bullets, blockquote bar, code-block shading, inline
      images via the asset protocol) and raw syntax reveals on cursor lines
      (`src/livePreview.ts`, decoration-based). Editor base switched to GFM
      (`markdownLanguage`); editor font now proportional, code stays monospace. `Ctrl+E`
      markdown-it preview deliberately kept as full-render fallback (tables, final look) —
      candidate for removal once live preview proves out. Remaining: hands-on feel check;
      known gaps: tables/task-lists render as raw text, setext underlines leave a blank
      line when hidden. 2026-08-07 classic-shortcut pass after "Ctrl+Z broken" report:
      root cause was Ctrl+E unmounting the editor (undo history wiped every preview
      toggle) — editor now stays mounted and hides instead; added Ctrl+F find panel
      (@codemirror/search, Esc closes panel before window), Tab/Shift+Tab list indent,
      Ctrl+Shift+Z redo alias; toolbar buttons no longer steal editor focus
      (mousedown preventDefault). This also fixes the earlier "preview toggle loses
      cursor position" gap.
- [ ] **Branding → real assets** (2026-08-07) — `docs/branding.md` written: one-stroke
      A/N zigzag mark, niche (fast capture / AI-compatible / per-project agent context),
      competitor gaps. 2026-08-07: real assets done — master SVGs in `assets/` (bare mark
      light/dark + amber-on-dark-tile icon), full Tauri icon set regenerated from it,
      tray icon pinned explicitly in `lib.rs`, README header added; mark verified legible
      at 16px on light and dark strips (see branding.md "Assets" for the regen recipe).
      Live-verified in `tauri dev` via screenshots: new icon on the taskbar button and in
      the tray overflow flyout, mark legible at real tray size. 2026-08-07 logo redesign
      after feedback (monoline zigzag read too Sublime-Text): now a sharp-apex paper-white
      A + amber pencil as the N's final leg, shared ink outline instead of the dark tile
      (outline carries taskbar contrast). Chosen from proofed variants (shape × color
      matrix, light/dark × 16-32 px). `assets/mark.svg` replaces the light/dark pair,
      `icon.svg` reworked, full Tauri icon set regenerated, README header simplified,
      branding.md updated. 2026-08-07 second redesign round (feedback: A disliked, pencil
      too small, too bland): now a hand-drawn rounded wood-yellow A leaning 8° forward +
      full-anatomy amber pencil (pink eraser) — chosen from two proofed rounds of
      candidates (letterform variants, then lean/swoosh speed devices; swoosh rejected as
      busier). Masters, Tauri icons, and branding.md all regenerated/updated. Remaining:
      human eyeball in the real tray, then close.
- [ ] **Explorer side rail** (2026-08-07) — agreed design after weighing a titlebar-toggle
      overlay and a palette-only variant: permanent ~36px icon rail on the left
      toggling an explorer panel (`src/Explorer.tsx`) — Recent (top 5, notes+drafts
      merged by mtime) above a project tree (`<details>` groups, loose notes at root).
      2026-08-07 hands-on feedback round: the `▤` icon button replaced by the whole
      rail being the button (slim full-height strip, `›`/`‹` chevron, hover tint);
      push-vs-overlay is no longer window-width dependent — panel floats by default
      and a 📌 pin in its top corner docks it (pinned state in localStorage, restores
      open+docked on restart); floating panel closes on select / Esc / click-away;
      `Ctrl+Shift+E` toggles the explorer. Pending hands-on check. Open question
      raised: folders inside projects — backend lists exactly two levels today;
      belongs to the workspace/project-model design item below.
      2026-08-07 second feedback round: explorer is now drag-resizable on its right
      edge (width in localStorage, clamped 168–480px); rail widened to 1.2rem;
      Recent collapsed by default; the open note's project is hoisted to the top as
      its own section; projects render a nested folder tree (a `<details>`
      per subfolder) from the note paths the backend already returns.
      Text selection restyled to translucent brand amber (app-wide `::selection` +
      CodeMirror selection layer, both themes) — the unstyled default was OS-accent
      purple with unreadable contrast. Panelled chrome: candidate sheet
      (3 variants × light/dark) → **A picked**: menubar-dark chrome is the window
      ground (constant in both themes), explorer / titlebar+toolbar / editor float
      as three rounded panels with 6px gaps. Rail reworked with it: no more strip
      beside the open panel — collapsed, the whole slat is the expand button («/»
      centered); expanded, a « collapse button sits right of the pin in the
      explorer header. Implemented, pending hands-on check; candidate for a
      decisions/ entry once eyeballed.
      2026-08-08 third feedback round (thick expanders / Recent blends into the
      project / other projects too eager): native `<details>` markers replaced by
      slim CSS chevrons; top-level sections (current project / Recent /
      Notes) separated by hairline + gap so levels read distinctly; non-current
      projects now start collapsed and their tree only renders on first expand;
      startup paints from a shallow root-only `list_notes(deep:false)` with the
      deep external-project walk following right after (deferred-scan option chosen
      over frontend-only collapse and true scan-on-expand — keeps Ctrl+P palette
      and Recent covering everything). Pending hands-on check.
      2026-08-08 regression found & fixed: a draft restored (or clicked in Recent)
      before the deep walk landed was misclassified untitled — the shallow list
      misses external-project notes, so e.g. a linked CLAUDE.md opened nameless
      and Ctrl+S would have written a duplicate under a derived name. Fix:
      `draftName()` — a draft id names its note unless it's an app-generated
      `untitled-<ts>` id; list membership no longer decides. Deliberate side
      effect: an orphaned named draft (file deleted externally, e.g. the stray
      repo-root test.md) keeps its name and Ctrl+S recreates the file, instead
      of showing "untitled" and saving under a derived name.
- [ ] **Settings panel** (2026-08-07) — titlebar ⚙ button (right end, with the tool
      buttons) + Ctrl+K "Settings" / "Keyboard shortcuts" commands open a floating
      overlay (`src/Settings.tsx`, palette-style backdrop, Esc/click-away closes):
      keybinds as a real table (replaces the "?" popover, which was removed) + About
      (version via `getVersion()`, notes folder, summon latency, auto-update marked
      "planned" — the real work stays in the installer/auto-update item below).
      2026-08-07 feedback round: bigger ⚙ glyph; About moved above the shortcuts table;
      About credits row (Made by Anfifo · ☕ Buy me a coffee, amber-highlighted) opening
      externally via the new `tauri-plugin-opener` (+ `opener:default` grant); summon
      latency moved out of settings into an always-visible muted readout in the app's
      lower-right corner. Remaining: hands-on check.
- [ ] **Custom title bar with menus + scan-for-projects** (2026-08-07) — implemented,
      pending hands-on check. Window is now undecorated; an in-window menubar
      (`src/MenuBar.tsx`: File/Edit/View/Help, drag region, min/max/✕-hides-to-tray)
      replaces the native title bar, with Settings moved under File (⚙ button removed).
      File → "Scan folder for projects…" picks a folder, finds subfolders holding a
      README.md/index.md, and links the chosen ones in place as **external projects**
      ([decision](decisions/2026-08-07-external-projects-linked-in-place.md)) — notes
      listed recursively, edited where they live; mappings in app-data
      `external_projects.json`, removable in Settings ("Linked projects"). Known
      trade-offs: Win11 Snap Layouts hover is lost with the custom bar; move-to-project
      on a deep external note flattens it to the target's root; unlinking a project
      while one of its notes is open leaves that note resolving to the notes root on
      next save.
- [ ] **@-mention note links + docs-rooted external projects** (2026-08-08) — agreed
      design, implemented pending hands-on check. Typing `@` at a line start or after a
      space opens a small dropdown (CM `@codemirror/autocomplete` wired in
      `src/mentions.ts`, ranked by the palette's `fuzzy.ts`, styled as a lighter palette
      cousin): ↑↓ navigate, Enter/Tab accept, Esc/Backspace cancel-and-suppress (typing
      won't reopen until a fresh `@`), ←/→/space close. Accepting inserts a standard
      markdown link `[name](path)` **relative to the open note's real directory**
      (`relativePath` in `src/paths.ts`), computed across trees for external projects;
      falls back to the app's root-relative id when cross-drive; `<>`-wrapped when the
      path has spaces. Newly scanned external projects now root at the repo's `docs/`
      (else `documentation/`, else `docs/` is created) — `ensure_docs` in
      `add_external_projects`; existing mappings untouched; Settings → Linked projects
      gained a ✎ change-folder button (`set_external_path`). Known trade-offs: scan
      sheet still shows whole-repo note counts; repo-root README/CHANGELOG invisible
      once a project roots at docs/ (chosen deliberately).
- [ ] **Tabs + consolidated top bar** (2026-08-08) — agreed design (consolidated
      option chosen over tabs-above-existing-titlebar): tab strip under the menubar
      (dirty dot, ×, `+`; Ctrl+T new, Ctrl+W close, Ctrl+Tab cycle — Ctrl+T's
      reservation finally spent); the old titlebar collapsed into one slim
      always-visible bar (project selector, format buttons inline — the Aa toggle
      and expandable toolbar row are gone — preview eye right). Note name lives in
      the tab; rename = double-click the active tab. Tabs persist in localStorage
      (ids only — the active note loads at startup, others on click, so summon
      latency is untouched; a tab whose note vanished is dropped at restore).
      Implemented, pending hands-on check. 2026-08-08 feedback round (bar wrapped
      to two rows on small windows): the bar is now strictly one row — format
      buttons scroll sideways behind a 4px scrollbar instead of wrapping — the
      preview eye moved to the far left so it never scrolls away, and the
      titlebar project selector was removed (move-to-project lives in Ctrl+K;
      the "+ New project" input still appears in the bar when invoked).
      Follow-up idea from the same feedback: make the explorer's current-project
      header the project selector. Second feedback round: tab strip is now a
      darker band with the active tab filled in the panel color
      so tabs read distinctly from the toolbar row; and ```lang fences finally
      look highlighted — the nested parse always worked, but shell-ish modes
      tag bare commands as plain variableName which had no color, so the code
      palette in `livePreview.ts` gained variableName/operator/punctuation/
      meta/regexp entries. (Inline HTML outside fences colors by design —
      HTML is valid markdown.) Third feedback round: browser-like tab sizing —
      inactive tabs flex-shrink to a 2.6rem sliver before the strip ever pans,
      the active tab never shrinks, the strip's scrollbar is hidden (pans only
      when even minimums overflow) with the active tab kept in view via
      scrollIntoView; hairline separators between adjacent tabs, suppressed
      next to the active one.
- [ ] **Titlebar search pill (command center)** (2026-08-09) — requested: a clean
      search bar centered in the window's top bar mixing files and commands. Implemented same day, pending hands-on check: pill in the menubar's
      flex row flanked by two drag regions — first version absolute-centered and the
      menus overlapped it on narrow windows (feedback), so it now lives in the flow
      where crossing is impossible: it centers in the leftover space, gives up width
      first (label ellipsizes), the drag slivers keep a minimum grabbable width, and
      under 560px it hides entirely. Segoe Fluent search glyph + the open note's
      name as label (doubling as the window title the undecorated window lost);
      click opens the existing Ctrl+K palette, which already mixes commands and
      notes. Open question for the hands-on check: should the pill open with notes
      ranked above commands instead?

- [ ] **Prepare repo for going public** (2026-08-09) — audit everything committed for
      internal-only content before flipping visibility. Decided: docs stay in the
      repo, but "like <product>" comparisons get scrubbed. 2026-08-09 sweep done:
      **code comments cleaned** (~25 product references across `src/` +
      `src-tauri/` rewritten to describe the behavior itself, rationale kept;
      Segoe glyph names like `ChromeMinimize` kept — they're the API's own names).
      **Docs still pending a scrub decision**: ~44 references across
      `docs/TODO.md` (~30), `docs/branding.md` (9 — it's a competitor analysis
      _by design_, so scrubbing guts it: keep it out of the public repo, or accept
      it), `docs/decisions/` + READMEs (rest). **History**: every substantive
      commit carries these in docs, so scrubbing files can't clean it — publish a
      fresh-history repo (squash to one clean initial commit, full history stays
      on a private remote). Also: delete stray repo-root `test.md`.
      **2026-08-10: superseded by [`going-public.md`](going-public.md)** — the license
      decision, the docs-scrub counts, the `branding.md` call, the history question, the
      README rewrite and what publishing commits us to are all written up there with
      recommendations and an ordered checklist; the dev machinery that gates _accepting
      contributions_ (CI, tests, pinning, CONTRIBUTING) stays in
      [`dev-environment.md`](dev-environment.md). Delete this item once the license is
      picked and the doc's "before flipping the switch" list is done.
- [ ] **MCP sidecar** (2026-08-06) — TypeScript stdio MCP server in this repo exposing
      list/read/write/search over the notes root, so any MCP client can go over
      the notes. 2026-08-09 direction agreed: (a) **access scope as a setting** —
      which projects the MCP can see (default: notes root only; per-linked-project
      opt-in); (b) **token economy is structural, not a new serialization** —
      decided against a compact AI write/read format (markdown is already what
      LLMs handle best; stripping markers saves little and loses structure).
      Instead: outline/TOC-level listing, section-level reads ("give me
      `## Decisions` of note X"), section-targeted writes/appends (saves write
      tokens and avoids clobbering concurrent edits), search returning excerpts;
      (c) **teach the AI our docs pattern** — align the `docs/TODO.md` +
      `docs/decisions/` convention loosely with the ADR/MADR standards
      (Status / Context / Decision / Consequences fields, superseded-by links),
      and have the MCP surface the convention so agents can both navigate it
      (find the decision that answers "why is it like this?") and follow it
      (append TODO items, draft decision entries) in any project using the
      pattern. Next concrete step: short design doc for the tool surface.
      **2026-08-10: (a) is settled by [docs/project-model.md](project-model.md)** —
      the grant is `off` / `read` / `write` per project, stored in the **personal**
      app-data file and nowhere else, defaulting to `off` for anything linked from
      outside the notes root. That placement is the whole point of splitting config
      by trust: no file in any repository can widen the sidecar's reach. The
      sidecar also sees only what a project's file rules list, so exclusions are an
      access boundary, not just a display one. (b) and (c) still need the tool-surface
      doc.
      **2026-08-19: (b) and (c) are settled by
      [docs/mcp-tool-surface.md](mcp-tool-surface.md)** — the doc the "next concrete
      step" asked for, written before any code. The load-bearing picks, all
      recommendations: the sidecar is a TypeScript stdio server that **shells out to a
      Rust helper binary from the existing crate**, so the project model has exactly one
      implementation (a TS copy that drifts would be an access-boundary bug, not a
      display one) — rejected: direct filesystem access, and a loopback listener in the
      app; **(b) token economy** is an `outline` mode on the listing, **heading-path
      section addressing** on reads and writes, excerpt search that names the section a
      hit falls under, and an optional `expect_unchanged` mtime that makes a write
      refuse rather than clobber a concurrent human edit — with **no whole-file write
      tool** deliberately; **(c)** is a convention resource + prompts + two thin tools
      (`append_todo`, `new_decision`), with ADR/MADR alignment landing as the fields new
      entries get rather than a rewrite of the existing eight. Grants are enforced in the
      helper per call, re-read from disk, and `off` means the project **does not exist**
      to the sidecar (refusing by name would leak it). Attribution is the sidecar's own
      append-only tool-call log (writes only — a read log would be a surveillance record),
      which is what the change-log ask floated and carries more than an origin tag could.
      _What the doc says this costs first:_ the corpus functions take `AppHandle` for
      their two roots, so step 1 is extracting a plain-Rust core that takes explicit
      roots — with a `doctor` subcommand, because a helper resolving a different
      `settings.json` than the app would serve a different corpus and look fine.
      Build order and the four open questions (distribution, per-call grant reads,
      `files`-rule cost, multiple clients) are in the doc. No code yet.
- [ ] **Project model — implementation, step 6** (2026-08-10) — the design is
      [docs/project-model.md](project-model.md), promoted to
      [a project is a location plus mounts](decisions/2026-08-10-a-project-is-a-location-plus-mounts.md)
      and [config splits by trust](decisions/2026-08-10-config-splits-by-trust.md); the doc
      carries the order and the cost-to-existing-code list. **Steps 1–2 landed 2026-08-10**
      (see the settings-rework item above), **steps 3–5 on 2026-08-11** (below).
      Remaining: **(6) consumers** — the MCP grant and `board.canvas`, each its own
      item.

  **2026-08-11 — step 3 landed: projects as location.** Both halves, pending hands-on check.
  **Creation is now its own thing**: a sheet (`src/NewProject.tsx`) asking name + where it
  lives — _Notes folder_ or _A folder on disk…_ — with a **"use the repository's `docs/`"**
  checkbox that appears, checked, when the picked folder holds `.git` (new `folder_info`
  command; the frontend can't stat that itself), and a live path readout so the choice is
  answered by a path rather than a label. New `create_project` covers both locations: a
  notes-folder project is a folder and gets **no registry entry** (existence stays
  filesystem-derived), a picked folder is a folder plus an entry.
  **Creating and filing are now separate** (chosen over keeping them coupled or offering a
  "move the open note here" checkbox): the old "New project…" was a name box that _moved the
  open note_ into a folder `move_note` created on the way past — so the explorer's "New
  project" quietly relocated whatever was open. Filing a note is "Move to project" in the
  palette, which already existed. The old toolbar input and its CSS are gone.
  **The unify half**: `add_external_projects`/`set_external_path`/`remove_external_project`
  → `link_projects`/`set_project_path`/`unlink_project`; frontend `externals` →
  `projectPaths`; Settings' "Linked projects" is one **Projects** table listing every
  project, where the location ("In the notes folder" vs. a path) is the only thing telling
  them apart, and ✎/✕ show only where there's a folder to repoint or forget.
  `validFileName`/`validProjectName` moved to `paths.ts` on their second use.
  **One hazard closed on the way** (not in the step's scope, but the picker put it one click
  away): a project location _inside_ the notes root gave every file below it two ids — root
  walk and project — hence two shadow drafts and two tabs that overwrite each other.
  `outside_root` refuses it at creation and at repoint. Latent before via a scan of the
  notes folder; the same class of bug the doc's cost list flags for mounts.
  Gates all clean. Pending hands-on: create in the notes folder, create from a picked repo
  (docs checkbox), the refusal message when picking inside the notes root, Settings'
  Projects table in both themes.

  **2026-08-11 — step 4 landed: mounts.** Resolution both ways, the walks, the explorer, and
  the context-menu entry, all pending hands-on check. Right-click a project or folder heading
  → **"Add virtual folder…"** picks a folder and attaches it under its own name (nested
  headings give a nested `at`, as designed); the mount root shows a link glyph and its real
  path, its subtree a tint, and the same menu detaches it again. New `add_mount` /
  `remove_mount` / `list_mounts`.
  **Resolution:** `base_of` gained the doc's rule — the deepest mount point prefixing an id
  wins, then the project's own location, then the notes root — and `noteIdOf` inverts the
  same table, longest base first. `list_notes` and `search_notes` walk one shared
  `outside_roots` list (linked projects _and_ mounts), so a mounted note can't be listed and
  openable yet unsearchable. `assets_dir_for` now takes the note id, and the frontend's four
  base-directory computations became one `baseOf`, which is what let `assetLink` stop
  counting `../` levels.
  **Three guards, all at creation where the reason can be explained:** mount paths must be
  disjoint from the notes root, every project location and every other mount (`outside_root`
  generalized to `disjoint` + `check_location` — which also caught a case step 3 missed, a
  location _containing_ the notes root); mount points may not nest inside each other; `at` is
  capped at four segments because `MAX_DEPTH` counts id segments. A real folder appearing at
  a mount's name wins over the mount everywhere — resolution, listing, search — and the row
  says so.
  Also on the way: `move_note` falls back to copy-then-delete when `fs::rename` fails across
  volumes, and every walk now starts at the depth its id prefix already spent (before, a file
  twelve levels inside a linked project was listed with an id `checked_name` then refused).
  Gates all clean. Pending hands-on: attach a folder to a project and open a note in it,
  paste an image into that note (it should land in the mount's own `assets/`), search for
  text only present there, Ctrl+Click a link into it, then detach. Known trades: detaching
  orphans drafts filed under its ids; Settings' Projects table doesn't list mounts.

  **2026-08-11 — step 5 landed: `files` patterns.** The portable
  `<project>/.asapnotes.json` is now read (never written): `files` is one ordered
  list in `.gitignore` syntax, relative to the project's location, last match wins —
  a bare pattern excludes, `!` re-includes and waives the type allowlist. Every
  consumer reads it the same way: listing, search, scan-sheet counts (which now
  honor a candidate's own config), **and the id checks** — a re-included `.rs` has
  to be openable, savable and draftable, not just listed, so `checked_name` learned
  the rule too. A mount matches at `<at>/rest` (a mount is not a way around the
  project's exclusions). **Engine: the gitignore matcher from the `ignore` crate**,
  chosen over hand-rolling because the promise to the user is gitignore syntax and
  anchoring/negation corners are exactly where a subset would quietly diverge —
  ~5 small new crates, most of the tree was already in the lock. Matching is
  case-insensitive, like the app's other path handling. **The floor:** a pattern
  never re-includes an executable type (`EXEC_EXTS`) or a file over the 2 MB search
  cap, checked at the walk and at the id check both. A `!`-matched folder is
  descended even if it's in `SKIP_DIRS` (notes genuinely living in `build/`);
  nothing resurrects below a pattern-pruned folder, as in gitignore; dot-folders
  stay out because ids can't express them. **Failure mode:** a broken file falls
  back to default rules (one typo can't blank a project), one bad glob line is
  skipped and reported rather than dropping the list, and a new
  `project_config_errors` command is polled on window focus and toasted — the walk
  itself must not fail, so the error travels out of band. Also the repo's **first
  unit tests** (`project_config.rs`, the verdict semantics). Known gaps, deliberate:
  `list_drafts` keeps default rules, so a draft of a re-included non-allowlist file
  isn't in Recent (its tab and direct reads work); the frontend's `isNoteFile`
  doesn't know patterns, so Ctrl+Clicking an absolute path to a re-included file
  opens it externally instead of in-app; no UI writes the file — it's hand-edit
  only until the settings rework picks it up. Gates all clean, `cargo test` green.
  Pending hands-on: drop an `.asapnotes.json` with `["archive/**", "!src/**/*.rs"]`
  into a linked repo, refocus — excluded notes vanish, `.rs` files appear and open
  in the bare text editor; search text inside a re-included file; break the JSON
  and watch for the toast on next focus.

## Pending / future direction

- [ ] **Project layers — sections a project belongs to** (2026-08-19) — raised while the
      MCP sidecar was being built, and deliberately parked: some projects belong together
      in a section and others do not, so a layer would be a named grouping over projects
      rather than a folder. Nothing designed and nothing started. The reason it is worth
      writing down now is that two surfaces would consume it the moment it exists — the
      explorer (grouping the project headings) and the **MCP grant**, where a layer is the
      obvious unit to grant access to instead of naming projects one at a time, and where
      it would also be the natural scope for the write pin (`writeScope: "layer"` beside
      today's `current`). Open before any code: whether a project can be in more than one
      layer, whether layers nest, where they live (`settings.json` names machine paths and
      grants, so probably there), and what a layer means to the corpus walks — a display
      grouping, or something id resolution knows about. Treat the last one as the hinge:
      display-only is cheap and reversible, id-bearing is not.

- [ ] **Cloud share + live collaboration** on a group of notes — direction, not scheduled.
      Keep storage decisions compatible: files stay primary, sync layers on top.
      2026-08-09 sketch: host under **asapnotes.anfifo.com** (subdomain of the
      existing site). Phase 1 = end-to-end-encrypted file share (encrypt client-side;
      key travels in the URL fragment so the server never sees it); phase 2 = sync,
      noting E2EE sync is a much harder problem (conflict resolution over content the
      server can't read). Syncing an existing project requires **explicit per-project
      opt-in** — nothing leaves the machine by default. File-size limits from day one.
- [ ] **Windows installer — double-click install for non-technical users** (2026-08-09):
      `tauri build` already emits an NSIS `…-setup.exe`; the work is making it
      genuinely noob-proof. (a) **Per-user NSIS install** — no admin prompt,
      lands in `%LOCALAPPDATA%`, standard uninstall entry in "Installed apps";
      (b) **autostart on by default** — already implemented (`tauri-plugin-autostart`
      enabled in release builds, registry Run entry, app starts hidden at login);
      keep that default, expose an off-switch in Settings; (c) **uninstaller must
      remove the Run entry** — the plugin writes it at runtime, outside the
      installer manifest, so plain uninstall leaves a dangling autostart (NSIS
      uninstall hook); (d) **code signing** — unsigned setup.exe hits the
      SmartScreen "unrecognized app" wall; plan: Azure Trusted Signing (~$10/mo,
      Tauri bundler integrates). Later, same track: `tauri-plugin-updater`
      auto-update (static JSON manifest + installer — could live on
      asapnotes.anfifo.com), GitHub Releases + winget as channels. Other
      platforms (and mobile) after Windows is solid. The settings About section
      already shows auto-update as "planned". Update _policy_ — the consent
      model, the settings, the 7-day prompt — is its own item below.
- [ ] **Update settings + no-unrequested-network policy** (2026-08-09) — the app
      must never open a connection the user didn't ask for: no telemetry, no
      analytics, no silent phone-home, no update ping before consent. Open-source
      and down-to-earth is the product stance, and an always-resident tray app is
      exactly where users are right to be suspicious. Settings gains an **Updates**
      section: (a) **"Check for updates" button** — connects only on click, always
      available, the escape hatch that makes every other default safe to leave off;
      (b) **auto-update toggle** — when on, checks on a throttle (proposal: at most
      once every 7 days, never per-launch) and never installs without asking;
      (c) **one-time consent prompt ~7 days after install** — deliberately _not_ at
      first run (that's install-ceremony noise nobody reads, and consent given to
      dismiss a dialog isn't consent): after a week of real use, ask once whether to
      enable update checks, remember the answer, never ask again. Until answered,
      the state is off — zero connections. **Ambiguity flagged from the 2026-08-09
      request:** "7 days after the installer" was read as the deferred consent prompt
      in (c); it could instead have meant the throttle interval in (b) — both are
      written down, confirm which was meant (they compose fine, so possibly both).
      Related open question: does the update check hit asapnotes.anfifo.com or
      GitHub Releases directly — the latter means no server of ours ever sees a
      user's IP, which fits the stance better.
