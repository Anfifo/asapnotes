# Resident tray architecture + Tauri 2/React stack

- Date: 2026-08-06
- Status: Accepted

## Context

The product goal is urgency capture: a global keybind must put a writable note on screen
essentially instantly — mid-meeting, mid-anything. No framework cold-starts reliably fast
enough, so "fast" cannot come from launch time. Windows-first with other platforms later;
an MCP integration over the notes is planned. The maintainer's daily stacks are C#/.NET
and React/TypeScript.

## Decision

- **Architecture: always-resident tray process with a pre-created hidden window.** The
  global hotkey shows/hides it; a cold start only happens at login (autostart).
  Consequence: idle footprint is a permanent feature of the product — every dependency
  pays rent in RAM and startup time.
- **Stack: Tauri 2 + React/TypeScript.** WebView2 keeps idle RAM roughly 60–90 MB and
  hidden-window show is near-instant; official plugins cover the exact needs
  (`global-shortcut`, `tray-icon`, `autostart`); the UI is written in the stack used
  daily; and the planned MCP sidecar in TypeScript keeps the repo close to one language.
  The Rust shell is mostly configuration.
- **Rejected:** Electron — the resident pattern works there too, but 150–300 MB idle for a
  tray-resident note app is exactly the sluggishness this project exists to avoid.
  WPF/WinUI 3 — fastest native path and the strongest language fit, but Windows-only by
  design; "map onto other platforms later" would mean a UI rewrite. Avalonia — C#
  end-to-end and cross-platform, but a new UI stack to learn with a weaker mobile story.

## Links

- [docs/TODO.md](../TODO.md) — hotkey + tray residency work item
- [2026-08-06-markdown-files-are-the-store.md](2026-08-06-markdown-files-are-the-store.md)
