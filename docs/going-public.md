# Going public — concerns, decisions, and the order to do them in

Written 2026-08-10. The decision to publish is taken; this is what has to be true first.

Two docs divide the work, and neither repeats the other:

- **This file** owns everything about _publishing_ — the license, what is safe to expose,
  git history, first impression, and the promises the repo makes once strangers can read it.
- [`dev-environment.md`](dev-environment.md) owns the _machinery_ — F5, CI, tests, toolchain
  pinning, CONTRIBUTING. Those gate accepting contributions rather than publishing, so they
  are referenced here and detailed there.

The publish step deserves one warning up front: **making a repository public is effectively
irreversible.** Anything pushed can be forked, cached, and indexed within minutes, and
flipping back to private does not retract copies. Everything below is cheaper to do before
the switch than after.

---

## 1. The license — the only true blocker

There is no `LICENSE` file. `package.json` carries `"private": true` and no `license`
field; `Cargo.toml` has no `license` either. **A public repo with no license is all rights
reserved**: nobody may legally use, fork, or contribute, and contributors who know this
walk away rather than ask. Nothing else in this document blocks the switch. This does.

### 1.1 Which one

| Option         | What it means here                                                                       |
| -------------- | ---------------------------------------------------------------------------------------- |
| **MIT**        | Shortest, most permissive, most familiar. Anyone may ship a closed fork.                 |
| **Apache-2.0** | The same practical freedoms, plus an explicit patent grant and a trademark clause.       |
| **GPL-3.0**    | Derivatives must stay open. Blocks closed forks, and deters some corporate contributors. |

Three things bear on the choice, in rough order of weight:

**The planned cloud tier.** "Cloud share + live collaboration" is a stated direction. Any of
the three lets _you_ build and sell that. The difference is what stops _someone else_ from
running it: MIT and Apache-2.0 do not, GPL-3.0 only partly (it reaches distributed
derivatives, not a hosted service — that would need AGPL, which is a heavier ask of
contributors and unusual for a desktop app). If a competing host is a real fear, say so now.

**Relicensing gets expensive fast.** Changing the license after contributions arrive needs
every contributor's agreement. Today there are none, so this is a free decision. In three
months it may not be.

**Patent language.** Apache-2.0's explicit grant is the reason it is the default for
projects that want corporate users to be comfortable; MIT's silence on patents is a real if
usually theoretical gap.

_Recommendation:_ **Apache-2.0.** It costs nothing over MIT except file length, and it is
what the Tauri ecosystem this app sits in uses. Pick MIT if you want the shortest possible
file and maximum casual adoption; pick GPL-3.0 only if closed forks are the thing you most
want to prevent, accepting that it will cost you some contributors.

### 1.2 Where the answer propagates

Once picked, the same decision has to land in five places or it will contradict itself:

- `LICENSE` at the repo root — the full text, unmodified, with the copyright line filled in.
- `"license"` in `package.json`. Keep `"private": true` — it prevents an accidental
  `npm publish`, and this is an application, not a package.
- `license` in `src-tauri/Cargo.toml`, next to the `authors` field already there.
- A line in the README saying what it is.
- `NOTICE` at the root — Apache-2.0 only, optional, and only if you want attribution
  carried into derivatives.

### 1.3 Two things to verify, not assume

- **Dependency licenses.** Nothing may force a license we don't want. The direct
  dependencies are permissive (Tauri is Apache-2.0/MIT, React and CodeMirror are MIT), so
  the expected answer is "fine" — but it is one `cargo deny` / `license-checker` run away
  from being known rather than assumed, and worth doing once before publishing.
- **Bundled third-party licenses in the installer.** Permissive licenses generally require
  attribution in distributed binaries. Not a blocker for a source release; it becomes one
  when the installer ships, which is tracked in the TODO's Windows-installer item.

---

## 2. What is already clean

Worth stating, because the rest of this document is a list of problems and the actual
exposure is smaller than it looks. Verified 2026-08-10:

- **No personal data in tracked files.** No email addresses, no `C:\Users\…` paths, no
  machine names. The only identifiers are deliberate branding — `Anfifo`, `anfifo.com`, the
  coffee link in [Settings.tsx](../src/Settings.tsx) — all of which are meant to be public.
- **`.claude/` is not tracked.** Local agent configuration and transcripts stay out.
- **Source comments are clean.** The 2026-08-09 scrub of product comparisons has held: zero
  hits across `src/` and `src-tauri/src/`.
- **No secrets of any kind.** The app makes no network connections and has no keys, tokens,
  or endpoints to leak — a direct consequence of the no-unrequested-network invariant.

---

## 3. Product comparisons in the docs

The no-product-comparison rule in [CLAUDE.md](../CLAUDE.md) covers docs as well as code, and
the docs were never swept. Current counts of product-name mentions:

| File                      | Mentions | Character                                                      |
| ------------------------- | -------- | -------------------------------------------------------------- |
| `docs/TODO.md`            | 28       | Mostly real comparisons — "X-style", "what Y has and we don't" |
| `docs/branding.md`        | 14       | A competitor analysis. Comparison is its entire purpose        |
| `docs/dev-environment.md` | 9        | Names the editor being configured, not comparisons             |
| `docs/decisions/`         | 3        | Mixed                                                          |
| `docs/project-model.md`   | 2        | Mixed                                                          |

**The judgment the count can't make:** naming a tool you are configuring ("in VS Code, F5
runs…") is not a comparison and should stay. Saying a feature is "VS Code-style" is, and
should be rewritten to describe the behavior. Roughly half the hits are the first kind.

### 3.1 The `branding.md` question

It is a competitor analysis by design — a table of what other capture tools do badly and
where the gap is. Scrubbing it doesn't clean it, it destroys it. Three options:

- **Keep it out of the public repo** (move to the private remote). Cleanest; loses a doc
  that genuinely explains why the product exists.
- **Publish it as-is.** Competitor analysis is a normal, defensible artifact, and being
  candid about positioning reads as confidence rather than sniping — provided the tone is
  factual, which it currently is.
- **Publish a trimmed version** keeping the niche and the mark rationale, dropping the
  competitor table.

_Recommendation:_ publish as-is. The rule exists so the codebase doesn't read as internal
notes; a positioning doc that openly compares is a different thing, and readers know it.

---

## 4. Git history

Every substantive commit carries product comparisons in its docs changes, so scrubbing files
today does not clean what `git log -p` shows. Two options:

- **Fresh-history repo** — squash to one clean initial commit, keep the full history on a
  private remote. What the TODO already leans toward. Costs the visible development story,
  including the decision-by-decision trail that is arguably this repo's most interesting
  feature. Also drops the `Co-Authored-By` trailers, which changes what §6 is even about.
- **Publish the history as-is** and accept that old commits contain comparisons the current
  docs don't. Nobody audits `git log -p` of a small project, and the current tree is what
  gets read. Keeps the story.

_Recommendation:_ decide this **after** §3, not before. If the docs scrub turns out to be a
dozen phrasings, history barely matters and keeping it is free. If it turns into a rewrite,
squashing is the cheaper end state.

---

## 5. First impression

The README is what a public repo is judged by, and ours currently opens with a status line
that is wrong by six feature commits.

- **`README.md` "Status" is stale** — it says _"Runnable skeleton (2026-08-06): the window
  launches; no features yet"_ while the app has tabs, an explorer, cross-note search,
  mentions, live preview, themes, and a project model. Rewrite it.
- **No screenshot.** For a UI application this is the single highest-value addition and it
  costs one capture. A summoned window over a desktop tells the whole story in one image.
- **No repository metadata** — `package.json` and `Cargo.toml` have no `repository` or
  `homepage`; the GitHub description and topics are empty.
- **Delete `test.md`** — a stray scratch file in the repo root. Note that `docs/TODO.md`
  records an orphaned named draft pointing at it, so removing it may leave a stale entry.
- **GitHub settings to set deliberately**, not by default: description, topics, whether
  Issues and Discussions are on, and private vulnerability reporting (see
  [`dev-environment.md`](dev-environment.md) §6.4 for the SECURITY.md half).

---

## 6. What publishing commits you to

Less a checklist than a set of expectations to accept knowingly.

- **"Where do I download it?"** is the first question a public repo gets. The honest answer
  today is "build it yourself" — the installer exists but is unsigned, so it hits the
  SmartScreen wall. Either say so plainly in the README or be ready to point at the
  Windows-installer TODO item.
- **The no-unrequested-network promise should be published, not just internal.** It is the
  most distinctive thing about a resident tray app, and — unusually — it is a claim a reader
  can verify themselves from the source. Putting it in the README turns an internal rule
  into the reason to trust the app.
- **Issues arrive on your schedule, not theirs.** A line in the README about what this is
  (a personal project, built in the open) sets expectations better than silence.
- **AI-authored disclosure.** [CLAUDE.md](../CLAUDE.md) is committed and the commit trailers
  say `Co-Authored-By: Claude`. Publishing makes that visible whether or not it is
  mentioned. Stating it plainly costs nothing and reads better than being noticed; the
  alternative is removing both, which is worse — it hides something true.

---

## 7. Machinery — detailed elsewhere

These gate _accepting contributions_ rather than publishing, and live in
[`dev-environment.md`](dev-environment.md): CI (§3), tests (§4), toolchain pinning (§5),
`CONTRIBUTING.md` and what becomes of `CLAUDE.md` (§6), `SECURITY.md` (§6.4). The repo can
go public before any of them exist. It should not accept a stranger's first pull request
before CI does.

---

## Order

**Before flipping the switch** — the irreversible step, so everything here is cheaper now:

1. Pick the license and propagate it to all five places (§1).
2. Sweep the docs for real comparisons; decide `branding.md` (§3).
3. Decide history: squash or publish as-is (§4).
4. Fix the README — status, screenshot, metadata — and delete `test.md` (§5).
5. Add the network stance and the "what this is" framing to the README (§6).

**Before inviting contributions:** CI, then `CONTRIBUTING.md`, then tests — see
[`dev-environment.md`](dev-environment.md).

**After, whenever:** dependency-license check (§1.3), `SECURITY.md`, issue templates,
signing and releases.

## Decisions needed

| #   | Question                                        | Recommendation                 |
| --- | ----------------------------------------------- | ------------------------------ |
| 1.1 | Which license?                                  | Apache-2.0                     |
| 3.1 | `branding.md` — publish, trim, or withhold?     | Publish as-is                  |
| 3   | Scrub real comparisons from the docs?           | Yes; keep tool names           |
| 4   | Squash history or publish it?                   | Decide after the scrub         |
| 5   | README rewrite + screenshot + delete `test.md`? | Yes, all of it                 |
| 6   | State the AI-authored fact plainly?             | Yes                            |
| 6   | Publish the no-network promise in the README?   | Yes — it is the trust argument |
