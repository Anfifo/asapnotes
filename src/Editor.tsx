import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { EditorSelection, EditorState, Prec } from "@codemirror/state";
import { indentWithTab, redo } from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { minimalSetup } from "codemirror";
import { livePreview } from "./livePreview";
import { MentionItem, mentions } from "./mentions";

export type FormatKind =
  | "h1"
  | "h2"
  | "h3"
  | "bold"
  | "italic"
  | "code"
  | "codeblock"
  | "bullet"
  | "numbered"
  | "quote"
  | "link";

export interface EditorHandle {
  focus: () => void;
  applyFormat: (kind: FormatKind) => void;
  /** Insert text at the cursor (used for image links from drag-drop). */
  insertText: (text: string) => void;
}

interface EditorProps {
  /** Identity of the open document — the editor is rebuilt when this changes. */
  docKey: string;
  initialDoc: string;
  onChange: (doc: string) => void;
  /** Persist a pasted image; resolves to the note-relative link path, or null. */
  onPasteImage: (file: File) => Promise<string | null>;
  /** Resolve an image src from the doc to a URL the webview can load. */
  resolveImage: (src: string) => string;
  /** Notes offered by the `@`-mention dropdown. */
  mentionItems: MentionItem[];
  /** Markdown link inserted when a mention is accepted. */
  mentionLink: (id: string) => string;
  /** Hide instead of unmounting (preview mode) so undo history survives. */
  hidden?: boolean;
}

/** Toggle `marker` (e.g. `**`) around each selection range. */
function toggleWrap(view: EditorView, marker: string): boolean {
  const { state } = view;
  const tr = state.changeByRange((range) => {
    const { from, to } = range;
    const before = state.sliceDoc(Math.max(0, from - marker.length), from);
    const after = state.sliceDoc(to, Math.min(state.doc.length, to + marker.length));
    if (before === marker && after === marker) {
      return {
        changes: [
          { from: from - marker.length, to: from },
          { from: to, to: to + marker.length },
        ],
        range: EditorSelection.range(from - marker.length, to - marker.length),
      };
    }
    const inner = state.sliceDoc(from, to);
    if (inner.length >= marker.length * 2 && inner.startsWith(marker) && inner.endsWith(marker)) {
      return {
        changes: { from, to, insert: inner.slice(marker.length, inner.length - marker.length) },
        range: EditorSelection.range(from, to - marker.length * 2),
      };
    }
    return {
      changes: [
        { from, insert: marker },
        { from: to, insert: marker },
      ],
      range: EditorSelection.range(from + marker.length, to + marker.length),
    };
  });
  view.dispatch(tr, { scrollIntoView: true, userEvent: "input" });
  return true;
}

/**
 * Toggle a line prefix (`# `, `- `, `> `…) on every line the main selection
 * touches. Headings replace an existing heading prefix instead of stacking.
 */
function toggleLinePrefix(view: EditorView, prefix: string, isHeading = false): boolean {
  const { state } = view;
  const range = state.selection.main;
  const startLine = state.doc.lineAt(range.from).number;
  const endLine = state.doc.lineAt(range.to).number;
  let allPrefixed = true;
  for (let n = startLine; n <= endLine; n++) {
    if (!state.doc.line(n).text.startsWith(prefix)) allPrefixed = false;
  }
  const changes = [];
  for (let n = startLine; n <= endLine; n++) {
    const line = state.doc.line(n);
    if (allPrefixed) {
      changes.push({ from: line.from, to: line.from + prefix.length });
    } else {
      let to = line.from;
      if (isHeading) {
        const existing = line.text.match(/^#{1,6} /);
        if (existing) to = line.from + existing[0].length;
      }
      changes.push({ from: line.from, to, insert: prefix });
    }
  }
  view.dispatch({ changes, scrollIntoView: true, userEvent: "input" });
  return true;
}

function wrapCodeBlock(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.main;
  const start = state.doc.lineAt(range.from).from;
  const end = state.doc.lineAt(range.to).to;
  view.dispatch({
    changes: [
      { from: start, insert: "```\n" },
      { from: end, insert: "\n```" },
    ],
    scrollIntoView: true,
    userEvent: "input",
  });
  return true;
}

function insertLink(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.main;
  const text = state.sliceDoc(range.from, range.to) || "text";
  const urlStart = range.from + text.length + 3; // past `[text](`
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: `[${text}](url)` },
    selection: { anchor: urlStart, head: urlStart + 3 },
    scrollIntoView: true,
    userEvent: "input",
  });
  return true;
}

function applyFormat(view: EditorView, kind: FormatKind): boolean {
  switch (kind) {
    case "h1":
      return toggleLinePrefix(view, "# ", true);
    case "h2":
      return toggleLinePrefix(view, "## ", true);
    case "h3":
      return toggleLinePrefix(view, "### ", true);
    case "bold":
      return toggleWrap(view, "**");
    case "italic":
      return toggleWrap(view, "*");
    case "code":
      return toggleWrap(view, "`");
    case "codeblock":
      return wrapCodeBlock(view);
    case "bullet":
      return toggleLinePrefix(view, "- ");
    case "numbered":
      return toggleLinePrefix(view, "1. ");
    case "quote":
      return toggleLinePrefix(view, "> ");
    case "link":
      return insertLink(view);
  }
}

function insertAtCursor(view: EditorView, text: string) {
  const { to } = view.state.selection.main;
  view.dispatch({
    changes: { from: to, insert: text },
    selection: { anchor: to + text.length },
    scrollIntoView: true,
    userEvent: "input",
  });
}

const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
  { docKey, initialDoc, onChange, onPasteImage, resolveImage, mentionItems, mentionLink, hidden },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onPasteImageRef = useRef(onPasteImage);
  onPasteImageRef.current = onPasteImage;
  const resolveImageRef = useRef(resolveImage);
  resolveImageRef.current = resolveImage;
  const mentionItemsRef = useRef(mentionItems);
  mentionItemsRef.current = mentionItems;
  const mentionLinkRef = useRef(mentionLink);
  mentionLinkRef.current = mentionLink;
  const initialDocRef = useRef(initialDoc);
  initialDocRef.current = initialDoc;

  useImperativeHandle(
    ref,
    () => ({
      focus: () => viewRef.current?.focus(),
      applyFormat: (kind: FormatKind) => {
        const view = viewRef.current;
        if (!view) return;
        applyFormat(view, kind);
        view.focus();
      },
      insertText: (text: string) => {
        const view = viewRef.current;
        if (!view) return;
        insertAtCursor(view, text);
        view.focus();
      },
    }),
    [],
  );

  useEffect(() => {
    const view = new EditorView({
      state: EditorState.create({
        doc: initialDocRef.current,
        extensions: [
          minimalSetup,
          // codeLanguages makes ```lang fences parse with the real language
          // (lazy-loaded), so the highlight style has tokens to color.
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          livePreview((src) => resolveImageRef.current(src)),
          mentions(
            () => mentionItemsRef.current,
            (id) => mentionLinkRef.current(id),
          ),
          EditorView.lineWrapping,
          placeholder("Capture a thought…"),
          Prec.high(
            keymap.of([
              { key: "Mod-b", run: (v) => applyFormat(v, "bold") },
              { key: "Mod-i", run: (v) => applyFormat(v, "italic") },
              { key: "Mod-1", run: (v) => applyFormat(v, "h1") },
              { key: "Mod-2", run: (v) => applyFormat(v, "h2") },
              { key: "Mod-3", run: (v) => applyFormat(v, "h3") },
              { key: "Mod-Shift-c", run: (v) => applyFormat(v, "code") },
              { key: "Mod-Shift-k", run: (v) => applyFormat(v, "codeblock") },
              // Docs/Word convention for lists; quote continues the row.
              { key: "Mod-Shift-8", run: (v) => applyFormat(v, "bullet") },
              { key: "Mod-Shift-7", run: (v) => applyFormat(v, "numbered") },
              { key: "Mod-Shift-9", run: (v) => applyFormat(v, "quote") },
              // Ctrl+K (the usual link binding) is the command palette.
              { key: "Mod-Shift-l", run: (v) => applyFormat(v, "link") },
            ]),
          ),
          // minimalSetup already binds undo (Mod-z) and redo (Mod-y); this adds
          // find (Mod-f), the Mod-Shift-z redo alias, and Tab list indenting.
          keymap.of([...searchKeymap, indentWithTab, { key: "Mod-Shift-z", run: redo }]),
          EditorView.domEventHandlers({
            paste: (event, v) => {
              const files = Array.from(event.clipboardData?.files ?? []);
              const images = files.filter((f) => f.type.startsWith("image/"));
              if (images.length === 0) return false;
              event.preventDefault();
              void (async () => {
                for (const image of images) {
                  const rel = await onPasteImageRef.current(image);
                  if (rel) insertAtCursor(v, `![](${rel})\n`);
                }
              })();
              return true;
            },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
      parent: containerRef.current!,
    });
    viewRef.current = view;
    view.focus();
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Rebuild only when a different document opens; `initialDoc` tracks live
    // edits between renders and must not reset the editor.
  }, [docKey]);

  return <div ref={containerRef} className="editor" hidden={hidden} />;
});

export default Editor;
