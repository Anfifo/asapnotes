# Decisions

One log for the decisions that shape this repo: architecture choices, subsystem designs,
"chose against" calls, and parked investigations. If a future contributor could reasonably
ask "why is it like this?" — the answer belongs here, as a short entry linking to the deep
doc that carries the detail.

Entries are dated (`YYYY-MM-DD-slug.md`) and deliberately lightweight. The bar is simply
_a real decision or a main integration_ — not task noise, not routine fixes.

## Template

```markdown
# <Short title>

- Date: YYYY-MM-DD
- Status: Accepted | Built | Parked | Superseded by <entry>

## Context

One paragraph: the problem and the forces in play.

## Decision

What was decided, including what was rejected and why.

## Links

Deep docs, migrations, key files.
```

## Where entries come from

- Promoted from [`docs/TODO.md`](../TODO.md) when a completed work item embodied a real
  decision (see the workflow note in [CLAUDE.md](../../CLAUDE.md)).
- Written directly when a decision is made outside a tracked TODO (an investigation that
  ends in "park it", a probe that picks an approach).

## Index

| Date       | Entry                                                                                    | One-liner                                                             |
| ---------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 2026-08-06 | [Resident tray + Tauri stack](2026-08-06-resident-tray-and-tauri-stack.md)               | Always-resident tray process + hidden window; Tauri 2 + React/TS      |
| 2026-08-06 | [Markdown files are the store](2026-08-06-markdown-files-are-the-store.md)               | `.md` files as source of truth; workspaces + cloud layer on top       |
| 2026-08-07 | [Folders are projects](2026-08-07-folders-are-projects.md)                               | First-level subfolders group notes; root notes have no project        |
| 2026-08-07 | [External projects linked in place](2026-08-07-external-projects-linked-in-place.md)     | Scan finds README-marked folders; notes edited where they live        |
| 2026-08-10 | [A project is a location plus mounts](2026-08-10-a-project-is-a-location-plus-mounts.md) | One model for root, linked and virtual folders; ids unchanged         |
| 2026-08-10 | [Config splits by trust, not by scope](2026-08-10-config-splits-by-trust.md)             | Personal config in app data, portable config in the project           |
| 2026-08-14 | [Canvas is a native view, not a plugin](2026-08-14-canvas-is-a-native-view.md)           | Superseded 2026-08-25; the registry-vs-code seam still stands         |
| 2026-08-14 | [Canvas files are JSONCanvas](2026-08-14-canvas-files-are-jsoncanvas.md)                 | Superseded 2026-08-25; no `.canvas` files any more                    |
| 2026-08-25 | [The map is a graph view, not a canvas](2026-08-25-map-is-a-graph-view-not-a-canvas.md)  | Canvas engine removed; one map view, three layouts, click for details |
