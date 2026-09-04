# docs

Developer handbook for asapnotes. Two files are part of the working loop (see the
"Docs, TODO & decisions" section in [CLAUDE.md](../CLAUDE.md)):

- [TODO.md](TODO.md) — the live working file: in-flight and upcoming work.
- [decisions/](decisions/README.md) — the decision log: dated entries answering
  "why is it like this?".

Session handoffs (where the work stands right now, what is verified, the traps) are not
part of the repo; they live under `~/.claude/handoffs/asapnotes/` and are picked up with
`/handoff read`.

Deep design docs (architecture write-ups, investigations) also live here as they appear,
linked from the decision entries that reference them:

- [project-model.md](project-model.md) — a project is a location plus mounts, and where
  config lives (split by trust).
- [mcp-tool-surface.md](mcp-tool-surface.md) — the MCP sidecar's tools, section
  addressing, grant enforcement and attribution. Built 2026-08-19; its
  "What changed in the building" section supersedes the design text above it, and
  [mcp/README.md](../mcp/README.md) is the setup and grant reference.
