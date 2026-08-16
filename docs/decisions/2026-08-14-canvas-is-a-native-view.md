# Canvas is a native view, not a plugin

- Date: 2026-08-14
- Status: Built (project board and freeform canvas; ink still open)

## Context

The canvas surface arrived as a request for a freeform page where text and images are boxes
dropped anywhere, plus the wish that clicking a project opens a _view_ instead of only
expanding a tree. The first instinct was a plugin system: keep the resident tray process
small by loading the canvas only when someone wants it, and let third parties add surfaces
later.

Two forces cut against that. Summon latency is the product, so nothing may grow the startup
path — but that is a _loading_ problem, and an extension host is not a loading mechanism.
And this app's other standing promise is that a resident tray process earns trust by being
auditably quiet, which loading third-party code into it directly contradicts.

## Decision

**Built natively in-tree, behind a dynamic import.** The latency worry is answered by code
splitting: `src/canvas/BoardView.tsx` is a lazy chunk fetched when the first canvas tab
renders, so a user who never opens one pays nothing at startup — verified as its own chunk
at every step. A plugin API would have bought third-party extensibility instead, which is a
different goal, and an API designed for its only consumer is the wrong API.

**The seam is a two-part registry, and only one half is user data.** The note-type registry
in `settings.json` says which extensions exist and _names_ a view; the view providers and
everything a view implies are code in this repository. So a user can add an extension or
recolor a type by editing JSON, and cannot introduce a view. The line is enforced by the
data model rather than by a rule nobody can see.

That code half started as one branch in `Editor` and now also carries per-view policy in
`src/views.ts`: how a buffer reaches disk (`explicit` for prose, `auto` for a canvas) and
the base name an untitled document of that view takes when its content cannot name itself.
Putting the persistence policy in code and not in the registry is the same line again — a
setting a user could edit must not be able to make their notes autosave.

**Idle-footprint rules, binding on the implementation:** dynamic import only; no watchers,
polling or timers outside an open canvas; and a canvas tab restored as the _active_ tab
still must not load before the first paint. The last one shaped the launch-canvas feature:
the tab paints from the restore path and the module is imported on the next animation frame,
so a chosen canvas can open the window without a chunk fetch or a JSON parse ever sitting in
front of a frame.

**Rejected:** a third-party view plugin API (revisit only when a second consumer exists to
prove the shape, at which point the isolation model is the real decision, not the
contribution points); and a canvas library of the tldraw/konva/react-flow class — pan/zoom
over a transform matrix is a few hundred lines, where a library is idle rent plus a heavy
framework.

## Links

- [Canvas files are JSONCanvas plus an ink extension](2026-08-14-canvas-files-are-jsoncanvas.md) —
  the format half of the same slice.
- [project-model.md](../project-model.md) — the note-type registry, and why `view` and `icon`
  are ids into in-tree tables.
- [Config splits by trust](2026-08-10-config-splits-by-trust.md) — the same seam applied to
  configuration.
- Key files: [`src/canvas/BoardView.tsx`](../../src/canvas/BoardView.tsx) (the surface),
  [`src/views.ts`](../../src/views.ts) (per-view policy),
  [`src/noteTypes.ts`](../../src/noteTypes.ts) (the registry as the frontend reads it).
