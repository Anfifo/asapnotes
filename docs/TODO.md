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
      a fuzzy note switcher with the editor.
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
      the tray overflow flyout, mark legible at real tray size. Remaining: human eyeball + decide whether the tile/amber icon design deserves a decisions/ entry, then close.
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
      solid.
