# Live preview in the editing buffer

- Date: 2026-08-07
- Status: Built (marker typography, link collapse and the shared type scale 2026-08-19)

## Context

A markdown note has to read as formatted text while it is being written, and its source has
to stay one keystroke away: the file is plain markdown that other tools edit, so what the
editor shows must map onto the characters in it. The first in-place rendering left markers
as ordinary text, which showed what that costs. `##` painted at the heading's size and `**`
painted bold, so the markers were the loudest part of the formatting they described;
heading text moved right by one character per level; and a level-1 heading came out 40%
larger in the rendered pane than in the editor, which had no space between blocks at all.

## Decision

**The edit surface renders markdown in place.** `src/livePreview.ts` is a decoration layer
over the editor's GFM parse: sized headings, real bold, italic and strikethrough, a
blockquote rule, shaded code blocks, and inline images through the asset protocol. A split
view and click-to-edit blocks were both considered. Each separates the text being read from
the text being edited, and a split view also halves a narrow capture window. One buffer
keeps one caret, one undo history and one scroll position. The Ctrl+E rendered preview
stays for what the buffer leaves as text, such as tables.

**Markers stay visible, in a type of their own.** Hiding markers off the caret's line was
weighed and kept out, because a visible marker is what shows where formatting starts and
ends. A marker never inherits the size, weight or slant of the text it formats: inline
marks are 0.7em, weight 400 and upright, coloured by kind from three low-saturation tokens
(`--mk-structure`, `--mk-emphasis`, `--mk-literal`). A two-character run (`**`, `~~`)
stacks into one glyph cell, so the pair costs one character of width; a single `_`, `*` or
backtick has nothing to stack and stays inline.

**Block marks move out of the text's way.** A heading's `#` run stacks into one cell and
hangs in an 18px gutter at zero width, so heading and body text share one left edge at
every level. The glyph size is one expression, `min(10, max(6, 19 / (0.55 × count)))` px,
so a level-6 stack still fits its line. A quote's rule runs unbroken down the block and its
`>` is drawn once, on the opening line, centred on the rule. A list marker is the note's
own character, indented by nesting depth (`--md-list-step`) so the editor steps the way the
rendered pane does.

**The real characters return at the caret.** Stacked marks give way to the raw characters
on the caret's line, and every `>` of a quote returns while the caret is anywhere inside
the block, so a heading's level or a bold pair stays editable by typing. Undrawn text
(continuation `>`, typed list indent) stays in the document, selectable and deletable.

**Link targets collapse to their label off the caret.** An inline link shows its dimmed
brackets and its label; the `(target)` is hidden until the caret touches that link, and
hovering the label shows the target in the app's tooltip after its dwell. This is the one
treatment that hides content: every other undrawn range is syntax, while a path is text
the note holds. The two reveals and the untouched file are what make it acceptable.
Expanding the path inline on hover was considered and dropped, because the line reflows
under the pointer holding the hover. A reference link (`[label][ref]`) is left as written.

**The note body has its own face.** Markdown notes read in Sitka Text at 16px / 1.65 with
the measure capped at 72ch. The chrome keeps the interface sans, and so do plain-text
notes, which are as likely to hold config or code as prose. The face ships with the
operating system; a font fetched at runtime is excluded by the no-network rule.

**One markdown type scale.** Heading sizes and weight, line height, block gap, measure,
list step and quote padding are `--md-*` tokens in `App.css`, read by the editor, the
changes lens and the Ctrl+E preview; the editor's `HighlightStyle` takes heading sizes
through `var()`. Heading steps and the block gap are em-relative, so a surface with its own
base keeps the same proportions. Nudging the editor's numbers toward the browser defaults
by hand was considered and left, since it drifts apart again on the next change.

## Links

- Key files: [`src/livePreview.ts`](../../src/livePreview.ts) (decorations and widgets),
  [`src/App.css`](../../src/App.css) (the `--mk-*` and `--md-*` tokens and the marker rules),
  [`src/markdown.ts`](../../src/markdown.ts) and [`src/Preview.tsx`](../../src/Preview.tsx)
  (the rendered pane), [`src/Tooltip.tsx`](../../src/Tooltip.tsx) (the hover target).
