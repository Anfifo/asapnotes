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
      project+folder headings (new note here / copy path); row menus' "New note
      here" now triggers inline creation next to that note. `openContextMenu`
      stops propagation so nested targets resolve innermost-first. Deliberately
      deferred: project rename (needs folder-move backend), Reveal on
      directories (`reveal_note` only resolves note ids), collapse-all (nested
      folder `<details>` are uncontrolled). Known wrinkle: a folder auto-opened
      to host the create row closes again after creation (React drops the
      forced `open` attr) — reveal-active-note (Tier 3) is the real fix.
- [ ] **Per-project file config ("virtual folders") + new-project location**
      (2026-08-09) — decided: **design-doc only for now**, folded into the
      workspace/project-model design item below; no code yet (it shapes sync
      and MCP scope). The idea: (a) creating a project asks where it lives
      (notes root vs. picked directory — today silently a root subfolder,
      external only via scan); (b) projects get a config of which files are
      in/out — a virtual grouping so notes can attach to a project **without
      living in its repository**. Payoff: team-syncable project notes that
      never enter the repo (pairs with the cloud-sync direction). Likely the
      continuation of the cut-off "per-project settings somehow and…" thought.
      2026-08-09 addition: the explorer should **color these virtual entries
      differently** — files/folders shown under a project but not physically
      living in its tree must read distinctly from what's really there.

- [ ] **Settings rework: menubar entry, theme, file-type config, per-project config**
      (2026-08-09) — captured design intent, needs design before code. (a) **Settings
      moves to the top**: its own menubar entry; Help probably stops being a top-level
      menu and folds into Settings. (b) **Theme selector** (light/dark) lives here —
      this is the home for the Tier 3 theme-selector item. (c) **App-level file-type
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
      the same file; design them together.
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
      Lucide-style SVGs (`currentColor`, letters stay letters); buttons keep
      `aria-label` since SVG buttons have no text content. Toolbar + preview eye
      converted; **other `title=` sites (tabs, explorer, status bar, search) still
      native** — mechanical follow-up: swap `title` → `data-tip` per site. Gates
      clean. 2026-08-09 visual check done (summon + PrintWindow capture — the
      window sat behind VS Code, so screen capture alone showed the wrong thing):
      all six stroke icons render crisp and theme-correct in dark, chevrons have
      air, color-emoji link gone. Still pending hands-on: tooltip position/delay
      feel (needs a real hover) and light theme.

- [ ] **Plain-text note formats beyond .md** (2026-08-09) — agreed design (extension
      allowlist chosen over content-sniffing and over waiting for external-file
      mappings): `NOTE_EXTS` in `notes.rs` / `hasNoteExt` in `paths.ts` (kept in
      sync) — md, txt, text, tex, log, csv, json, yaml, yml, ini, cfg, toml, xml.
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
- [ ] **Scan sheet note counts** — decide: should the scan sheet's note counts reflect
      the docs/ subtree instead of the whole repo? (The other half of this item — the
      cut-off "per-project settings somehow and…" spec — is now captured in the
      settings-rework item above.)

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

  Suggested next slice: search, external-change detection and toasts have all
  landed, and the remaining Tier 2 items (multi-cursor, tab reorder, split view)
  are optional polish. The best-value item left is Tier 3's **theme selector** —
  it isn't only preference: the note atop `livePreview.ts` explains every syntax
  colour had to sit at mid-lightness because a `HighlightStyle` can't follow a
  media query, so a theme class on the root is what unblocks properly tuned
  colours in both themes.

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
- [ ] **Workspace/project model — design doc first** (2026-08-06) — grouping levels user →
      project → notes (Postman-like), including _mappings_ to files that live outside the
      notes root (VS Code-like "open anything"). Shapes storage and future cloud sync — design
      before code. 2026-08-09: scope grew to cover **per-project file config /
      "virtual folders"** and the new-project location question (see the Today
      item) — decided design-doc-first there too. See
      [decisions/2026-08-06-markdown-files-are-the-store.md](decisions/2026-08-06-markdown-files-are-the-store.md).

## Pending / future direction

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
      already shows auto-update as "planned". Update *policy* — the consent
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
      (c) **one-time consent prompt ~7 days after install** — deliberately *not* at
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
