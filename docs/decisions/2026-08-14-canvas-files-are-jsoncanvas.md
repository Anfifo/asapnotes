# Canvas files are JSONCanvas plus an ink extension

- Date: 2026-08-14 (ink schema added 2026-08-16)
- Status: Superseded by [The map is a graph view, not a canvas](2026-08-25-map-is-a-graph-view-not-a-canvas.md)
  — the app reads and writes no `.canvas` files since 2026-08-25.

## Context

A canvas needs a file format, and this app's contract is that the files are the store — plain
documents the user owns, readable by other tools and by the planned MCP sidecar. A private
schema would have been the easiest thing to write and the worst thing to own: a board nobody
else can read undercuts the reason for having files at all.

## Decision

**JSONCanvas (the open spec), as the format for both canvas vocabularies.** A project board
and a freeform canvas are the same file type — the board is `board.canvas` at the project
root, whose nodes are the spec's own `file` nodes, and everything else is any other `.canvas`
file. One format, one code path, one surface.

**Mixing is not a choice the format leaves us.** The spec has four node types — `text`,
`file`, `link`, `group` — and no image type, because an image _is_ a file node. So the
"freeform" vocabulary is the board's vocabulary, and a rule keeping content nodes out of a
board would have been unenforceable anyway: files from other tools mix freely and we must
render them. The two roles differ only in which "add" verbs lead; **no node kind is ever
refused**, which is also how a board stops being a wall of unconnected cards — a sticky note
on a board and a note card on a canvas both just work.

**What the spec allows and we deliberately do not author:** node and edge colors, edge
labels, and pinned edge sides are read, rendered and written back, but nothing in the UI
creates them. Edges are authored geometry-only — drag from a node's side handle onto another
node, and the nearest facing sides are computed and stored. Rendering edges was not optional:
the first slice already preserved the `edges` array verbatim while drawing nothing, so a
canvas made elsewhere opened here silently hiding its arrows.

**Round-tripping is a hard rule, not an aspiration.** Parsing keeps every field it doesn't
model — unknown node types, unknown keys on nodes and edges, unknown top-level keys — and
serialization writes them back untouched. An edge whose endpoints don't exist stays in the
file and simply isn't drawn; a node type we've never heard of keeps its name on screen rather
than rendering as an empty box. Verified live by opening a file carrying a foreign top-level
key, a dangling edge and a `wormhole` node, and reading it back intact.

**Two accepted trades, recorded so they aren't rediscovered.** JSONCanvas nodes are
axis-aligned rectangles with no rotation and no freehand, so the ink layer is a documented
custom node type: a conforming reader will open the file and skip the strokes.
And a node's `file` is a real relative path from the canvas to its target, computed with the
same `relativePath` that backs `@`-mention links, so other readers can follow it — falling
back to the project-relative id only when no relative path exists (a target on another
drive), which only this app resolves. Same trade mentions already made.

**A canvas's own contract with the user is autosave**, which follows from the format rather
than from taste: the document _is_ the arrangement, so a node drag has to reach the file
without a Ctrl+S, and pasting an image already writes its asset to disk the moment it lands —
leaving the document unsaved would strand the asset with no node referencing it. The one
place autosave must not decide for the user is a conflict: a file that changed on disk stops
the autosave, says so once, and waits for an explicit save.

**Rejected:** a private schema (nothing else could read a board); enforcing separate node
vocabularies per file (unenforceable, and it forbids the annotation that makes a board worth
looking at); and letting a geometry write and a text edit follow different persistence rules,
since serialization is whole-document — a geometry write must serialize the in-flight text or
write stale text, and the only way out would be moving layout back out of the `.canvas` file.

## The ink extension (2026-08-16)

The documented custom node type the decision above reserved. An ink node is a normal node —
it has `id`, `x`, `y`, `width`, `height`, and participates in selection, movement, deletion
and edges like any other — whose `type` is `"ink"` and which carries a `strokes` array:

```json
{
  "id": "…",
  "type": "ink",
  "x": 0,
  "y": 0,
  "width": 120,
  "height": 80,
  "strokes": [
    {
      "points": [
        [20, 20, 0.5],
        [60, 30.25, 0.62]
      ],
      "width": 2
    },
    {
      "points": [
        [30, 60, 0.8],
        [80, 20, 0.3]
      ],
      "width": 5,
      "color": "4"
    }
  ]
}
```

- **`points`** — `[x, y, pressure]` triples, **relative to the node's own origin**, so moving
  the node never rewrites them. Pressure is 0..1; `0.5` means "no pen data" (what a mouse
  reports) and renders the nominal width. Written with two decimals — node geometry is whole
  pixels, but a stroke's shape lives in the fractions.
- **`width`** — nominal line width in canvas units; pressure modulates around it (0.4×..2×).
- **`color`** — optional, the same rule as node color: a preset `"1"`..`"6"` or a hex value.
  Absent means the reading app's default ink.

The node's rectangle is the strokes' padded bounding box, maintained by the writer; resizing
the node scales the points with it (the nominal width stays). Erasing removes whole strokes —
strokes are data, and the file never carries erase-ops or baked bitmaps, which is what keeps
it pure vector and readable. One normalization is accepted: fields inside a stroke object
beyond the three above are not round-tripped (strokes are rewritten on save), unlike unknown
fields on the node itself, which ride through like any other node's.

A conforming JSONCanvas reader that doesn't know the extension opens the file and shows an
empty rectangle where the drawing is — degraded, never broken.

## Links

- [Canvas is a native view, not a plugin](2026-08-14-canvas-is-a-native-view.md) — the seam
  this format plugs into.
- [Markdown files are the store](2026-08-06-markdown-files-are-the-store.md) — the invariant
  this softens the same way the plain-text-formats work does: the files stay open and
  readable, they are simply not all markdown.
- [project-model.md](../project-model.md) — `board.canvas` as a file rather than a config key,
  and why.
- Key files: [`src/canvas/jsoncanvas.ts`](../../src/canvas/jsoncanvas.ts) (the format layer),
  [`src/canvas/BoardView.tsx`](../../src/canvas/BoardView.tsx) (the surface).
