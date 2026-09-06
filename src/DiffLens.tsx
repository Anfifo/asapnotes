import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { EditorState, StateEffect, StateField, type Range, type Text } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { LensDel, LensLine, NoteLens, noteLens } from "./notes";
import { livePreview } from "./livePreview";
import { linkify } from "./links";
import { errText } from "./toasts";
import { Icon } from "./icons";
import { fileOf } from "./paths";
import { SeenTarget } from "./changesLedger";

/** Expand (or collapse) one run of removed lines. */
const toggleDel = StateEffect.define<number>();

/** A run of removed lines, hanging between the lines that survived: a pill
 * saying how much left, expanding to the text in muted rose. */
class DelWidget extends WidgetType {
  constructor(
    readonly index: number,
    readonly lines: string[],
    readonly open: boolean,
  ) {
    super();
  }

  eq(other: DelWidget) {
    return other.index === this.index && other.open === this.open;
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-lens-del";
    const flip = () => view.dispatch({ effects: toggleDel.of(this.index) });
    if (!this.open) {
      const pill = document.createElement("button");
      pill.className = "cm-lens-pill";
      pill.textContent = `··· ${this.lines.length} removed`;
      pill.onclick = flip;
      wrap.append(pill);
      return wrap;
    }
    wrap.classList.add("open");
    wrap.title = "Hide the removed lines";
    wrap.onclick = flip;
    for (const text of this.lines) {
      const line = document.createElement("div");
      line.className = "cm-lens-del-line";
      line.textContent = text || " ";
      wrap.append(line);
    }
    return wrap;
  }

  // Let clicks through to the button / collapse handler.
  ignoreEvent() {
    return false;
  }
}

const addedLine = Decoration.line({ class: "cm-lens-add" });
/** A line written from scratch has no words to single out, so it marks whole. */
const wholeLine = Decoration.line({ class: "cm-lens-add cm-lens-whole" });
const changedWords = Decoration.mark({ class: "cm-lens-word" });

function buildMarks(added: LensLine[], dels: LensDel[], doc: Text, open: Set<number>) {
  const decos: Range<Decoration>[] = [];
  for (const { line, spans } of added) {
    if (line < 1 || line > doc.lines) continue;
    const row = doc.line(line);
    decos.push((spans.length > 0 ? addedLine : wholeLine).range(row.from));
    for (const [start, end] of spans) {
      const from = Math.min(row.from + start, row.to);
      const to = Math.min(row.from + end, row.to);
      if (to > from) decos.push(changedWords.range(from, to));
    }
  }
  for (const [index, del] of dels.entries()) {
    // Anchored below the line above it — 0 means the run sat above line 1.
    const at = del.afterLine === 0 ? 0 : doc.line(Math.min(del.afterLine, doc.lines)).to;
    decos.push(
      Decoration.widget({
        widget: new DelWidget(index, del.lines, open.has(index)),
        block: true,
        side: del.afterLine === 0 ? -1 : 1,
      }).range(at),
    );
  }
  return Decoration.set(decos, true);
}

/** The marks as an extension. The document never changes (the lens is
 * read-only), so the only thing that rebuilds them is collapsing or expanding
 * a run of removed lines. They start expanded: what left is as much the change
 * as what arrived, and a pill hides it behind a click. */
function lensMarks(lens: NoteLens) {
  const field = StateField.define<{ open: Set<number>; decos: DecorationSet }>({
    create: (state) => {
      const open = new Set(lens.dels.keys());
      return { open, decos: buildMarks(lens.added, lens.dels, state.doc, open) };
    },
    update(value, tr) {
      const flips = tr.effects.filter((e) => e.is(toggleDel));
      if (flips.length === 0) return value;
      const open = new Set(value.open);
      for (const e of flips) {
        if (open.has(e.value)) open.delete(e.value);
        else open.add(e.value);
      }
      return { open, decos: buildMarks(lens.added, lens.dels, tr.state.doc, open) };
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.decos),
  });
  return field;
}

/** Where the jump control stops: each run of consecutive added lines is one
 * change, and so is each run of removed ones. */
function anchors(lens: NoteLens): number[] {
  const stops = new Set<number>();
  let previous = -2;
  for (const { line } of lens.added) {
    if (line !== previous + 1) stops.add(line);
    previous = line;
  }
  for (const del of lens.dels) stops.add(Math.max(del.afterLine, 1));
  return [...stops].sort((a, b) => a - b);
}

interface DiffLensProps {
  note: string;
  /** Changed notes in the ledger's order — what the jump control steps to at
   * either end of this note's changes. */
  order: string[];
  /** This note's edits, for the seen toggle. */
  events: SeenTarget[];
  seen: boolean;
  resolveImage: (src: string) => string;
  onOpenLens: (note: string) => void;
  /** Open the note itself, optionally at a line. */
  onOpenNote: (note: string, line?: number) => void;
  onOpenLink: (target: string) => void;
  onMarkSeen: (items: SeenTarget[], seen: boolean) => void;
  onClose: () => void;
  onError: (message: string) => void;
  /** Where the marked document comes from; the history store by default. */
  source?: () => Promise<NoteLens | null>;
  /** The strip's lead, in place of the note's file name. */
  heading?: ReactNode;
  /** The through-button's text, in place of "Open note ›". */
  throughLabel?: string;
  /** Verbs for this reading of the note, at the strip's end. */
  actions?: ReactNode;
  /** Shown when the source has nothing to mark. */
  emptyText?: string;
}

/** One note's changes read as the note itself: the same live-preview surface
 * it is edited in, read-only, with the external edits marked on top. */
export function DiffLens({
  note,
  order,
  events,
  seen,
  resolveImage,
  onOpenLens,
  onOpenNote,
  onOpenLink,
  onMarkSeen,
  onClose,
  onError,
  source,
  heading,
  throughLabel = "Open note ›",
  actions,
  emptyText = "Nothing here anymore — this note's changes have left the window.",
}: DiffLensProps) {
  const [lens, setLens] = useState<NoteLens | null>(null);
  const [loading, setLoading] = useState(true);
  const [at, setAt] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // App hands fresh arrows every render; the load must not re-run for that.
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const resolveImageRef = useRef(resolveImage);
  resolveImageRef.current = resolveImage;
  const onOpenLinkRef = useRef(onOpenLink);
  onOpenLinkRef.current = onOpenLink;

  // A fresh edit to this note while the lens is up (the focus scan found one)
  // has to redraw it; marking seen must not, so the tip timestamp is the dep
  // rather than the events themselves.
  const tip = events.reduce((newest, e) => Math.max(newest, e.atMs), 0);

  useEffect(() => {
    let stale = false;
    setLoading(true);
    void (sourceRef.current ?? (() => noteLens(note)))()
      .then((l) => {
        if (stale) return;
        setLens(l);
        setAt(0);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (stale) return;
        setLoading(false);
        onErrorRef.current(errText(err));
      });
    return () => {
      stale = true;
    };
  }, [note, tip]);

  useEffect(() => {
    if (!lens) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: lens.text,
        extensions: [
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          livePreview((src) => resolveImageRef.current(src)),
          linkify((target) => onOpenLinkRef.current(target)),
          lensMarks(lens),
          EditorView.lineWrapping,
          // Read-only, and not focusable: the marks stand against a snapshot,
          // so the document must not move under them. Text still selects.
          EditorView.editable.of(false),
          EditorState.readOnly.of(true),
        ],
      }),
      parent: containerRef.current!,
    });
    viewRef.current = view;
    // Land on the first change rather than the top of the note — a long note
    // whose edit sits deep in it would otherwise open showing nothing marked.
    // "nearest" leaves an already-visible first change where it is.
    const first = anchors(lens)[0];
    if (first) {
      const line = view.state.doc.line(Math.min(first, view.state.doc.lines));
      view.dispatch({
        effects: EditorView.scrollIntoView(line.from, { y: "nearest", yMargin: 80 }),
      });
    }
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [lens]);

  const stops = useMemo(() => (lens ? anchors(lens) : []), [lens]);

  const goTo = (index: number) => {
    setAt(index);
    const view = viewRef.current;
    if (!view) return;
    const line = view.state.doc.line(Math.min(Math.max(stops[index], 1), view.state.doc.lines));
    view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: "center" }) });
  };

  /** Walk the changes; past either end, step to the neighbouring note — the
   * read-through, without a mode of its own. */
  const step = (delta: number) => {
    const next = at + delta;
    if (next >= 0 && next < stops.length) {
      goTo(next);
      return;
    }
    const here = order.indexOf(note);
    const neighbour = order[here + delta];
    if (neighbour) onOpenLens(neighbour);
  };
  const stepRef = useRef(step);
  stepRef.current = step;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F8") {
        e.preventDefault();
        stepRef.current(e.shiftKey ? -1 : 1);
      } else if (e.key === "Escape") {
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const here = order.indexOf(note);
  const hasNext = at + 1 < stops.length || here + 1 < order.length;
  const hasPrev = at > 0 || here > 0;

  return (
    <div className="lens">
      <div className="changes-strip">
        <span className="chg-totals muted">
          {heading ?? fileOf(note)}
          {lens && " · "}
          {lens && <span className="chg-add-count">+{lens.addedN}</span>}
          {lens && " "}
          {lens && <span className="chg-del-count">−{lens.removedN}</span>}
          {lens?.ownEditsSince && " · your own edits since aren't marked"}
        </span>
        <button
          className="chg-through"
          data-tip="Open the note itself, at the change on screen"
          onClick={() => onOpenNote(note, stops[at])}
        >
          {throughLabel}
        </button>
        {actions}
        {events.length > 0 && (
          <button
            className="chg-through"
            style={{ marginLeft: 0 }}
            onClick={() => onMarkSeen(events, !seen)}
          >
            <Icon name="check" /> {seen ? "Read — mark unread" : "Mark as read"}
          </button>
        )}
      </div>
      {loading ? (
        <p className="chg-empty muted">Loading…</p>
      ) : !lens ? (
        <p className="chg-empty muted">{emptyText}</p>
      ) : (
        <>
          <div className="lens-doc" ref={containerRef} />
          {stops.length > 0 && (
            <div className="lens-jump">
              <button
                disabled={!hasPrev}
                aria-label={at > 0 ? "Previous change" : "Previous note"}
                data-tip={at > 0 ? "Previous change (Shift+F8)" : "Previous note (Shift+F8)"}
                onClick={() => step(-1)}
              >
                <Icon name="chevron-left" />
              </button>
              <span className="lens-jump-count">
                Change {at + 1} of {stops.length}
              </span>
              <button
                disabled={!hasNext}
                aria-label={at + 1 < stops.length ? "Next change" : "Next note"}
                data-tip={at + 1 < stops.length ? "Next change (F8)" : "Next note (F8)"}
                onClick={() => step(1)}
              >
                <Icon name="chevron-right" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
