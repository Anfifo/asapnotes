import { useMemo } from "react";
import { renderMarkdown } from "./markdown";

interface PreviewProps {
  doc: string;
  /** Absolute directory of the open note (notes root, or root/project). */
  noteDir: string;
}

export function Preview({ doc, noteDir }: PreviewProps) {
  const html = useMemo(() => renderMarkdown(doc, noteDir), [doc, noteDir]);
  return <div className="preview" dangerouslySetInnerHTML={{ __html: html }} />;
}
