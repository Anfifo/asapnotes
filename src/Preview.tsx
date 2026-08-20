import { useMemo } from "react";
import { renderMarkdown } from "./markdown";

interface PreviewProps {
  doc: string;
  /** Absolute directory of the open note (notes root, or root/project). */
  noteDir: string;
  /** Double-click on a rendered image — the annotation entry point. Gets the
   * link as written in the note. */
  onImageOpen?: (src: string) => void;
}

export function Preview({ doc, noteDir, onImageOpen }: PreviewProps) {
  const html = useMemo(() => renderMarkdown(doc, noteDir), [doc, noteDir]);
  return (
    <div
      className="preview"
      onDoubleClick={(e) => {
        const raw = (e.target as HTMLElement).closest("img")?.dataset.rawSrc;
        if (raw && onImageOpen) onImageOpen(raw);
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
