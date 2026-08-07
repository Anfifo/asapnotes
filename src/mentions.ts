import {
  acceptCompletion,
  autocompletion,
  closeCompletion,
  Completion,
  CompletionContext,
  completionStatus,
  moveCompletionSelection,
} from "@codemirror/autocomplete";
import { EditorState, Extension, Prec, StateEffect, StateField } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { fuzzyMatch } from "./fuzzy";

export interface MentionItem {
  /** Root-relative note id (`project/note.md`). */
  id: string;
  /** Search/display text (id without `.md`). */
  label: string;
}

/**
 * `@`-mention note links: typing `@` at the start of a line or after
 * whitespace opens a small completion dropdown over the note list; accepting
 * replaces `@query` with a markdown link built by `makeLink`.
 *
 * Esc and Backspace don't just close the dropdown — they suppress it for that
 * `@` (tracked below), so continued typing doesn't pop it back open. Only
 * deleting the `@` and typing a fresh one re-triggers.
 */

const setSuppressed = StateEffect.define<number>();

/** Doc position of a suppressed `@`, mapped through edits; dies with its `@`. */
const suppressed = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    if (value !== null) value = tr.changes.mapPos(value, -1);
    for (const e of tr.effects) if (e.is(setSuppressed)) value = e.value;
    if (value !== null && tr.newDoc.sliceString(value, value + 1) !== "@") value = null;
    return value;
  },
});

/** Start of the `@token` the cursor sits in, or null. */
function tokenStart(state: EditorState): number | null {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  const m = /@[^\s@]*$/.exec(line.text.slice(0, head - line.from));
  return m ? line.from + m.index : null;
}

/** Close the dropdown and suppress this `@` so typing doesn't reopen it. */
function cancelMention(view: EditorView): boolean {
  if (completionStatus(view.state) === null) return false;
  const at = tokenStart(view.state);
  if (at !== null) view.dispatch({ effects: setSuppressed.of(at) });
  closeCompletion(view);
  return true;
}

export function mentions(
  getItems: () => MentionItem[],
  makeLink: (id: string) => string,
): Extension {
  const source = (ctx: CompletionContext) => {
    const token = ctx.matchBefore(/@[^\s@]*$/);
    if (!token) return null;
    // Only mid-paragraph after whitespace or at line start — not `user@host`.
    if (token.from > 0 && !/\s/.test(ctx.state.sliceDoc(token.from - 1, token.from))) return null;
    if (ctx.state.field(suppressed) === token.from) return null;
    const query = ctx.state.sliceDoc(token.from + 1, ctx.pos);
    const items = getItems();
    const ranked = query
      ? items
          .flatMap((item) => {
            const m = fuzzyMatch(query, item.label);
            return m ? [{ item, score: m.score }] : [];
          })
          .sort((a, b) => b.score - a.score)
      : items.map((item) => ({ item, score: 0 }));
    if (ranked.length === 0) return null;
    const options: Completion[] = ranked.slice(0, 30).map(({ item }) => ({
      label: item.label,
      apply: (view, _completion, from, to) => {
        const insert = makeLink(item.id);
        view.dispatch({
          changes: { from, to, insert },
          selection: { anchor: from + insert.length },
          userEvent: "input.complete",
        });
      },
    }));
    return { from: token.from, options, filter: false as const };
  };

  return [
    suppressed,
    autocompletion({
      override: [source],
      defaultKeymap: false,
      icons: false,
      selectOnOpen: true,
      maxRenderedOptions: 30,
    }),
    // Every binding no-ops (returns false) while the dropdown is closed, so
    // the editor's normal keys are untouched. ←/→ close but still move; a
    // typed space closes by itself (the token can't contain whitespace).
    Prec.highest(
      keymap.of([
        { key: "ArrowDown", run: moveCompletionSelection(true) },
        { key: "ArrowUp", run: moveCompletionSelection(false) },
        { key: "Enter", run: acceptCompletion },
        { key: "Tab", run: acceptCompletion },
        { key: "Escape", run: cancelMention },
        {
          key: "Backspace",
          run: (view) => {
            cancelMention(view);
            return false; // the character still deletes
          },
        },
        {
          key: "ArrowLeft",
          run: (view) => {
            closeCompletion(view);
            return false;
          },
        },
        {
          key: "ArrowRight",
          run: (view) => {
            closeCompletion(view);
            return false;
          },
        },
      ]),
    ),
  ];
}
