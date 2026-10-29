# Third-party notices are generated per release

- Date: 2026-10-29
- Status: Built

## Context

The installer and the transcription engine redistribute open-source code: about 210 Rust
crates, 64 npm packages in the interface bundle, and native code that no package's license
field names. Their licenses ask for their notices to travel with the binaries. An audit on
2026-10-29 found no copyleft license in what ships, one MPL-2.0 crate (`option-ext`, which
needs a pointer to its source), and four items no tool detects: the prebuilt Opus library
inside `audiopus_sys`, the WebView2 SDK loader inside `webview2-com-sys`, whisper.cpp and
ggml inside `whisper-rs-sys`, and the Lucide icon paths drawn in `src/icons.tsx` and
`src/fileIcons.tsx`.

## Decision

`THIRD-PARTY-NOTICES.txt` sits at the repository root, is committed, and ships in the
installer as a bundle resource. `npm run notices` rebuilds it from three parts: the
hand-kept `notices/manual.txt` for the four items above, cargo-about over the app and the
`transcribe` feature, and rollup-plugin-license, which records the packages Vite actually
put in the bundle. The release workflow runs the same script before building, so every
installer carries notices that match its lockfiles. cargo-about fails on a license missing
from the list in `notices/about.toml`, which makes that list the review point for a new
dependency's license.

Generating once and committing by hand was considered. It is simpler, and goes stale
without anyone noticing when a dependency changes. A notices file per binary was also
considered; one file covers both, since the engine is part of the same release.

The cargo-about report keeps proc-macro crates that only run at compile time, so it lists
more crates than link into the binaries. It over-reports.

## Links

- [notices/](../../notices/): config, template, manual notices, assembly script
- [release.yml](../../.github/workflows/release.yml)
