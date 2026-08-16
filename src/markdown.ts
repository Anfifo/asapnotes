/**
 * The app's one markdown renderer. Both the preview pane and the canvas's
 * static text blocks read it, so a note and a block on a canvas render the same
 * markdown the same way — including how their images resolve.
 */

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

/** Markdown → HTML, with relative image links resolved against `noteDir`. */
export const renderMarkdown = (doc: string, noteDir: string) => md.render(doc, { noteDir });
