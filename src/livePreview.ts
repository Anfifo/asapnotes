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
 * Obsidian-style live preview: markdown renders in place (sized headings, real
 * bold/italic, bullets, inline images) and the raw syntax only shows on lines
 * the cursor touches.
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

const hide = Decoration.replace({});
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
  const hideMark = (from: number, to: number, eatSpace = false) => {
    let end = to;
    if (eatSpace && doc.sliceString(end, end + 1) === " ") end++;
    if (end > from) decos.push(hide.range(from, end));
  };

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        switch (node.name) {
          case "HeaderMark":
            if (!onCursorLine(node.from, node.to)) hideMark(node.from, node.to, true);
            break;
          case "EmphasisMark":
          case "CodeMark":
          case "StrikethroughMark":
            if (!onCursorLine(node.from, node.to)) hideMark(node.from, node.to);
            break;
          case "QuoteMark":
            decos.push(quoteLine.range(doc.lineAt(node.from).from));
            if (!onCursorLine(node.from, node.to)) hideMark(node.from, node.to, true);
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
            if (onCursorLine(node.from, node.to)) break;
            for (let c = node.node.firstChild; c; c = c.nextSibling) {
              if (c.name === "LinkMark" || c.name === "URL" || c.name === "LinkTitle") {
                hideMark(c.from, c.to);
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
