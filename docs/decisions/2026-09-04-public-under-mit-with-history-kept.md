# Public under MIT, with the history kept

- Date: 2026-09-04
- Status: Accepted (the tree is ready; the switch itself is a repository setting)

## Context

The repo was private from the first commit and always meant to go public. A public repo
with no license is all-rights-reserved, so the license was the one true blocker; around it
sat the questions any private tree faces before strangers can read it: what the commit
history exposes, whether the docs that compare other products can stay, where session
working notes belong, and how plainly to say that the code is written with AI tooling.

## Decision

**MIT.** The intent is the friendliest possible terms with credit kept: anyone may use,
fork, sell or close the software as long as the copyright notice travels with it. GPL was
considered and dropped because closed forks are acceptable here; noncommercial
source-available terms were considered and dropped because they would forbid using the app
at work, which is its main use. The identifier lives in `LICENSE` and the three manifests.

**The history stays.** The commit trail is the most useful thing in the repo for a reader
asking why something is the way it is, and an audit found nothing in it that could not be
published: no secrets, no machine paths, no unattributed third-party code. What it did
carry was identity metadata — a personal email on every commit and AI co-author trailers —
and that was rewritten in place with the trees and dates untouched, rather than squashing
sixty commits into one to hide it. The author email is the GitHub no-reply address.

**Comparisons stay out of the repo.** The house rule holds everywhere: describe the
behaviour, never name the product it resembles. Material whose value depends on the name
goes to the gitignored `docs/private/`. Revised 2026-10-29: `branding.md` first kept its
positioning half (niche, competitor table, sources) on the grounds that comparison was that
file's point; that half moved to `docs/private/` and `branding.md` keeps the mark and its
asset recipe. The same pass took the old in-repo handoff file, the full `branding.md` and
the links to private working pages out of every commit, with dates and authors unchanged.

**Session state is not project history.** Handoffs between working sessions live outside
the repo, under the handoff tooling's own directory; the old in-repo path is gitignored.
Links to private working artifacts do not belong in tracked docs either.

**Say how it is built.** The README states that the project is built in the open with
substantial help from AI coding tools, and `CLAUDE.md` stays tracked. Hiding either would
be a worse look than stating it.

**Published promises.** The README carries the no-unrequested-network rule, because it is
the claim a reader can verify from the source, and states that meeting recording captures
other people and that informing them is on the user.

## Links

- [LICENSE](../../LICENSE), [README.md](../../README.md)
- [dev-environment.md](../dev-environment.md) — the machinery that gates accepting
  contributions, which publishing did not need
- The distribution work (releases, winget, signing, updater) is the 2026-09-05 TODO item.
