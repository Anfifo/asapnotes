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
 * bullets, inline images). Syntax markers are never hidden — they stay visible
 * but dimmed (.cm-syntax) so it's always clear where formatting starts/ends.
 */

const MONO = 'ui-monospace, "Cascadia Code", Consolas, monospace';

// Colors are picked to read on both the light and dark app backgrounds, since
// a HighlightStyle can't switch with the media query.
const markdownStyle = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.5em", fontWeight: "700" },
  { tag: t.heading2, fontSize: "1.3em", fontWeight: "700" },
  { tag: t.heading3, fontSize: "1.15em", fontWeight: "600" },
  { tag: t.heading4, fontWeight: "600" },
  { tag: t.heading5, fontWeight: "600" },
  { tag: t.heading6, fontWeight: "600" },
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
  { tag: t.link, color: "#4a7dc9" },
  { tag: t.url, color: "#8a8a8a" },
  { tag: t.quote, color: "#8a8a8a" },
  { tag: t.processingInstruction, color: "#9a9a9a" },
  { tag: t.contentSeparator, color: "#9a9a9a" },
  // Code-block tokens (nested ```lang parses) — same both-theme constraint,
  // so every color sits at mid lightness. Plain variableName gets a color too:
  // shell-ish languages (powershell, bash) tag bare commands as variables, so
  // without it whole command blocks render uncolored.
  { tag: t.keyword, color: "#b05ccc" },
  { tag: [t.string, t.special(t.string)], color: "#54a054" },
  { tag: t.comment, color: "#8a8a8a", fontStyle: "italic" },
  { tag: [t.number, t.bool, t.atom, t.null, t.regexp, t.escape], color: "#c9822d" },
  { tag: [t.typeName, t.className, t.tagName], color: "#2f9c95" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#4a7dc9" },
  { tag: [t.definition(t.variableName), t.propertyName], color: "#8f6fd0" },
  { tag: t.variableName, color: "#5b8bd0" },
  { tag: [t.operator, t.punctuation, t.meta, t.labelName], color: "#8a8a8a" },
]);

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-bullet";
    span.textContent = "•";
    return span;
  }
}

class ImageWidget extends WidgetType {
  constructor(readonly src: string) {
    super();
  }
  eq(other: ImageWidget) {
    return other.src === this.src;
  }
  toDOM() {
    const img = document.createElement("img");
    img.className = "cm-live-image";
    img.src = this.src;
    return img;
  }
  // Let clicks through so CodeMirror places the cursor (which reveals the syntax).
  ignoreEvent() {
    return false;
  }
}

const dim = Decoration.mark({ class: "cm-syntax" });
const quoteLine = Decoration.line({ class: "cm-blockquote" });
const codeLine = Decoration.line({ class: "cm-codeline" });

function buildDecorations(view: EditorView, resolveImage: (src: string) => string): DecorationSet {
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
  const dimMark = (from: number, to: number) => {
    if (to > from) decos.push(dim.range(from, to));
  };

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        switch (node.name) {
          case "HeaderMark":
          case "EmphasisMark":
          case "CodeMark":
          case "StrikethroughMark":
            dimMark(node.from, node.to);
            break;
          case "QuoteMark":
            decos.push(quoteLine.range(doc.lineAt(node.from).from));
            dimMark(node.from, node.to);
            break;
          case "ListMark": {
            const mark = doc.sliceString(node.from, node.to);
            if (/^[-*+]$/.test(mark) && !onCursorLine(node.from, node.to)) {
              decos.push(
                Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to),
              );
            }
            break;
          }
          case "Link": {
            for (let c = node.node.firstChild; c; c = c.nextSibling) {
              if (c.name === "LinkMark" || c.name === "URL" || c.name === "LinkTitle") {
                dimMark(c.from, c.to);
              }
            }
            return false;
          }
          case "Image": {
            if (onCursorLine(node.from, node.to)) break;
            const url = node.node.getChild("URL");
            if (url) {
              decos.push(
                Decoration.replace({
                  widget: new ImageWidget(resolveImage(doc.sliceString(url.from, url.to))),
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

export function livePreview(resolveImage: (src: string) => string) {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, resolveImage);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = buildDecorations(update.view, resolveImage);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
  return [syntaxHighlighting(markdownStyle), plugin];
}
