# Notes are plain-text files, with features per type

- Date: 2026-08-09
- Status: Built (the registry 2026-08-10; per-project type entries not built yet)

## Context

The store decision named `.md` files. Projects linked in place hold other plain-text files
worth opening beside their notes: a `.txt` list, a `.tex` draft, a config file, a log. The
first version that admitted them shipped with two hardcoded allowlists, `NOTE_EXTS` in
`notes.rs` and `hasNoteExt` in `paths.ts`, plus "is it markdown" branches across the
chrome. Two lists kept in step by comment were a standing risk: whenever they diverged, the
backend would list a file the frontend refused to open.

## Decision

**A note is a plain-text file whose extension the registry claims.** This widens
[Markdown files are the store](2026-08-06-markdown-files-are-the-store.md): the store is
plain files the user owns and other tools read, and markdown is the default type. Detecting
a format from file content was considered. An extension decides without opening the file
and agrees with what every other tool sees.

**The registry is data in `settings.json`.** Each entry is `{ id, name, extensions, view,
icon, color, features, listed }` (`NoteType` in `settings.rs`, mirrored in
`src/noteTypes.ts`). The backend writes the shipped list on first launch and both sides
read the same file, so the union of extensions is one allowlist: `Settings::is_note` and
`isNoteFile` answer the same question from the same data. The first entry claiming a
file's extension wins. A shipped list left untouched upgrades with the app; a hand-edited
one belongs to the user and is left alone.

**Features are a closed set the chrome keys off.** `live-preview`, `preview`, `mentions`,
`format` and `images`. The toolbar, the Format menu, the preview command, mention
completion and image paste each check the open file's type for its feature, and a name
outside the set means nothing. Markdown declares all five. Every other shipped type
declares none and opens in a bare text editor in the interface face, with those
affordances hidden.

**`view` and `icon` are ids into in-tree tables.** Editing JSON can add an extension,
recolour a type or give it another shipped glyph. A new editing surface is code in this
repository; `markdown` and `text` are the two that exist. `color` names a per-theme tint
(`--tint-*`) or a literal `#rrggbb` that will not adapt to the theme.

**Types are split by family, and only prose is listed by default.** Markdown (`md`,
`markdown`), Plain text (`txt`, `text`) and LaTeX (`tex`) are listed. JSON, YAML, Config
(`toml`, `ini`, `cfg`), CSV, XML and Log ship unlisted, since data and config files sit
beside notes without being notes. An unlisted type is still a note: it opens, drafts and
saves, keeps its icon and colour, and a `!` pattern in a project's `files` rules brings it
back into the walks. One type per family lets the explorer tell a data file from a log by
icon and tint.

**Creation stays markdown.** Capture always opens a markdown note, whatever the default
note type says. Files of other types arrive from disk, through a rename that types their
extension, or by typing the extension when naming a note in the explorer.

## Links

- Deep doc: [`docs/project-model.md`](../project-model.md) (the note-type registry and
  "what counts as a note").
- Key files: [`src-tauri/src/settings.rs`](../../src-tauri/src/settings.rs) (`NoteType`,
  the shipped list and its upgrades, `is_note`, `is_listed`),
  [`src/noteTypes.ts`](../../src/noteTypes.ts) (lookup, features, tints, icons).
- [Markdown files are the store](2026-08-06-markdown-files-are-the-store.md)
