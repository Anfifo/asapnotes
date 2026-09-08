import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { EditorSelection, EditorState, Prec } from "@codemirror/state";
import { indentWithTab, redo, selectAll, undo } from "@codemirror/commands";
import { gotoLine, openSearchPanel, searchKeymap } from "@codemirror/search";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { minimalSetup } from "codemirror";
import { linkify } from "./links";
import { livePreview } from "./livePreview";
import { MentionItem, mentions } from "./mentions";
import type { Feature, ViewId } from "./noteTypes";

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

/** Editing verbs the menus and context menus drive from outside. */
export type EditorCommand =
  "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll" | "find" | "replace" | "gotoLine";

export interface EditorStatus {
  line: number;
  col: number;
  /** Characters covered by the selection (0 = plain cursor). */
  selected: number;
  words: number;
}

export interface EditorHandle {
  focus: () => void;
  applyFormat: (kind: FormatKind) => void;
  exec: (cmd: EditorCommand) => void;
  /** Insert text at the cursor, or at the document position under viewport
   * point `at` when one is given (a drop) — the cursor moves there first. */
  insertText: (text: string, at?: { x: number; y: number }) => void;
  /** Insert text at the end of `line` (1-based, clamped to the document); the
   * cursor stays where it was. */
  insertAfterLine: (line: number, text: string) => void;
  /** Replace the whole document in place (external-change reload): keeps the
   * editor mounted, clamps the cursor, and does NOT fire onChange — a reload
   * must not mark the buffer dirty or spawn a draft. */
  setDoc: (text: string) => void;
  /** Put the cursor at the start of `line` (1-based) and scroll it into view —
   * the jump-to behind a search result. */
  revealLine: (line: number) => void;
  /** The line (1-based) at the top edge of the viewport — what a pane swap
   * hands over so the other pane opens on the same place. */
  topLine: () => number;
  /** Scroll so `line` (1-based) sits at the top edge; the cursor stays put. */
  scrollToLine: (line: number) => void;
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
  /** Follow a Ctrl+Clicked URL / file path / markdown link destination. */
  onOpenLink: (target: string) => void;
  /** Cursor / selection / word-count updates for the status bar; null on
   * unmount, so the readout clears when no editor is showing. */
  onStatus?: (status: EditorStatus | null) => void;
  /** Hide instead of unmounting (preview mode) so undo history survives. */
  hidden?: boolean;
  /** Empty-document prompt; the default speaks for a whole note. */
  placeholder?: string;
  /** Editing surface from the open note's type: the markdown view brings the
   * parser, anything else is a bare text editor. */
  view: ViewId;
  /** Affordances the note's type declares; each gates its own extension. Read
   * when the editor mounts, so a type change has to rebuild it. */
  features: readonly Feature[];
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

/** Copy the selected text (multi-range joins with newlines); empty selection
 * copies nothing. Returns the text so `cut` can reuse it. */
async function copySelection(view: EditorView): Promise<string | null> {
  const { state } = view;
  const text = state.selection.ranges
    .filter((r) => !r.empty)
    .map((r) => state.sliceDoc(r.from, r.to))
    .join("\n");
  if (!text) return null;
  await writeText(text);
  return text;
}

async function cutSelection(view: EditorView) {
  if ((await copySelection(view)) === null) return;
  view.dispatch(view.state.replaceSelection(""), {
    scrollIntoView: true,
    userEvent: "delete.cut",
  });
}

/** Menu-driven paste — native Ctrl+V never reaches this path. */
async function pasteClipboard(view: EditorView) {
  try {
    const text = await readText();
    if (!text) return;
    view.dispatch(view.state.replaceSelection(text), {
      scrollIntoView: true,
      userEvent: "input.paste",
    });
  } catch {
    // Empty or non-text clipboard rejects — nothing to paste.
  }
}

function execCommand(view: EditorView, cmd: EditorCommand) {
  switch (cmd) {
    case "undo":
      return void undo(view);
    case "redo":
      return void redo(view);
    case "cut":
      return void cutSelection(view);
    case "copy":
      return void copySelection(view);
    case "paste":
      return void pasteClipboard(view);
    case "selectAll":
      return void selectAll(view);
    // The search panel carries the replace row too, so both verbs open it.
    case "find":
    case "replace":
      return void openSearchPanel(view);
    case "gotoLine":
      return void gotoLine(view);
  }
}

const WORD = /\S+/g;

function editorStatus(state: EditorState, words: number): EditorStatus {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  const selected = state.selection.ranges.reduce((n, r) => n + (r.to - r.from), 0);
  return { line: line.number, col: head - line.from + 1, selected, words };
}

function insertAtCursor(view: EditorView, text: string, at?: { x: number; y: number }) {
  const dropped = at ? view.posAtCoords(at) : null;
  const to = dropped ?? view.state.selection.main.to;
  view.dispatch({
    changes: { from: to, insert: text },
    selection: { anchor: to + text.length },
    scrollIntoView: true,
    userEvent: "input",
  });
}

const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
  {
    docKey,
    initialDoc,
    onChange,
    onPasteImage,
    resolveImage,
    mentionItems,
    mentionLink,
    onOpenLink,
    onStatus,
    hidden,
    placeholder: placeholderText,
    view: noteView,
    features,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // True while setDoc rewrites the buffer — the update listener skips onChange.
  const syncingRef = useRef(false);
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
  const onOpenLinkRef = useRef(onOpenLink);
  onOpenLinkRef.current = onOpenLink;
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  const initialDocRef = useRef(initialDoc);
  initialDocRef.current = initialDoc;
  const noteViewRef = useRef(noteView);
  noteViewRef.current = noteView;
  const featuresRef = useRef(features);
  featuresRef.current = features;
  const placeholderRef = useRef(placeholderText);
  placeholderRef.current = placeholderText;
  const has = (feature: Feature) => featuresRef.current.includes(feature);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => viewRef.current?.focus(),
      applyFormat: (kind: FormatKind) => {
        const view = viewRef.current;
        if (!view || !has("format")) return;
        applyFormat(view, kind);
        view.focus();
      },
      exec: (cmd: EditorCommand) => {
        const view = viewRef.current;
        if (!view) return;
        execCommand(view, cmd);
        view.focus();
      },
      insertText: (text: string, at?: { x: number; y: number }) => {
        const view = viewRef.current;
        if (!view) return;
        insertAtCursor(view, text, at);
        view.focus();
      },
      insertAfterLine: (line: number, text: string) => {
        const view = viewRef.current;
        if (!view) return;
        const doc = view.state.doc;
        const at = doc.line(Math.min(Math.max(line, 1), doc.lines)).to;
        view.dispatch({ changes: { from: at, insert: text } });
      },
      setDoc: (text: string) => {
        const view = viewRef.current;
        if (!view || view.state.doc.toString() === text) return;
        syncingRef.current = true;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: text },
          selection: { anchor: Math.min(view.state.selection.main.head, text.length) },
        });
        syncingRef.current = false;
      },
      revealLine: (line: number) => {
        const view = viewRef.current;
        if (!view) return;
        const { from } = view.state.doc.line(Math.min(Math.max(line, 1), view.state.doc.lines));
        view.dispatch({
          selection: { anchor: from },
          effects: EditorView.scrollIntoView(from, { y: "center" }),
        });
        view.focus();
      },
      topLine: () => {
        const view = viewRef.current;
        if (!view) return 1;
        // Block heights are measured from the document's top, below the
        // scroller's padding.
        const top = view.scrollDOM.scrollTop - view.documentPadding.top;
        return view.state.doc.lineAt(view.lineBlockAtHeight(top).from).number;
      },
      scrollToLine: (line: number) => {
        const view = viewRef.current;
        if (!view) return;
        const { from } = view.state.doc.line(Math.min(Math.max(line, 1), view.state.doc.lines));
        view.dispatch({ effects: EditorView.scrollIntoView(from, { y: "start" }) });
      },
    }),
    [],
  );

  useEffect(() => {
    const wordsRef = { current: (initialDocRef.current.match(WORD) ?? []).length };
    const view = new EditorView({
      state: EditorState.create({
        doc: initialDocRef.current,
        extensions: [
          minimalSetup,
          // The note type decides what the editor is: the markdown view brings
          // the parser (codeLanguages makes ```lang fences parse with the real
          // language, lazy-loaded, so the highlight style has tokens to color),
          // and each optional affordance is one feature it declares.
          ...(noteViewRef.current === "markdown"
            ? [markdown({ base: markdownLanguage, codeLanguages: languages })]
            : []),
          ...(has("live-preview") ? [livePreview((src) => resolveImageRef.current(src))] : []),
          ...(has("mentions")
            ? [
                mentions(
                  () => mentionItemsRef.current,
                  (id) => mentionLinkRef.current(id),
                ),
              ]
            : []),
          linkify((target) => onOpenLinkRef.current(target)),
          EditorView.lineWrapping,
          placeholder(placeholderRef.current ?? "Capture a thought…"),
          Prec.high(
            keymap.of([
              ...(has("format")
                ? [
                    { key: "Mod-b", run: (v: EditorView) => applyFormat(v, "bold") },
                    { key: "Mod-i", run: (v: EditorView) => applyFormat(v, "italic") },
                    { key: "Mod-1", run: (v: EditorView) => applyFormat(v, "h1") },
                    { key: "Mod-2", run: (v: EditorView) => applyFormat(v, "h2") },
                    { key: "Mod-3", run: (v: EditorView) => applyFormat(v, "h3") },
                    { key: "Mod-Shift-c", run: (v: EditorView) => applyFormat(v, "code") },
                    // Ctrl+Shift+K stays delete-line (defaultKeymap) — the
                    // code-editor reflex beats a rarely-chorded format; the
                    // code-block format lives on the toolbar / menu / palette only.
                    // Word-processor convention for lists; quote continues the row.
                    { key: "Mod-Shift-8", run: (v: EditorView) => applyFormat(v, "bullet") },
                    { key: "Mod-Shift-7", run: (v: EditorView) => applyFormat(v, "numbered") },
                    { key: "Mod-Shift-9", run: (v: EditorView) => applyFormat(v, "quote") },
                    // Ctrl+K (the usual link binding) is the command palette.
                    { key: "Mod-Shift-l", run: (v: EditorView) => applyFormat(v, "link") },
                  ]
                : []),
              // Windows-standard replace / go-to-line; searchKeymap's own
              // Mod-g (find next) loses to these — F3 still covers it.
              { key: "Mod-h", run: openSearchPanel },
              { key: "Mod-g", run: gotoLine },
            ]),
          ),
          // minimalSetup already binds undo (Mod-z) and redo (Mod-y); this adds
          // find (Mod-f), the Mod-Shift-z redo alias, and Tab list indenting.
          keymap.of([...searchKeymap, indentWithTab, { key: "Mod-Shift-z", run: redo }]),
          EditorView.domEventHandlers({
            paste: (event, v) => {
              if (!has("images")) return false;
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
            if (update.docChanged) {
              const text = update.state.doc.toString();
              if (!syncingRef.current) onChangeRef.current(text);
              // Recount words only when the doc changed — cursor moves reuse it.
              wordsRef.current = (text.match(WORD) ?? []).length;
            }
            if (update.docChanged || update.selectionSet) {
              onStatusRef.current?.(editorStatus(update.state, wordsRef.current));
            }
          }),
        ],
      }),
      parent: containerRef.current!,
    });
    viewRef.current = view;
    view.focus();
    onStatusRef.current?.(editorStatus(view.state, wordsRef.current));
    return () => {
      view.destroy();
      viewRef.current = null;
      // Clear the status readout — with no editor there is no Ln/Col. A doc
      // switch re-sends real status right after, so only unmount shows this.
      onStatusRef.current?.(null);
    };
    // Rebuild only when a different document opens; `initialDoc` tracks live
    // edits between renders and must not reset the editor.
  }, [docKey]);

  return (
    <div
      ref={containerRef}
      className={noteView === "markdown" ? "editor" : "editor editor-plain"}
      hidden={hidden}
    />
  );
});

export default Editor;
