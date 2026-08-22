import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import type { Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

/**
 * Ctrl+Click link following, for every editor (markdown and plain text alike):
 * bare URLs and absolute Windows paths anywhere in the text, plus markdown
 * link destinations (relative note paths included). Holding Ctrl underlines
 * the targets; a plain click still just places the cursor, so editing a link
 * is never hijacked.
 */

const URL_RE = /(?:https?:\/\/|mailto:)[^\s<>"']+/gi;
const PATH_RE = /[a-z]:[\\/][^\s<>"'|?*]+/gi;

/** Trailing prose punctuation is not part of the target; a final `)` stays
 * only when the match has an opening `(` — some URLs carry balanced parens. */
function trimTarget(m: string): string {
  let s = m.replace(/[.,;:!?'"”’]+$/, "");
  while (s.endsWith(")") && !s.includes("(")) s = s.slice(0, -1);
  return s;
}

interface Candidate {
  from: number;
  to: number;
  target: string;
}

function markOf(target: string) {
  return Decoration.mark({ class: "cm-linkable", attributes: { "data-link": target } });
}

function buildDecorations(view: EditorView): DecorationSet {
  const { doc } = view.state;
  const found: Candidate[] = [];

  for (const { from, to } of view.visibleRanges) {
    // Markdown link destinations (skipped silently in plain text — the tree
    // has no URL nodes there). Images excluded: their URL is replaced by the
    // rendered image most of the time anyway.
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== "URL" || node.node.parent?.name === "Image") return;
        let s = node.from;
        let e = node.to;
        if (doc.sliceString(s, s + 1) === "<" && doc.sliceString(e - 1, e) === ">") {
          s++;
          e--;
        }
        if (e > s) found.push({ from: s, to: e, target: doc.sliceString(s, e) });
      },
    });
    const text = doc.sliceString(from, to);
    for (const re of [URL_RE, PATH_RE]) {
      re.lastIndex = 0;
      for (let m = re.exec(text); m; m = re.exec(text)) {
        const target = trimTarget(m[0]);
        if (target.length > 0)
          found.push({ from: from + m.index, to: from + m.index + target.length, target });
      }
    }
  }

  // Regex and tree passes overlap on absolute markdown destinations — keep
  // the first span at each position and drop anything overlapping it.
  found.sort((a, b) => a.from - b.from || b.to - a.to);
  const decos: Range<Decoration>[] = [];
  let end = -1;
  for (const c of found) {
    if (c.from < end) continue;
    decos.push(markOf(c.target).range(c.from, c.to));
    end = c.to;
  }
  return Decoration.set(decos);
}

export function linkify(onOpen: (target: string) => void) {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      private onKey = (e: KeyboardEvent) => this.view.dom.classList.toggle("cm-ctrl", e.ctrlKey);
      private onBlur = () => this.view.dom.classList.remove("cm-ctrl");
      constructor(readonly view: EditorView) {
        this.decorations = buildDecorations(view);
        // Window-level so the underline appears even before the editor is
        // focused; blur clears it (Ctrl released outside the window).
        window.addEventListener("keydown", this.onKey);
        window.addEventListener("keyup", this.onKey);
        window.addEventListener("blur", this.onBlur);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildDecorations(update.view);
        }
      }
      destroy() {
        window.removeEventListener("keydown", this.onKey);
        window.removeEventListener("keyup", this.onKey);
        window.removeEventListener("blur", this.onBlur);
      }
    },
    { decorations: (v) => v.decorations },
  );
  const click = EditorView.domEventHandlers({
    mousedown: (event) => {
      if (!event.ctrlKey || event.button !== 0) return false;
      const el = (event.target as HTMLElement).closest?.("[data-link]");
      const target = el?.getAttribute("data-link");
      if (!target) return false;
      event.preventDefault();
      onOpen(target);
      return true;
    },
  });
  return [plugin, click];
}
