# Controls are stroke glyphs, and the app owns right-click

- Date: 2026-09-04
- Status: Built (every symbolic control in the window; the Recent panel removed with it)

## Context

The window's small controls had grown one at a time, and each had been drawn with whatever
character was at hand: box-drawing and math symbols for the explorer's view switcher, a
colour emoji under a grayscale filter for the pin, guillemets for collapse, an icon-font
codepoint for the search pill's magnifier, and ×, +, ‹, ›, ↺, ✓ and ● everywhere else. A
text character renders at the font's size and weight, so six of them in a row never lined
up, the emoji ignored the theme, and the icon-font glyph sat next to a microphone that was
already a stroke path. The file-type icons had shown the alternative since 2026-08-24: an
inlined path takes the button's ink, its own size, and the theme for free.

Right-click had the same unevenness. Rows, headings, tabs and the editor raised their own
menus; everywhere else the webview's page menu appeared, offering Back, Reload and Inspect
in a notes app.

## Decision

**Every symbolic control is an inline stroke path from one set.** `src/icons.tsx` holds the
glyphs (the same open icon set the file-type icons credit, with its licence), and a control
renders `<Icon name=…>` sized by its own CSS. This covers the explorer bar, the hover
buttons on headings, the tab strip's close and new buttons and the lens tab's marker, the
menubar search pill, the settings reset and disclosure, the changes views' chevrons and
checks, the map's zoom and close buttons, and the collapsed-explorer rail. The unsaved
marker is a drawn dot rather than a character, so it is the same size on a tab and on a
row. Words stay words ("Fit", "MAP", "Open note ›"), key hints stay key labels, the
toolbar's H1/B/I stay letters, and the window's caption buttons keep the system's own icon
font because they imitate the system's own buttons.

**The explorer bar is grouped by kind.** Six 22px squares with 16px glyphs at a 4px gap; a
hairline seam separates the views (files, search, changes) from the actions (new, pin,
collapse); the open view takes the accent amber the MAP chip already wears; the pin tilts
while the panel floats and stands upright when docked. A segmented switcher for the views
was drawn and not picked — a second surface inside the bar reads heavier than the rest of
the panel chrome.

**The app owns right-click.** A surface with a menu of its own raises it; the explorer bar
raises the panel body's menu, since it has no rows of its own; text fields (inputs,
textareas, the editor's contenteditable) keep the native cut/copy/paste; everywhere else a
document-level handler swallows the event. Known cost, accepted: the preview and lens panes
lose the native Copy item — Ctrl+C still works there.

**The Recent panel is gone.** It duplicated the welcome panel's recent list and only took
column height between the current project and Notes; its View-menu toggle and the persisted
`hideRecent` flag went with it, and settings files that still carry the key load unchanged.

## Links

- Key files: [`src/icons.tsx`](../../src/icons.tsx) (the glyph set),
  [`src/fileIcons.tsx`](../../src/fileIcons.tsx) (the file-type set that set the pattern),
  [`src/Explorer.tsx`](../../src/Explorer.tsx) (the bar).
- The right-click handler lives beside the other document-level effects in
  [`src/App.tsx`](../../src/App.tsx).
