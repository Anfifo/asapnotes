# asapnotes — the mark

_2026-08-07. The mark, how it is built, and how the icons are regenerated from it._

## The mark

**Concept: a hand-scribbled A + the pencil that wrote it.** A rounded monoline **A**
in warm wood-yellow — bowed legs, arched crossbar overshooting both legs, drawn loose
like quick pen strokes — leaning 8° forward, with a full-anatomy pencil in the app's
amber (rubber-pink eraser, ink ferrule, facet shade, wood tip) resting tip-down at the
A's right foot. Both shapes share one ink outline, which is what keeps the mark
readable on any background without a tile behind it.

Why this construction:

- **Letter + tool tells the whole product**: the A is the note, the pencil is capture.
- **Fast is drawn in, not bolted on.** The forward lean plus the loose, overshooting
  strokes say "scribbled in a hurry" — the ASAP — without adding motion-line clutter.
- **Warm fills carry the mark.** Wood-yellow A + amber pencil read as one warm family;
  no white hollow (a swoosh-underline variant and a lean+swoosh variant were proofed
  and rejected as busier without adding much).
- **Scales to 16 px.** The A-plus-diagonal silhouette survives a tray render; pencil
  details (eraser, ferrule, wood, lead) are garnish that can vanish at small sizes.
- **Outline instead of tile.** The ink edge guarantees contrast on light and dark
  taskbars, so one file serves every theme — no variants, no fake background.

Palette: amber `#d99a06`, wood `#f2c14e`, ink outline `#23272f`, paper `#f6f6f6` (app
surfaces), plus rubber pink `#e8917c` used only for the pencil's eraser.

Guidelines (keep it boring): always the full lockup — outlined A plus pencil; don't
straighten the lean, don't recolor the pencil, don't drop the outline, don't put it
on a tile. Wordmark is lowercase `asapnotes`, one word.

The geometry is hand-tuned curves living directly in `mark.svg` (A as two stroked
paths under a skew, pencil as a rotated group); `icon.svg` embeds the same geometry
with thicker outlines. Edit `mark.svg`, then mirror the change into `icon.svg`.

### Assets (2026-08-07)

Master files live in [`assets/`](../assets/):

- `mark.svg` — the mark, theme-proof (works on light and dark). Used as the README
  header directly; replaced the old `mark-light.svg`/`mark-dark.svg` pair.
- `icon.svg` — app/tray icon: same mark centered on a square transparent canvas with
  thicker outlines (A halo 6 vs 4 units, pencil stroke 10 vs 6) so the edge survives a
  16 px tray render.

`src-tauri/icons/*` is generated from `icon.svg`: rasterize to 1024 px PNG (headless Edge
works: `msedge --headless --screenshot --window-size=1024,1024
--default-background-color=00000000 <icon.svg>`), then `npm.cmd run tauri icon <png>`
(delete the `android/`/`ios/` output — no mobile targets). The tray pins
`icons/32x32.png` explicitly in `src-tauri/src/lib.rs`.
