# The map is a graph view, not a canvas

- Date: 2026-08-25
- Status: Built (three layouts, details on click; the canvas engine removed)

## Context

The canvas arrived in three steps over 2026-08-14–16 — a project board, a freeform canvas of
text and image nodes, and ink — and then the project surface was re-designed around one
sentence: _the goal is to view the project connections_. The map that answered it was a
computed, read-only lens rendered through the canvas engine with editing disabled, and its
file format was JSONCanvas. Ten days later nobody had used the freeform canvas, the ink or
the image annotation built on it by hand, and every change to the map had been threaded
through `readOnly` gates in a 2,259-line editing engine. The format was the quieter
constraint: JSONCanvas nodes are axis-aligned rectangles, so every note was a card, cards
forced a grid, and the grid meant a project never fit on one screen.

## Decision

**Remove the canvas whole, and build the map as its own view.** `src/canvas/` (the engine,
the JSONCanvas layer, ink, the annotation lens), the corpus core's `canvas.rs`, the
`read_canvas` / `write_canvas` MCP tools, the `canvas` note type and everything hung on it
(launch-onto-a-canvas, Export-as-canvas, "New canvas", the `annotate:` tab) are gone.
**Image annotation went with it**, deliberately: it was its own ask, but it was never used,
and keeping it would have meant keeping an ink surface for one feature. Pasting and
dropping images into notes is untouched — it predates the canvas. The rendering model
stayed: nodes are DOM (a card needs real text), connections are one SVG layer.

**Three layouts behind a switcher, one preference.** The map is one `MapView` over one
computed graph (`src/map/graph.ts`, ported from the lens's compute) with three layouts
(`src/map/layouts.ts`): **Clusters**, the reference shape — excerpt cards packed per folder,
folder tabs, degree balls; **Constellation**, the default — a dot per file sized by how
connected it is, colored by folder, placed by a seeded force simulation with a soft pull
toward the folder's centroid and a blurred halo per folder; **Ledger** — one row per file
under folder headings, references as arcs, scrolling like a document. The last-used view is
one app-wide `mapView` setting, because a person reads all their maps the same way;
per-project can come later without moving anything. A ring layout (folders as arcs,
references as chords) was drawn on the candidate sheet and not picked.

**Clicking gets more.** Hovering a node lifts its connections out of the ghost layer;
clicking pins them in a color _and_ opens the node's details — name, folder, title, opening
text, and its references and back-references as rows that select their node (double-click
opens it). Double-clicking a node opens the note. The details panel is what "I want to know
more about this file" means on a map, and it is why dots can stay dots.

**Stability is a property, not luck.** The constellation is seeded, so the same notes always
produce the same picture, and it warm-starts from the last layout in the session, so a new
note lands near its folder and nothing else moves. Clusters and the ledger are deterministic
by construction.

**What this undoes, recorded honestly.** [Canvas is a native view, not a plugin] settled a
seam — the registry adds formats, code adds views — that still holds; the view it was drawn
for is gone, and `ViewId` is `markdown | text` again. [Canvas files are JSONCanvas] softened
"markdown files are the store" for a second file type; that softening is withdrawn — the
app writes nothing but the notes the user typed. A settings file on any canvas-era shipped
registry upgrades to the registry without the canvas entry, so `.canvas` files stop being
notes; a hand-edited registry is left alone as ever.

**Rejected:** keeping the engine for the freeform canvas and giving the map its own renderer
anyway (no feature loss, two surfaces to maintain for features nobody used); swapping only
the layout algorithm inside the lens (leaves the weight and the rectangles); keeping image
annotation on a small ink surface of its own (a whole surface for one unused feature).

## Links

- [Canvas is a native view, not a plugin](2026-08-14-canvas-is-a-native-view.md) and
  [Canvas files are JSONCanvas](2026-08-14-canvas-files-are-jsoncanvas.md) — superseded.
- [Markdown files are the store](2026-08-06-markdown-files-are-the-store.md) — back to full
  strength.
- Key files: [`src/map/graph.ts`](../../src/map/graph.ts) (the model),
  [`src/map/layouts.ts`](../../src/map/layouts.ts) (the three layouts),
  [`src/map/MapView.tsx`](../../src/map/MapView.tsx) (the surface).
