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

## Next

- [ ] **Global hotkey summon + tray residency** (2026-08-06) — the defining feature. Close
      hides to tray instead of exiting; window pre-created and hidden; global hotkey toggles
      show/hide with focus in the editor; autostart at login. Official plugins:
      `global-shortcut`, `tray-icon`, `autostart`. Measure summon latency — it's the product's
      one number. 2026-08-07: implemented and verified in `tauri dev` — hidden-at-start
      window, Ctrl+Alt+Space toggle (default; configurable later), tray with Open/Quit +
      left-click toggle, close-hides-to-tray, autostart enabled in release builds only.
      Measured summon→paint: **9 ms** (dev build). Remaining: hands-on feel check + a
      release-build latency number, then promote/close this item.
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
