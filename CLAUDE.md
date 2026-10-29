# CLAUDE.md

asapnotes — instant-capture markdown notes. Always-resident tray app (Tauri 2 + React/TS)
summoned by a global hotkey; notes are plain `.md` files; an MCP sidecar is planned.

## Code style

- KISS: the obvious solution over the clever one. Comments say _why_, not _what_.
- **No product comparisons in comments or docs** — never "VSCode-style", "like Obsidian",
  etc. Describe the behavior itself; keep the rationale without naming other products.
  (The repo is going public; this covers code, TODO.md, and decisions/ entries alike.)
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
- **No unrequested network connections.** No telemetry, analytics, or silent phone-home —
  ever. Anything that leaves the machine (update checks, cloud share, sync) is explicitly
  asked for or explicitly consented to first. A resident tray app earns trust by being
  auditably quiet.

## Working loop (`docs/`)

- **Handoffs live outside the repo.** `/handoff read` picks up the newest under
  `~/.claude/handoffs/asapnotes/`; `/handoff file` writes one there. They describe the
  present state of a session and never get committed (`docs/handoff.md` is gitignored in
  case one lands there by habit). What is durable goes into TODO.md or decisions/.
- `docs/TODO.md` — keep current while working: add item with date + one-line context, update
  as it progresses.
- `docs/decisions/` — when a finished TODO item embodied a real decision or main integration,
  promote it to a dated entry (template in its README) and delete it from TODO.md; plain task
  noise is just deleted. Bar for an entry: answers "why is it like this?" — not routine fixes.

## Dev commands

```powershell
npm.cmd install
npm.cmd run tauri dev     # run the app (Vite on fixed port 1430 + cargo)
npm.cmd run notices       # rebuild THIRD-PARTY-NOTICES.txt after a dependency change (needs cargo-about)
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
- **The Rust build needs cmake** (the Opus codec compiles from source). It need not be on
  PATH: a `CMAKE` env var pointing at `cmake.exe` works — VS Build Tools ships one under
  `Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin`.
- **The transcription engine is opt-in to build**: `cargo build --features transcribe --bin
asapnotes-transcribe` (whisper.cpp from source; a plain `tauri dev` never compiles it). Its
  bindings need **libclang**: `pip install libclang`, then point `LIBCLANG_PATH` at the folder
  holding `libclang.dll` (under the Python `site-packages/clang/native`). The crate's bundled
  bindings are Linux-shaped and fail to compile here, so bindgen has to run.
- Vite's port **1430 is fixed** (`strictPort`, bound to `127.0.0.1`) — a second dev instance won't start.
- First `tauri dev` build compiles the whole Rust tree (minutes); incremental is fast.
- Frontend JS calling into Rust needs the matching grant in
  `src-tauri/capabilities/default.json` — missing grants fail at runtime, not compile time.
