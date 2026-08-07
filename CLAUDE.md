# CLAUDE.md

asapnotes — instant-capture markdown notes. Always-resident tray app (Tauri 2 + React/TS)
summoned by a global hotkey; notes are plain `.md` files; an MCP sidecar is planned.

## Code style

- KISS: the obvious solution over the clever one. Comments say _why_, not _what_.
- Hoist a helper on the _second_ real use — not before, never a third copy.
- Smallest diff that solves the problem; no unrelated reformatting or renames.
- Leave working, tested machinery alone; state what you deliberately left alone.

## Product invariants

- **Summon latency is the product.** Resident tray + pre-created hidden window + global
  hotkey is settled ([decision](docs/decisions/2026-08-06-resident-tray-and-tauri-stack.md)).
  Anything growing idle footprint or slowing summon needs a strong case.
- **Markdown files are the contract.** Notes stay plain `.md` the user owns; every feature
  keeps files primary and readable by other tools
  ([decision](docs/decisions/2026-08-06-markdown-files-are-the-store.md)). Don't assume all
  notes live under one root — external-file mappings are planned.
- **No heavy frameworks by default** — no state libraries, UI kits, or ORM-ish layers until
  a real need forces one.

## Working loop (`docs/`)

- `docs/TODO.md` — keep current while working: add item with date + one-line context, update
  as it progresses.
- `docs/decisions/` — when a finished TODO item embodied a real decision or main integration,
  promote it to a dated entry (template in its README) and delete it from TODO.md; plain task
  noise is just deleted. Bar for an entry: answers "why is it like this?" — not routine fixes.

## Dev commands

```powershell
npm.cmd install
npm.cmd run tauri dev     # run the app (Vite on fixed port 1420 + cargo)
```

Quality gates before finishing any change:

```powershell
npm.cmd run build         # tsc + vite — must be clean
npm.cmd run lint
npm.cmd run format
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml
```

## Gotchas

- **`npm.cmd`** (not `npm`) in PowerShell — the `.ps1` shim is blocked by execution policy.
- Vite's port **1420 is fixed** (`strictPort`) — a second dev instance won't start.
- First `tauri dev` build compiles the whole Rust tree (minutes); incremental is fast.
- Frontend JS calling into Rust needs the matching grant in
  `src-tauri/capabilities/default.json` — missing grants fail at runtime, not compile time.
