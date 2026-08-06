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

| Date       | Entry                                                                      | One-liner                                                        |
| ---------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 2026-08-06 | [Resident tray + Tauri stack](2026-08-06-resident-tray-and-tauri-stack.md) | Always-resident tray process + hidden window; Tauri 2 + React/TS |
| 2026-08-06 | [Markdown files are the store](2026-08-06-markdown-files-are-the-store.md) | `.md` files as source of truth; workspaces + cloud layer on top  |
