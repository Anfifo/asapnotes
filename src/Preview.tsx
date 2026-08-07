import { useMemo } from "react";
import MarkdownIt from "markdown-it";
import { convertFileSrc } from "@tauri-apps/api/core";
import { resolvePath } from "./paths";

// html:false (the default) keeps raw HTML in notes escaped, so no sanitizer
// is needed for our own rendered output.
const md = new MarkdownIt({ linkify: true });

const defaultImage =
  md.renderer.rules.image ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

// Relative image links (assets/…, ../assets/…) resolve against the note's own
// directory and go through Tauri's asset protocol so the webview can load them.
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const src = String(token.attrGet("src") ?? "");
  const noteDir = (env as { noteDir?: string }).noteDir;
  if (noteDir && src && !/^[a-z][a-z0-9+.-]*:/i.test(src)) {
    token.attrSet("src", convertFileSrc(resolvePath(noteDir, src)));
  }
  return defaultImage(tokens, idx, options, env, self);
};

interface PreviewProps {
  doc: string;
  /** Absolute directory of the open note (notes root, or root/project). */
  noteDir: string;
}

export function Preview({ doc, noteDir }: PreviewProps) {
  const html = useMemo(() => md.render(doc, { noteDir }), [doc, noteDir]);
  return <div className="preview" dangerouslySetInnerHTML={{ __html: html }} />;
}
