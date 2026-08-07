<p align="center">
  <img src="assets/mark.svg" width="120" alt="asapnotes mark — a hand-drawn leaning A with an amber pencil at its foot">
</p>

# asapnotes

Instant-capture markdown notes for Windows. Hit a global keybind, the window is there, type,
get back to what you were doing — built for the "I need to write this down _now_, I'm in a
meeting" moment. An MCP server over the same notes is planned so an AI can go over them with you.

## How it stays instant

Nothing cold-starts fast enough to trust in a hurry. asapnotes runs as an always-resident tray
process with a pre-created hidden window; the global hotkey only _shows_ it, which is
near-instant. Two consequences shape every change:

- **Idle footprint is a feature.** The app sits in the tray all day — every dependency pays
  rent in RAM and startup time.
- **Cold start only happens at login** (autostart), so summon latency, not launch time, is the
  number that matters.

## Notes are markdown files

One `.md` file per note in a plain folder you own — greppable, syncable, editable by anything,
and trivially exposed to AI tools over MCP. The app is a fast viewport onto your files, not a
database you must export from. Planned on top (see [docs/decisions/](docs/decisions/README.md)):
project/workspace grouping including mapping in files that live outside the notes root, and
later cloud share / live collaboration.

## Status

Runnable skeleton (2026-08-06): the window launches; no features yet. Build-out order lives in
[docs/TODO.md](docs/TODO.md).

## Development

Prerequisites: Node 20+, Rust (rustup, MSVC toolchain), VS 2022 Build Tools with the C++
workload, WebView2 runtime (ships with Windows 11).

```powershell
npm.cmd install
npm.cmd run tauri dev     # run the app (first Rust build is slow; later ones are fast)
npm.cmd run tauri build   # produce the installer/bundle
```

Quality gates before finishing any change:

```powershell
npm.cmd run build         # tsc + vite — must be clean
npm.cmd run lint
npm.cmd run format
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml
```

> In PowerShell use `npm.cmd` — the `npm.ps1` shim is blocked by execution policy.

## Repo map

| Path         | What it is                                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `src/`       | React/TypeScript UI (Vite)                                                                                              |
| `src-tauri/` | Tauri 2 shell (Rust): window, tray, hotkey, commands                                                                    |
| `docs/`      | Developer handbook: [TODO.md](docs/TODO.md) (live working file) + [decisions/](docs/decisions/README.md) (decision log) |
