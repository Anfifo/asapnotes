# Dev environment

How the app is run and debugged from an editor, and the machinery that is still missing
before the repo accepts a stranger's first pull request. Publishing itself needed none of
this; see the
[going-public decision](decisions/2026-09-04-public-under-mit-with-history-kept.md).

Two things frame every answer:

- **Windows-only, for now.** There is no macOS/Linux build, and every question below gets
  cheaper by saying so rather than pretending to be portable.
- **Contributor count is one.** Machinery that pays off with ten contributors can be a net
  cost with one. The bar is "does this stop a stranger's first PR from being a mess".

## Launching from the editor (F5)

[`.vscode/launch.json`](../.vscode/launch.json) is committed. F5 launches the Tauri CLI's
own entry point directly — `node_modules/@tauri-apps/cli/tauri.js` with `args: ["dev"]` —
in the integrated terminal. Same result as `npm run tauri dev`, one keypress, no extra
extension.

**Why not a config that runs the npm script:** the `node-terminal` debug type with
`command: "npm.cmd run tauri dev"` silently did nothing — the debug terminal opened, the
JavaScript debugger printed its Node version probe, and the command never ran (no `cargo`,
no `rustc`, nothing listening on 1420). The same command in a plain terminal worked first
try, so the fault was the debug type's shell handling. Invoking the CLI's script directly
removes the shell from the path, which also sidesteps the `npm.ps1` execution-policy
problem and keeps the config portable.

**The app launching correctly looks like nothing happening.** The window is created hidden
(`"visible": false` in `tauri.conf.json`) and lives in the tray until summoned. "F5 didn't
launch the app" and "F5 launched the app exactly as designed" look identical on screen —
check the terminal for `Running target\debug\asapnotes.exe`, or the tray.

**Rust breakpoints are not set up.** Rust is debugged with `println!`/`dbg!`. Either
CodeLLDB or the C/C++ extension works on the MSVC toolchain, but both need a
`.vscode/tasks.json` with a background Vite task whose problem matcher waits for the
"ready in" line — a debug-built binary is a _dev_ build and loads `http://localhost:1420`,
so the debugger must not start before the dev server answers. Deferred until Rust work
warrants it; when it lands, add the adapter to
[`.vscode/extensions.json`](../.vscode/extensions.json) so it self-installs.

**Known soft spot:** the launch config points into `node_modules`, so F5 fails with a
confusing error before `npm install` has run. Acceptable; the fix if it bites is a
`tasks.json` task plus a `preLaunchTask`.

## Before accepting contributions

None of this exists yet. Ordered by what blocks what.

1. **Pin the Rust toolchain** — a `rust-toolchain.toml` with channel, `rustfmt` and
   `clippy`. Makes strict clippy in CI safe, because a toolchain bump can no longer turn a
   green branch red through no fault of the PR.
2. **CI on pull requests**, two jobs: `ubuntu-latest` for `npm ci`, `npm run build`,
   `npm run lint`, `npm run format:check` (about a minute, no Rust); `windows-latest` for
   `cargo fmt --check`, `cargo clippy -D warnings` and `cargo test` against
   `src-tauri/Cargo.toml`, with `Swatinem/rust-cache`. Rust stays on Windows only — the
   app is Windows-targeted, and a Linux matrix entry means installing webkit2gtk to lint a
   platform that does not ship. Use `shell: bash` on npm steps so the runner's PowerShell
   execution policy never becomes a question. Formatting fails the job rather than
   auto-fixing; simpler, and no write permission on the workflow.
3. **Frontend tests.** Rust has `cargo test` (111 tests as of 2026-08-31) and the MCP
   package has `node --test`; the React side has no runner. Vitest shares the Vite config
   and needs one dev dependency. First targets are the pure modules where bugs are silent:
   `fuzzy.ts`, `paths.ts`, `links.ts`, `mentions.ts`. Components and anything crossing the
   Tauri IPC boundary are not worth a DOM harness yet. No coverage threshold — a
   percentage target on a young codebase buys tests written for the number.
4. **`CONTRIBUTING.md`** carrying the quality gates, the working loop (TODO.md current;
   real decisions promoted to `decisions/`), the `npm.cmd` gotcha, and above all the
   product invariants from [CLAUDE.md](../CLAUDE.md), since those are what a drive-by PR
   violates without knowing. `CLAUDE.md` stays tracked and thin; the human-facing half
   moves here.
5. **`SECURITY.md`** pointing at GitHub private vulnerability reporting. A resident tray
   app that reads the user's files should say where reports go, and a public issue is the
   wrong place.
6. **Issue templates** asking for Windows version, app version, and whether the app was
   summoned from the tray or already open. Only pays off once strangers file issues.
7. **Dependabot**, after CI exists to prove an update is safe.

Also open, low urgency: whether to commit `.vscode/settings.json` with correctness-only
keys (`rust-analyzer.linkedProjects`, `files.eol`) and leave preference keys out; a
`[lints.clippy]` block in `Cargo.toml` once CI runs strict, so the policy is visible in the
repo rather than only in CI; `CODE_OF_CONDUCT.md` (Contributor Covenant, zero cost).

Lock files (`package-lock.json`, `Cargo.lock`) are committed and updated deliberately, not
incidentally.
