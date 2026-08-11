# Dev environment — open questions before the repo goes public

Written 2026-08-10. This is a **question list, not a plan** — everything below is either
already settled (marked _Settled_) or an explicit decision waiting on an answer. Answer them
in any order; each section says what exists today, what the real options are, and what it
would cost to pick each one.

Scope: the machinery a contributor touches — how you run the app, what stops a bad change
landing, what a stranger needs to get from `git clone` to a running window. It deliberately
does **not** cover publishing — the license, what is safe to expose, the docs scrub, git
history, the README. That is [`going-public.md`](going-public.md). Nothing here blocks going
public; this is what gates accepting someone else's first pull request.

Two things frame every answer:

- **Windows-only, for now.** The app targets Windows; there is no macOS/Linux build. Every
  question below gets cheaper if we say so out loud rather than pretending to be portable.
- **Contributor count is currently one.** Machinery that pays off with ten contributors can
  be a net cost with one. The bar for each item is "does this stop a stranger's first PR
  from being a mess", not "is this what mature repos have".

---

## 1. Editor launch (F5) — _partly settled_

**Settled 2026-08-10:** [`.vscode/launch.json`](../.vscode/launch.json) is committed (and
un-ignored in `.gitignore`, which previously allowed only `extensions.json` through). F5
launches the Tauri CLI's own entry point directly — `node_modules/@tauri-apps/cli/tauri.js`
with `args: ["dev"]` — in the integrated terminal. Same result as `npm run tauri dev`, one
keypress, no extra extension needed.

**Why not a config that just runs the npm script:** the first attempt used the
`node-terminal` debug type with `command: "npm.cmd run tauri dev"`, and it silently did
nothing — the debug terminal opened, the JavaScript debugger printed its Node version probe,
and the command was never executed (verified by process scan: no `cargo`, no `rustc`, no
`asapnotes.exe`, nothing listening on 1420). The same command run in a plain terminal worked
first try, so the fault was the debug type's shell handling, not the project. Invoking the
CLI's script directly removes the shell from the path entirely, which also sidesteps the
`npm.ps1` execution-policy problem and makes the config portable — no `npm.cmd` string in it.

Worth knowing when this is unclear again: **the app launching correctly looks like nothing
happening.** The window is created hidden (`"visible": false` in `tauri.conf.json`) and lives
in the tray until summoned with Ctrl+Alt+A. "F5 didn't launch the app" and "F5 launched the
app exactly as designed" look identical on screen — check the terminal for
`Running target\debug\asapnotes.exe`, or the tray.

Deliberately **not** shipped: a Rust debugging configuration. It needs a debug adapter that
isn't installed here (CodeLLDB or the C/C++ extension), so committing it would mean
publishing config nobody has verified.

### Open questions

**1.1 — Do we want real Rust breakpoints, and via which adapter?**
Today Rust is debugged with `println!`/`dbg!`. Two adapters work on the MSVC toolchain:

| Option                                   | Cost                                               | Payoff                                           |
| ---------------------------------------- | -------------------------------------------------- | ------------------------------------------------ |
| CodeLLDB (`vadimcn.vscode-lldb`)         | ~50 MB extension; has a `cargo` launch integration | Cross-platform later; the config Tauri documents |
| C/C++ (`ms-vscode.cpptools`, `cppvsdbg`) | Large extension, but native to the MSVC toolchain  | Best debugger fidelity on Windows/MSVC           |

Either way it needs a second file, `.vscode/tasks.json`, with a background `ui:dev` task
(Vite) whose problem matcher detects the "ready in" line — the debugger must not launch
before the dev server answers, because a debug-built binary is a _dev_ build
(`tauri::is_dev()` is `!cfg!(feature = "custom-protocol")`) and loads `http://localhost:1420`
rather than embedded assets. That background matcher is the fiddly, easy-to-get-wrong part.

_Recommendation:_ defer until there's Rust work that actually warrants it — the Rust surface
is three files today. Revisit when touching tray/global-shortcut/file-watching behavior,
where stepping through beats printing. When we do, add the adapter to
[`.vscode/extensions.json`](../.vscode/extensions.json) recommendations so it self-installs.

**1.2 — Should `.vscode/settings.json` be committed too?**
Candidates: `rust-analyzer.linkedProjects: ["src-tauri/Cargo.toml"]` (the workspace root has
no `Cargo.toml`, so rust-analyzer relies on discovery — it appears to work, but pinning it
removes the question), format-on-save with Prettier as the default formatter, and
`files.eol: "\n"` to reinforce `.editorconfig`. Trade-off: committed editor settings are
convenience for newcomers and an imposition on contributors with their own setup. The
convention that avoids the fight is committing only project-_correctness_ settings
(linkedProjects, EOL) and leaving personal preference (format-on-save) out.

**1.3 — The config depends on a path into `node_modules`.**
`node_modules/@tauri-apps/cli/tauri.js` is the CLI's declared `bin` entry, so it is stable
across patch versions, but it is still a path into an installed dependency: F5 fails with a
confusing error before `npm install` has run, and would break if the package restructured.
The alternative is going back through an npm script, which is what just failed. Acceptable
for now; if it ever bites, the fix is a `tasks.json` task plus a `preLaunchTask`.

---

## 2. License, and everything else about publishing

Moved. The license decision, what is safe to expose, the docs scrub, git history, and the
README's first impression all live in [`going-public.md`](going-public.md) — they are about
publishing, not about the dev loop. The license is the one true blocker for going public;
nothing in _this_ document is.

---

## 3. Continuous integration

No `.github/` directory exists. The five quality gates in [CLAUDE.md](../CLAUDE.md) run only
when someone remembers to run them. That is survivable for a solo repo and indefensible for
a public one — an outside PR needs an automatic answer.

**3.1 — What shape?** The cheap, honest split:

- **`ubuntu-latest` job** — `npm ci`, `npm run build` (tsc + vite), `npm run lint`,
  `npm run format:check`. About a minute, no Rust, no system dependencies.
- **`windows-latest` job** — `cargo fmt --check` and `cargo clippy` against
  `src-tauri/Cargo.toml`, with `Swatinem/rust-cache`. First run is several minutes (the
  whole Tauri tree); cached runs are short.

Rust checks stay on Windows only — the app is Windows-targeted, and adding Linux to the
matrix means installing webkit2gtk system packages to lint a platform we don't ship.

**3.2 — Does CI fail on clippy warnings (`-D warnings`)?** Strict is the right default for a
public repo (warnings otherwise accumulate until nobody reads them), but it means a Rust
toolchain bump can turn a green branch red through no fault of the PR. The alternative is
pinning the toolchain (§5), which makes strict safe. These two questions should be answered
together.

**3.3 — Does CI gate on formatting, or fix it?** `format:check` failing a PR over whitespace
is a common source of contributor friction. Options: fail (simple, strict), or run Prettier
and push the fix (friendlier, needs write permissions on the workflow — more moving parts).

**3.4 — Does a full `tauri build` run in CI?** It catches "compiles in dev, breaks in
release" and produces an artifact to download, at the cost of a slow job. Reasonable answer:
not on every PR — only on tags, folded into the release work already tracked in TODO under
"Windows installer".

**3.5 — Shell gotcha.** Set `shell: bash` on npm steps in the Windows job. The runner's
PowerShell may or may not hit the same `npm.ps1` execution-policy problem this repo
documents; `shell: bash` means never finding out.

---

## 4. Tests

There is no test runner, no test script, and no test file — JS or Rust. This is the largest
functional gap for a public repo: a contributor has no way to know they broke something, and
neither does a reviewer.

**4.1 — Add Vitest?** It shares the existing Vite config, needs one dev dependency, and adds
a `test` script. The natural first targets are the pure-logic modules where bugs are silent
and setup is zero:

- [`fuzzy.ts`](../src/fuzzy.ts) — ranking is exactly the kind of code that regresses invisibly
- [`paths.ts`](../src/paths.ts) — `relativePath` across trees, cross-drive fallback, spaces
- [`links.ts`](../src/links.ts) — URL/path recognition, trailing-punctuation trimming
- [`mentions.ts`](../src/mentions.ts) — trigger conditions and the inserted link shape
- [`livePreview.ts`](../src/livePreview.ts) — decoration ranges (harder; needs a CM state)

Explicitly **not** worth testing yet: React components (needs a DOM harness and testing
library — real weight for low yield at this stage) and anything crossing the Tauri IPC
boundary.

**4.2 — Rust tests?** `cargo test` works today with zero setup and there are no tests. The
candidates are the pure helpers in `notes.rs` (name derivation, extension allowlisting, path
resolution) rather than the command handlers, which need a running app.

**4.3 — Does CI gate on tests, and is there a coverage bar?** Recommendation: gate on tests
once they exist; **no** coverage threshold — a percentage target on a young codebase buys
tests written for the number.

---

## 5. Toolchain pinning

No `rust-toolchain.toml`, no `.nvmrc`, no `engines` field in `package.json`. Contributors and
CI each get whatever they happen to have.

**5.1 — Pin Rust?** A three-line `rust-toolchain.toml` (channel + `components = ["rustfmt",
"clippy"]` + `targets`) makes rustup install the right toolchain automatically and makes
§3.2's `-D warnings` safe. Cost: contributors download a specific toolchain, and the pin
needs deliberate bumping — which is the point.

**5.2 — Pin Node?** `.nvmrc` and/or `"engines": { "node": ">=20" }`. The README already says
Node 20+; the question is whether to make it machine-readable so CI and contributors agree.

**5.3 — Lock file policy.** `package-lock.json` is committed (correct). `Cargo.lock` is
committed too, which is right for a binary. Worth stating in CONTRIBUTING that lock files are
updated deliberately, not incidentally.

---

## 6. Contributor-facing documentation

The repo has a genuinely good [`docs/decisions/`](decisions/README.md) log and a live
[TODO.md](TODO.md), but nothing addressed to a human contributor. Everything about how work
happens here lives in [CLAUDE.md](../CLAUDE.md), which reads as agent instructions.

**6.1 — Write `CONTRIBUTING.md`?** It would carry: the quality gates, the working loop
(keep TODO.md current; promote real decisions to `decisions/`), the `npm.cmd` gotcha, and —
most importantly — the **product invariants**, since those are exactly what a drive-by PR
violates without knowing: summon latency is the product, plain files are the contract, no
heavy frameworks by default, **no unrequested network connections**. That last one deserves
to be a published rule, not an internal note; it's also the repo's most distinctive promise.

**6.2 — What happens to CLAUDE.md when the repo is public?** Three options: leave it (honest
about how the project is built, and increasingly normal), fold its human-relevant half into
CONTRIBUTING.md and keep CLAUDE.md thin, or remove it. They overlap heavily, and having both
means keeping them in sync.

**6.3 — Issue and PR templates?** A bug template that asks for Windows version, app version,
and whether the app was summoned from tray or already open would save round-trips. Cheap;
only pays off once strangers file issues.

**6.4 — `SECURITY.md`?** For a resident tray app that reads the user's files, a stated
disclosure channel is more than ceremony. Needs a decision on where reports go (a public
issue is the wrong place) — an email address, or GitHub private vulnerability reporting.

**6.5 — `CODE_OF_CONDUCT.md`?** Convention for public repos; zero cost (adopt Contributor
Covenant); only matters if there's a community. Yes/no.

---

## 7. First impression

Also moved to [`going-public.md`](going-public.md) §5 — the stale README status, the missing
screenshot, repository metadata, and the stray `test.md`. One item stays here because it is
a dev-loop concern rather than a publishing one:

- **Cargo has no `[lints]` section** — clippy runs are advisory. If §3.2 lands strict, a
  `[lints.clippy]` block makes the policy visible in the repo rather than only in CI.

---

## 8. Deliberately out of scope here

- **Release, signing, auto-update** — already tracked in TODO ("Windows installer",
  "Update settings + no-unrequested-network policy"). Code signing costs money and is
  pointless before anyone downloads a build.
- **Dependabot / renovate** — worth having eventually; noise before there's CI to prove an
  update is safe. Do it after §3.
- **Everything about publishing** — license, content scrub, git history, README, and the
  promises the repo makes once it is readable — is [`going-public.md`](going-public.md).

---

## Decision checklist

Ordered by what blocks what.

The license and the publishing questions are not here — see
[`going-public.md`](going-public.md).

| #   | Question                                   | Blocks               | Suggested answer         |
| --- | ------------------------------------------ | -------------------- | ------------------------ |
| 5.1 | Pin the Rust toolchain?                    | 3.2                  | Yes                      |
| 3.1 | CI: split ubuntu (JS) + windows (Rust)?    | Accepting PRs        | Yes                      |
| 3.2 | Clippy `-D warnings` in CI?                | —                    | Yes, once 5.1 lands      |
| 3.3 | CI fails on formatting, or auto-fixes?     | —                    | Fail (simple)            |
| 4.1 | Add Vitest + tests for the pure modules?   | Trusting outside PRs | Yes, after CI exists     |
| 6.1 | Write CONTRIBUTING.md with the invariants? | Accepting PRs        | Yes                      |
| 6.2 | What happens to CLAUDE.md publicly?        | 6.1                  | Fold, keep thin          |
| 1.1 | Rust debugging config + adapter?           | —                    | Defer until needed       |
| 1.2 | Commit `.vscode/settings.json`?            | —                    | Correctness keys only    |
| 6.4 | SECURITY.md and where reports go?          | —                    | Yes, needs an address    |
| 6.3 | Issue/PR templates?                        | —                    | After the first stranger |
| 6.5 | CODE_OF_CONDUCT.md?                        | —                    | Cheap, low urgency       |
