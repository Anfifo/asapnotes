import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import type { Range } from "@codemirror/state";
import { HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/**
 * Live preview: markdown renders in place (sized headings, real bold/italic,
 * lists, inline images). Syntax markers stay visible, but typeset in their own
 * right rather than inheriting the size and weight of the text they format, and
 * coloured by what they mean — structure, emphasis, literal. A heading's marks
 * stack into one cell and hang in the left gutter, so every line starts on the
 * same edge whatever its depth; a quote's `>` is drawn once, on the block's
 * opening line, centred on the rule that marks the rest. Both give way to the
 * real characters while the caret is there, so nothing is ever uneditable.
 * A list's marker is the character the note holds, moved into the cell the
 * rendered pane hangs its bullet in, so the two panes indent alike.
 */

const MONO = 'ui-monospace, "Cascadia Code", Consolas, monospace';

// A HighlightStyle is built once and can't be rebuilt per theme, so colors go
// through CSS variables (defined per theme in App.css) rather than being fixed
// here — otherwise every color has to compromise at one mid lightness that
// reads acceptably on both backgrounds and well on neither.
const markdownStyle = HighlightStyle.define([
  // Sizes and weights come from the shared markdown scale (App.css) so this
  // surface and the rendered preview read one set of numbers.
  { tag: t.heading1, fontSize: "var(--md-h1)", fontWeight: "var(--md-h-weight)" },
  { tag: t.heading2, fontSize: "var(--md-h2)", fontWeight: "var(--md-h-weight)" },
  { tag: t.heading3, fontSize: "var(--md-h3)", fontWeight: "var(--md-h-weight)" },
  { tag: t.heading4, fontWeight: "var(--md-h-weight)" },
  { tag: t.heading5, fontWeight: "var(--md-h-weight)" },
  { tag: t.heading6, fontWeight: "var(--md-h-weight)" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  {
    tag: t.monospace,
    fontFamily: MONO,
    fontSize: "0.9em",
    backgroundColor: "rgba(128, 128, 128, 0.15)",
    borderRadius: "3px",
  },
  { tag: t.link, color: "var(--syn-link)" },
  { tag: t.url, color: "var(--syn-muted)" },
  { tag: t.quote, color: "var(--syn-quote)" },
  { tag: t.processingInstruction, color: "var(--syn-marker)" },
  { tag: t.contentSeparator, color: "var(--syn-marker)" },
  // Code-block tokens (nested ```lang parses). Plain variableName gets a color
  // too: shell-ish languages (powershell, bash) tag bare commands as variables,
  // so without it whole command blocks render uncolored.
  { tag: t.keyword, color: "var(--syn-keyword)" },
  { tag: [t.string, t.special(t.string)], color: "var(--syn-string)" },
  { tag: t.comment, color: "var(--syn-comment)", fontStyle: "italic" },
  { tag: [t.number, t.bool, t.atom, t.null, t.regexp, t.escape], color: "var(--syn-number)" },
  { tag: [t.typeName, t.className, t.tagName], color: "var(--syn-type)" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--syn-link)" },
  { tag: [t.definition(t.variableName), t.propertyName], color: "var(--syn-property)" },
  { tag: t.variableName, color: "var(--syn-variable)" },
  { tag: [t.operator, t.punctuation, t.meta, t.labelName], color: "var(--syn-punct)" },
]);

/**
 * Marker characters stacked into a single cell, so a run of them costs one glyph
 * of width instead of one per character. The glyph shrinks as the run gets longer
 * so the stack always fits inside the line box: at a fixed size a level-6 heading
 * mark would stand taller than its line and collide with its neighbours.
 */
const stackGlyphSize = (count: number) => Math.min(10, Math.max(6, 19 / (0.55 * count)));

const glyphStack = (text: string, cls: string) => {
  const stack = document.createElement("span");
  stack.className = cls;
  stack.style.fontSize = `${stackGlyphSize(text.length)}px`;
  for (const ch of text) {
    const glyph = document.createElement("span");
    glyph.textContent = ch;
    stack.appendChild(glyph);
  }
  return stack;
};

/** A heading's marks, stacked and hung in the gutter at zero width. */
class HeadMarkWidget extends WidgetType {
  constructor(readonly level: number) {
    super();
  }
  eq(other: HeadMarkWidget) {
    return other.level === this.level;
  }
  toDOM() {
    const host = document.createElement("span");
    host.className = "cm-head-mark";
    host.appendChild(glyphStack("#".repeat(this.level), "cm-head-stack"));
    return host;
  }
}

/** An inline marker pair — `**`, `~~` — stacked in the flow. */
class MarkStackWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: MarkStackWidget) {
    return other.text === this.text;
  }
  toDOM() {
    return glyphStack(this.text, "cm-mark-stack");
  }
}

/** The `>` that opens a quote block, sitting on the axis of its rule. */
class QuoteMarkWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const host = document.createElement("span");
    host.className = "cm-quote-mark";
    const glyph = document.createElement("span");
    glyph.className = "cm-quote-glyph";
    glyph.textContent = ">";
    host.appendChild(glyph);
    return host;
  }
}

class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    /** The link as written in the note — what the annotation flow resolves. */
    readonly raw: string,
    readonly onOpen?: (raw: string) => void,
  ) {
    super();
  }
  eq(other: ImageWidget) {
    return other.src === this.src && other.raw === this.raw;
  }
  toDOM() {
    const img = document.createElement("img");
    img.className = "cm-live-image";
    img.src = this.src;
    img.dataset.rawSrc = this.raw;
    if (this.onOpen) {
      const onOpen = this.onOpen;
      const raw = this.raw;
      img.addEventListener("dblclick", (e) => {
        e.preventDefault();
        onOpen(raw);
      });
    }
    return img;
  }
  // Let clicks through so CodeMirror places the cursor (which reveals the syntax).
  ignoreEvent() {
    return false;
  }
}

// One class carries the marker's own type; the kind decides its colour.
const dimStructure = Decoration.mark({ class: "cm-syntax" });
const dimEmphasis = Decoration.mark({ class: "cm-syntax cm-mk-emphasis" });
const dimLiteral = Decoration.mark({ class: "cm-syntax cm-mk-literal" });
const quoteLine = Decoration.line({ class: "cm-blockquote" });
const codeLine = Decoration.line({ class: "cm-codeline" });
const gapLine = Decoration.line({ class: "cm-md-gap" });

// A list marker keeps its own character but takes a fixed cell, so `-`, `*`,
// `+` and `10.` all end on the same edge and the text after them never shifts.
const listMark = Decoration.mark({ class: "cm-list-mark" });
const listBullet = Decoration.mark({ class: "cm-list-mark cm-list-bullet" });
// Whitespace the indent replaces. Hidden rather than removed: it is still the
// note's own text, so it still selects, deletes and takes a typed space.
const hidden = Decoration.replace({});

/**
 * The label of a link whose target is collapsed. Carries the target as `data-tip`
 * so the app's own tooltip shows it after its dwell — no second tooltip to build,
 * and no reflow under the pointer the way an inline expansion would cause.
 */
const linkTip = (target: string) => Decoration.mark({ attributes: { "data-tip": target } });

/**
 * A list indents by how deeply it nests, not by however many spaces were typed
 * — which is what the rendered pane does, and two spaces or four make the same
 * level there. `hang` pulls the marker back into the step it opens, so wrapped
 * lines line up under the item's text instead of under its bullet.
 */
const listLine = (depth: number, hang: boolean) =>
  Decoration.line({
    attributes: {
      style:
        `padding-left:calc(var(--md-list-step) * ${depth})` +
        (hang ? ";text-indent:calc(var(--md-list-step) * -1)" : ""),
    },
  });

/** Structural type, so the depth walk needs no direct @lezer/common dependency. */
type Ancestry = { name: string; parent: Ancestry | null };

const listDepth = (node: Ancestry) => {
  let depth = 0;
  for (let p = node.parent; p; p = p.parent) {
    if (p.name === "BulletList" || p.name === "OrderedList") depth++;
  }
  return depth;
};

function buildDecorations(
  view: EditorView,
  resolveImage: (src: string) => string,
  onImageOpen?: (raw: string) => void,
): DecorationSet {
  const decos: Range<Decoration>[] = [];
  const { doc, selection } = view.state;

  const cursorLines = new Set<number>();
  for (const r of selection.ranges) {
    for (let n = doc.lineAt(r.from).number; n <= doc.lineAt(r.to).number; n++) cursorLines.add(n);
  }
  const onCursorLine = (from: number, to: number) => {
    for (let n = doc.lineAt(from).number; n <= doc.lineAt(to).number; n++) {
      if (cursorLines.has(n)) return true;
    }
    return false;
  };
  // Tighter than onCursorLine: a line holding three links only opens the one the
  // caret is actually in. Touching either end counts, so the caret parked just
  // after a link can still edit it.
  const onNode = (from: number, to: number) =>
    selection.ranges.some((r) => r.from <= to && r.to >= from);
  const dimMark = (from: number, to: number, kind: Decoration) => {
    if (to > from) decos.push(kind.range(from, to));
  };
  // A mark that leaves the flow takes its trailing space with it, or the space is
  // left behind as a stray indent.
  const withSpace = (to: number) => (doc.sliceString(to, to + 1) === " " ? to + 1 : to);

  // Quote blocks, so a `>` can tell whether it opens one and whether the caret is
  // inside it. Recorded on the way through rather than tracked as a stack: the
  // opening mark is identified by its line, which does not depend on how much of
  // the block is currently on screen.
  const quotes: { from: number; to: number; active: boolean }[] = [];
  const enclosingQuote = (pos: number) => {
    for (let i = quotes.length - 1; i >= 0; i--) {
      if (quotes[i].from <= pos && pos < quotes[i].to) return quotes[i];
    }
    return undefined;
  };

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        switch (node.name) {
          case "EmphasisMark":
          case "StrikethroughMark": {
            const mark = doc.sliceString(node.from, node.to);
            // A single character has nothing to stack, and the caret's own line
            // shows the real characters so a pair stays editable by typing.
            if (mark.length < 2 || onCursorLine(node.from, node.to)) {
              dimMark(node.from, node.to, dimEmphasis);
              break;
            }
            decos.push(
              Decoration.replace({ widget: new MarkStackWidget(mark) }).range(node.from, node.to),
            );
            break;
          }
          case "CodeMark":
            dimMark(node.from, node.to, dimLiteral);
            break;
          case "HeaderMark": {
            const mark = doc.sliceString(node.from, node.to);
            // A setext heading is underlined with = or -, which is not a level
            // count and has nothing to stack.
            if (!mark.startsWith("#")) {
              dimMark(node.from, node.to, dimStructure);
              break;
            }
            decos.push(gapLine.range(doc.lineAt(node.from).from));
            // The caret's own line shows the real characters, so a heading's
            // level stays editable by typing rather than only by selection.
            if (onCursorLine(node.from, node.to)) {
              dimMark(node.from, node.to, dimStructure);
              break;
            }
            decos.push(
              Decoration.replace({ widget: new HeadMarkWidget(mark.length) }).range(
                node.from,
                withSpace(node.to),
              ),
            );
            break;
          }
          case "Blockquote":
            quotes.push({
              from: node.from,
              to: node.to,
              active: onCursorLine(node.from, node.to),
            });
            break;
          case "QuoteMark": {
            decos.push(quoteLine.range(doc.lineAt(node.from).from));
            const block = enclosingQuote(node.from);
            // Every `>` in the block comes back while the caret is inside it.
            if (!block || block.active) {
              dimMark(node.from, node.to, dimLiteral);
              break;
            }
            const opens = doc.lineAt(node.from).number === doc.lineAt(block.from).number;
            decos.push(
              (opens
                ? Decoration.replace({ widget: new QuoteMarkWidget() })
                : // Undrawn: the unbroken rule is what marks a continuation line.
                  Decoration.replace({})
              ).range(node.from, withSpace(node.to)),
            );
            break;
          }
          case "ListItem": {
            // Lines the item carries below its marker — a hard-wrapped sentence,
            // a second paragraph — indent with it. Lines a nested list owns take
            // their indent from their own marker instead.
            const first = doc.lineAt(node.from).number;
            const last = doc.lineAt(node.to).number;
            if (last === first) break;
            const nested: [number, number][] = [];
            for (let c = node.node.firstChild; c; c = c.nextSibling) {
              if (c.name === "BulletList" || c.name === "OrderedList") {
                nested.push([doc.lineAt(c.from).number, doc.lineAt(c.to).number]);
              }
            }
            const depth = listDepth(node.node);
            for (let n = first + 1; n <= last; n++) {
              if (nested.some(([a, b]) => n >= a && n <= b)) continue;
              const line = doc.line(n);
              decos.push(listLine(depth, false).range(line.from));
              const indent = line.text.length - line.text.trimStart().length;
              if (indent > 0) decos.push(hidden.range(line.from, line.from + indent));
            }
            break;
          }
          case "ListMark": {
            const line = doc.lineAt(node.from);
            const mark = doc.sliceString(node.from, node.to);
            decos.push(listLine(listDepth(node.node), true).range(line.from));
            // The typed indent gave the depth; the cell draws it from here on.
            if (node.from > line.from) decos.push(hidden.range(line.from, node.from));
            decos.push((/^[-*+]$/.test(mark) ? listBullet : listMark).range(node.from, node.to));
            // The gap to the text is the cell's, so however wide the note wrote
            // it, every item's text starts on the same edge.
            let gap = node.to;
            while (doc.sliceString(gap, gap + 1) === " ") gap++;
            if (gap > node.to) decos.push(hidden.range(node.to, gap));
            break;
          }
          case "Link": {
            const marks: { from: number; to: number }[] = [];
            let close: { from: number; to: number } | undefined;
            let url: { from: number; to: number } | undefined;
            let title: { from: number; to: number } | undefined;
            for (let c = node.node.firstChild; c; c = c.nextSibling) {
              if (c.name === "LinkMark") {
                marks.push({ from: c.from, to: c.to });
                if (doc.sliceString(c.from, c.to) === "]") close = { from: c.from, to: c.to };
              } else if (c.name === "URL") {
                url = { from: c.from, to: c.to };
              } else if (c.name === "LinkTitle") {
                title = { from: c.from, to: c.to };
              }
            }
            // While reading, an inline link's target is noise — the label already
            // says where it goes. It comes back whole with the caret inside the
            // link, and one hover dwell away meanwhile. A reference link
            // (`[label][ref]`) has no URL of its own, so it is left as it was.
            if (url && close && !onNode(node.from, node.to)) {
              // The brackets stay, so a link still reads as a link rather than
              // as ordinary prose.
              for (const m of marks) if (m.to <= close.to) dimMark(m.from, m.to, dimLiteral);
              decos.push(linkTip(doc.sliceString(url.from, url.to)).range(node.from, close.to));
              decos.push(hidden.range(close.to, node.to));
              return false;
            }
            for (const m of marks) dimMark(m.from, m.to, dimLiteral);
            if (url) dimMark(url.from, url.to, dimLiteral);
            if (title) dimMark(title.from, title.to, dimLiteral);
            return false;
          }
          case "Image": {
            if (onCursorLine(node.from, node.to)) break;
            const url = node.node.getChild("URL");
            if (url) {
              const raw = doc.sliceString(url.from, url.to);
              decos.push(
                Decoration.replace({
                  widget: new ImageWidget(resolveImage(raw), raw, onImageOpen),
                }).range(node.from, node.to),
              );
              return false;
            }
            break;
          }
          case "FencedCode": {
            const last = doc.lineAt(node.to).number;
            for (let n = doc.lineAt(node.from).number; n <= last; n++) {
              decos.push(codeLine.range(doc.line(n).from));
            }
            break;
          }
        }
      },
    });
  }
  return Decoration.set(decos, true);
}

export function livePreview(
  resolveImage: (src: string) => string,
  onImageOpen?: (raw: string) => void,
) {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, resolveImage, onImageOpen);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = buildDecorations(update.view, resolveImage, onImageOpen);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
  return [syntaxHighlighting(markdownStyle), plugin];
}
