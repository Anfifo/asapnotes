import { useLayoutEffect, useMemo, useRef } from "react";
import { renderMarkdown } from "./markdown";

interface PreviewProps {
  doc: string;
  /** Absolute directory of the open note (notes root, or root/project). */
  noteDir: string;
  /** Source line to open on — the one the editor had at its top edge. */
  line: number;
  /** Reports the source line at the top edge as the pane goes away, so the
   * editor can come back to the same place. */
  onLeave: (line: number) => void;
  /** Follow a clicked link's target as written in the note. */
  onOpenLink: (target: string) => void;
}

// Blocks carry their source line (markdown.ts); document order is also line
// order, and a block precedes the blocks nested in it.
const blocks = (pane: HTMLElement) => Array.from(pane.querySelectorAll<HTMLElement>("[data-line]"));
const lineOf = (block: HTMLElement) => Number(block.dataset.line);

// The top edge is where the first block rests when the pane is scrolled to the
// top — under the padding — so a swap at line 1 leaves the pane where it opens.
const topEdge = (pane: HTMLElement) =>
  pane.getBoundingClientRect().top + parseFloat(getComputedStyle(pane).paddingTop);

/** Scroll so the innermost block that starts at or before `line` sits at the top edge. */
function scrollToLine(pane: HTMLElement, line: number) {
  let target: HTMLElement | undefined;
  for (const block of blocks(pane)) {
    if (lineOf(block) > line) break;
    target = block;
  }
  if (!target) return;
  pane.scrollTop += target.getBoundingClientRect().top - topEdge(pane);
}

/** Source line of the innermost block under the pane's top edge — or, when the
 * edge falls in the gap between blocks, of the first block below it. */
function topLine(pane: HTMLElement) {
  const edge = topEdge(pane) + 1;
  let found: HTMLElement | undefined;
  for (const block of blocks(pane)) {
    const rect = block.getBoundingClientRect();
    if (rect.bottom <= edge) continue;
    if (rect.top > edge) {
      found ??= block;
      break;
    }
    found = block;
  }
  return found ? lineOf(found) : 1;
}

export function Preview({ doc, noteDir, line, onLeave, onOpenLink }: PreviewProps) {
  const paneRef = useRef<HTMLDivElement>(null);
  const html = useMemo(() => renderMarkdown(doc, noteDir), [doc, noteDir]);
  // A rendered link is a real anchor, and the window has no browser chrome: left
  // to itself a click would navigate the whole app away with no way back. The
  // target is taken as written so notes open in-app and the rest goes to the OS.
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as Element).closest("a[href]");
    if (!anchor) return;
    e.preventDefault();
    onOpenLink(anchor.getAttribute("href") ?? "");
  };
  // Layout effect on both ends: the pane has to be laid out to be scrolled,
  // and it has to still be in the document to be read on the way out.
  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    scrollToLine(pane, line);
    return () => onLeave(topLine(pane));
    // Placement happens once, when the pane opens; scrolling after that is the reader's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      ref={paneRef}
      className="preview"
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
