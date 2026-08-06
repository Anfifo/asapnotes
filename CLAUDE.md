# CLAUDE.md

asapnotes — instant-capture markdown notes. An always-resident tray app (Tauri 2 + React/TS)
summoned by a global hotkey; notes are plain `.md` files; an MCP sidecar is planned so an AI
can work over the notes.

## How we write code here — the "lazy senior" default

Maximise payoff per unit of effort and risk. Optimise for the code that's _cheapest to keep
correct_, not the most fun to write:

- **KISS.** The obvious solution over the clever one. Comments say _why_, not _what_.
- **One definition of a thing.** Hoist a helper when the _second_ real use appears — not
  before, and never a third copy.
- **Smallest diff that solves the problem.** Don't reformat, rename, or tidy unrelated lines
  in the same change.
- **Know what not to touch.** Working, tested machinery is left alone; relocate for
  navigation, don't rewrite for cosmetics.
- **Pick battles by effort × payoff × risk**, and state what you deliberately left alone.

## Product invariants (what makes this app itself)

- **Summon latency is the product.** Resident tray process + pre-created hidden window +
  global hotkey is settled architecture
  ([decision](docs/decisions/2026-08-06-resident-tray-and-tauri-stack.md)). Anything that
  grows idle footprint or slows summon needs a strong case — every dependency pays rent.
- **Markdown files are the contract.** Notes stay plain `.md` files the user owns; every
  feature (search, grouping, MCP, sync) keeps the files primary and readable by other tools
  ([decision](docs/decisions/2026-08-06-markdown-files-are-the-store.md)). Don't assume all
  notes live under one root — external-file mappings are a planned direction.
- **No heavy frameworks by default.** No state libraries, no UI kits, no ORM-ish layers until
  a real need forces one.

## Docs, TODO & decisions (`docs/`)

Two files are part of the working loop:

- **`docs/TODO.md`** — the live working file. While working on a task, keep it current: add
  the item with a date + one line of context when work starts, update as it progresses.
- **`docs/decisions/`** — the decision log (dated entries; see its README for the template).
  When a completed TODO item embodied a real decision or a main integration, promote it to a
  dated entry there and remove it from TODO.md; plain task noise is just deleted.

The bar for a decisions entry: a future contributor could ask "why is it like this?" — not
routine fixes. Keep entries short and link the deep doc.

## Quick orientation

| Layer        | Location                    | Key tech                                          |
| ------------ | --------------------------- | ------------------------------------------------- |
| UI           | `src/`                      | React 19, Vite 7, TypeScript                      |
| Shell        | `src-tauri/`                | Tauri 2 (Rust): window, tray, hotkey, commands    |
| Config       | `src-tauri/tauri.conf.json` | Window, bundle, identifier `com.anfifo.asapnotes` |
| Capabilities | `src-tauri/capabilities/`   | Tauri permission grants for the webview           |

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
- Vite's port **1420 is fixed** (`strictPort`) — Tauri expects it; a second dev instance
  won't start.
- The first `tauri dev`/`cargo` build compiles the whole Rust dependency tree (minutes);
  incremental builds after that are fast.
- Frontend JS calling into Rust needs the matching permission in
  `src-tauri/capabilities/default.json` — a missing grant fails at runtime, not compile time.
