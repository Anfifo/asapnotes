/**
 * The app's one markdown renderer. Both the preview pane and the canvas's
 * static text blocks read it, so a note and a block on a canvas render the same
 * markdown the same way — including how their images resolve.
 */

import MarkdownIt from "markdown-it";
import { convertFileSrc } from "@tauri-apps/api/core";
import { bustAsset } from "./assetVersions";
import { resolvePath } from "./paths";

// html:false (the default) keeps raw HTML in notes escaped, so no sanitizer
// is needed for our own rendered output.
const md = new MarkdownIt({ linkify: true });

const defaultImage =
  md.renderer.rules.image ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

// Relative image links (assets/…, ../assets/…) resolve against the note's own
// directory and go through Tauri's asset protocol so the webview can load them.
// The raw link rides along as a data attribute, so a rendered image can be
// traced back to its file — the annotation entry points need the path, and
// the resolved URL no longer carries it readably.
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const src = String(token.attrGet("src") ?? "");
  const noteDir = (env as { noteDir?: string }).noteDir;
  if (noteDir && src && !/^[a-z][a-z0-9+.-]*:/i.test(src)) {
    const abs = resolvePath(noteDir, src);
    token.attrSet("src", bustAsset(abs, convertFileSrc(abs)));
    token.attrSet("data-raw-src", src);
  }
  return defaultImage(tokens, idx, options, env, self);
};

/** Markdown → HTML, with relative image links resolved against `noteDir`. */
export const renderMarkdown = (doc: string, noteDir: string) => md.render(doc, { noteDir });
