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

## Today (2026-08-09)

- [x] **Quality gates + smoke check of the uncommitted slice** (2026-08-09) — `npm run
build`, `npm run lint`, `cargo fmt --check`, `cargo clippy` all clean. App launches,
      summons on Ctrl+Alt+A, and paints the whole new chrome correctly: menubar with
      mnemonics, centered search pill showing the note name, Chrome-style shrinking tab
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
- [ ] **Finish the per-project settings thought** — the spec for "configurable in the
      settings for each project somehow **and** …" was cut off mid-sentence during
      design; whatever followed the "and" is still unstated. Also decide: should the
      scan sheet's note counts reflect the docs/ subtree instead of the whole repo?

## Next

- [ ] **UI conventions review — what VSCode/Notepad have and we don't** (2026-08-08) —
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
    formatting moved to a new **Format** menu (mnemonic O, Notepad-style).
  - **Ctrl+H** opens find/replace, **Ctrl+G** go-to-line (F3 keeps find-next).
    **Ctrl+Shift+K went back to VSCode's delete-line** — decision: the muscle-memory
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

  - **Search across all notes** (VSCode Ctrl+Shift+F) — was the biggest capability
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
    widths (VSCode has the same behavior — the panel is resizable and the tooltip
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

  - [ ] **Toasts** — failed moves, rename collisions, failed image pastes and scans are all
        `console.error` only today, i.e. invisible. One toast surface fixes all of them.
  - [ ] **Spellcheck** — Win11 Notepad has it; CM's content is contenteditable, so
        `EditorView.contentAttributes.of({ spellcheck: "true" })` gets native squiggles.
  - [ ] **Theme selector** (light/dark/system) instead of `prefers-color-scheme` only.
        Real payoff beyond preference: the note at the top of `livePreview.ts` explains
        every syntax color had to sit at mid-lightness because a `HighlightStyle` can't
        follow a media query — a theme class on the root removes that constraint and lets
        both themes get properly tuned colors.
  - [ ] **Breadcrumb path** for deep external notes — the tab shows the basename only, so
        two `README` tabs are indistinguishable.
  - [ ] **Explorer**: F2 inline rename, drag notes between projects, filter box, keyboard
        tree navigation, reveal-active-note.
  - [ ] **Scrollbar search-match markers** + `highlightSelectionMatches`.
  - [ ] **Ctrl+Shift+P palette alias** + `>` prefix support in Ctrl+P (VSCode muscle memory).

  Suggested next slice: both of the above have landed — the remaining Tier 2
  items (multi-cursor, tab reorder, split view) are all optional polish, so the
  next real slice is Tier 3's **toasts**: failed moves, rename collisions,
  failed image pastes and scans are `console.error` only today, and search now
  adds another silent failure path.

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
      a fuzzy note switcher with the editor. 2026-08-07 implemented after looking at the
      Claude app's Ctrl+K (unified search + commands): **Ctrl+P** = VS Code-style fuzzy
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
      (↑↓ / ↵ / Esc, Claude-style), and slim inset scrollbars — applied app-wide
      (::-webkit-scrollbar), not just in the palette. Remaining: hands-on check;
      AI-assisted actions still future.
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
- [ ] **Obsidian-style live preview in the editor** (2026-08-07) — chosen over split view /
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
      overlay and a palette-only variant: permanent ~36px icon rail on the left (VS Code
      style) toggling an explorer panel (`src/Explorer.tsx`) — Recent (top 5, notes+drafts
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
      its own section; projects render a nested folder tree (VSCode-style
      `<details>` per subfolder) from the note paths the backend already returns.
      Text selection restyled to translucent brand amber (app-wide `::selection` +
      CodeMirror selection layer, both themes) — the unstyled default was OS-accent
      purple with unreadable contrast. VSCode-style paneling: candidate sheet
      (3 variants × light/dark) → **A picked**: menubar-dark chrome is the window
      ground (constant in both themes), explorer / titlebar+toolbar / editor float
      as three rounded panels with 6px gaps. Rail reworked with it: no more strip
      beside the open panel — collapsed, the whole slat is the expand button («/»
      centered); expanded, a « collapse button sits right of the pin in the
      explorer header. Implemented, pending hands-on check; candidate for a
      decisions/ entry once eyeballed.
      2026-08-08 third feedback round (thick expanders / Recent blends into the
      project / other projects too eager): native `<details>` markers replaced by
      slim VSCode-style CSS chevrons; top-level sections (current project / Recent /
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
      pending hands-on check. Window is now undecorated; a VSCode-style menubar
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
      darker band with the active tab filled in the panel color (VSCode-style)
      so tabs read distinctly from the toolbar row; and ```lang fences finally
      look highlighted — the nested parse always worked, but shell-ish modes
      tag bare commands as plain variableName which had no color, so the code
      palette in `livePreview.ts` gained variableName/operator/punctuation/
      meta/regexp entries. (Inline HTML outside fences colors by design —
      HTML is valid markdown.) Third feedback round: Chrome-style tab sizing —
      inactive tabs flex-shrink to a 2.6rem sliver before the strip ever pans,
      the active tab never shrinks, the strip's scrollbar is hidden (pans only
      when even minimums overflow) with the active tab kept in view via
      scrollIntoView; hairline separators between adjacent tabs, suppressed
      next to the active one.
- [ ] **Titlebar search pill (command center)** (2026-08-09) — requested: a clean
      VSCode-style search bar centered in the window's top bar mixing files and
      commands. Implemented same day, pending hands-on check: pill in the menubar's
      flex row flanked by two drag regions — first version absolute-centered and the
      menus overlapped it on narrow windows (feedback), so it now lives in the flow
      where crossing is impossible: it centers in the leftover space, gives up width
      first (label ellipsizes), the drag slivers keep a minimum grabbable width, and
      under 560px it hides entirely. Segoe Fluent search glyph + the open note's
      name as label (doubling as the window title the undecorated window lost);
      click opens the existing Ctrl+K palette, which already mixes commands and
      notes. Open question for the hands-on check: should the pill open with notes
      ranked above commands instead?

- [ ] **MCP sidecar** (2026-08-06) — TypeScript stdio MCP server in this repo exposing
      list/read/write/search over the notes root, so Claude (or any MCP client) can go over
      the notes.
- [ ] **Workspace/project model — design doc first** (2026-08-06) — grouping levels user →
      project → notes (Postman-like), including _mappings_ to files that live outside the
      notes root (VS Code-like "open anything"). Shapes storage and future cloud sync — design
      before code. See
      [decisions/2026-08-06-markdown-files-are-the-store.md](decisions/2026-08-06-markdown-files-are-the-store.md).

## Pending / future direction

- [ ] **Cloud share + live collaboration** on a group of notes — direction, not scheduled.
      Keep storage decisions compatible: files stay primary, sync layers on top.
- [ ] **Installer polish + auto-update**; other platforms (and mobile) after Windows is
      solid. The settings About section already shows auto-update as "planned".
