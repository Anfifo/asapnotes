/**
 * The app's one markdown renderer, behind the preview pane — kept as the single
 * place markdown becomes HTML, including how images resolve.
 */

import MarkdownIt from "markdown-it";
import { convertFileSrc } from "@tauri-apps/api/core";
import { resolvePath } from "./paths";

// html:false (the default) keeps raw HTML in notes escaped, so the rendered
// output needs no sanitizer.
const md = new MarkdownIt({ linkify: true });

// Every block carries the source line it starts on, so the rendered pane can
// open on the line the editor was showing and report which line it shows when
// the editor comes back.
md.core.ruler.push("source_line", (state) => {
  for (const token of state.tokens) {
    if (token.map && token.nesting >= 0 && token.type !== "inline") {
      token.attrSet("data-line", String(token.map[0] + 1));
    }
  }
});

const defaultImage =
  md.renderer.rules.image ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

// Relative image links (assets/…, ../assets/…) resolve against the note's own
// directory and go through Tauri's asset protocol so the webview can load them.
// The raw link rides along as a data attribute, so a rendered image can be
// traced back to its file — the resolved URL doesn't carry it readably.
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const src = String(token.attrGet("src") ?? "");
  const noteDir = (env as { noteDir?: string }).noteDir;
  if (noteDir && src && !/^[a-z][a-z0-9+.-]*:/i.test(src)) {
    token.attrSet("src", convertFileSrc(resolvePath(noteDir, src)));
    token.attrSet("data-raw-src", src);
  }
  return defaultImage(tokens, idx, options, env, self);
};

/** Markdown → HTML, with relative image links resolved against `noteDir`. */
export const renderMarkdown = (doc: string, noteDir: string) => md.render(doc, { noteDir });
