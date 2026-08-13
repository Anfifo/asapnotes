import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Change, ChangeSummary, changeDetails, CHANGES_DAYS, DiffLine, NoteChanges } from "./notes";
import { errText } from "./toasts";
import { fileOf, projectOf } from "./paths";

/** Three states of one panel: the ledger lands, a file row drills into that
 * note alone, "Read through" stacks every note's details into one scroll. */
type Mode = { kind: "ledger" } | { kind: "note"; note: string } | { kind: "stream" };

interface DayGroup {
  day: string;
  rows: { note: string; added: number; removed: number }[];
}

/** Ledger shape: rows per (day, note), newest day first — the backend already
 * emits summaries newest-first, so first-seen order is the right one. */
function groupByDay(summaries: ChangeSummary[]): DayGroup[] {
  const days: DayGroup[] = [];
  for (const s of summaries) {
    const day = dayLabel(s.atMs);
    let group = days[days.length - 1];
    if (group?.day !== day) {
      group = { day, rows: [] };
      days.push(group);
    }
    const row = group.rows.find((r) => r.note === s.note);
    if (row) {
      row.added += s.added;
      row.removed += s.removed;
    } else {
      group.rows.push({ note: s.note, added: s.added, removed: s.removed });
    }
  }
  return days;
}

function dayLabel(atMs: number): string {
  const day = new Date(atMs);
  const today = new Date();
  const days = ["Today", "Yesterday"];
  for (let i = 0; i < days.length; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    if (
      day.getFullYear() === d.getFullYear() &&
      day.getMonth() === d.getMonth() &&
      day.getDate() === d.getDate()
    ) {
      return days[i];
    }
  }
  return day.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function NoteName({ note }: { note: string }) {
  return (
    <>
      <span className="explorer-name">{fileOf(note).replace(/\.md$/, "")}</span>
      {projectOf(note) && <span className="explorer-detail">{projectOf(note)}</span>}
    </>
  );
}

/** A run of deleted lines, collapsed to a pill; expanding shows the removed
 * text in muted rose — readable, not struck out. */
function DelRun({ lines }: { lines: DiffLine[] }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button className="chg-del-pill" onClick={() => setOpen(true)}>
        ··· {lines.length} removed
      </button>
    );
  }
  return (
    <>
      {lines.map((l, i) => (
        <div key={i} className="chg-line del">
          <span className="chg-text">{l.text || " "}</span>
        </div>
      ))}
    </>
  );
}

function ChangeHunks({
  note,
  change,
  onOpenLine,
}: {
  note: string;
  change: Change;
  onOpenLine: (note: string, line: number) => void;
}) {
  return (
    <>
      {change.hunks.map((hunk, hi) => {
        // Consecutive deletions render as one run (pill); everything else
        // line by line.
        const parts: ReactNode[] = [];
        let dels: DiffLine[] = [];
        const flush = () => {
          if (dels.length > 0) parts.push(<DelRun key={`d${parts.length}`} lines={dels} />);
          dels = [];
        };
        for (const [i, line] of hunk.lines.entries()) {
          if (line.kind === "del") {
            dels.push(line);
            continue;
          }
          flush();
          parts.push(
            <div key={i} className={`chg-line ${line.kind}`}>
              <span className="chg-text">{line.text || " "}</span>
              {line.kind === "add" && line.line !== null && (
                <button
                  className="chg-jump"
                  title={`Go to line ${line.line}`}
                  onClick={() => onOpenLine(note, line.line as number)}
                >
                  ↗
                </button>
              )}
            </div>,
          );
        }
        flush();
        return (
          <div key={hi}>
            {hi > 0 && <div className="chg-gap">⋯</div>}
            {parts}
          </div>
        );
      })}
    </>
  );
}

function NoteDetail({
  nc,
  onOpenLine,
}: {
  nc: NoteChanges;
  onOpenLine: (note: string, line: number) => void;
}) {
  return (
    <section className="chg-note">
      <header className="chg-note-head">
        <NoteName note={nc.note} />
      </header>
      {nc.changes.map((c, i) => (
        <div key={c.atMs}>
          {i > 0 && <div className="chg-gap">⋯</div>}
          <ChangeHunks note={nc.note} change={c} onOpenLine={onOpenLine} />
        </div>
      ))}
    </section>
  );
}

interface ChangesViewProps {
  /** The window's external edits, newest first — App owns them because the
   * view button's count badge needs them even while this view is closed. */
  summaries: ChangeSummary[];
  /** Open a note and put the cursor on `line`. */
  onOpenLine: (note: string, line: number) => void;
  /** Surface a failed detail read — otherwise it reads as "nothing changed". */
  onError: (message: string) => void;
}

/** What changed in the notes while the app wasn't looking: external edits
 * only — the user's own saves are the diffs' baseline, never shown. */
export function ChangesView({ summaries, onOpenLine, onError }: ChangesViewProps) {
  const [mode, setMode] = useState<Mode>({ kind: "ledger" });
  const [details, setDetails] = useState<NoteChanges[] | null>(null);
  // Held in a ref: App passes a fresh arrow every render, and the details
  // fetch must not re-run on unrelated re-renders.
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (mode.kind === "ledger") {
      setDetails(null);
      return;
    }
    let stale = false;
    void changeDetails(mode.kind === "note" ? mode.note : null)
      .then((d) => {
        if (!stale) setDetails(d);
      })
      .catch((err: unknown) => {
        if (!stale) onErrorRef.current(errText(err));
      });
    return () => {
      stale = true;
    };
  }, [mode]);

  const noteCount = new Set(summaries.map((s) => s.note)).size;
  const added = summaries.reduce((n, s) => n + s.added, 0);
  const removed = summaries.reduce((n, s) => n + s.removed, 0);

  return (
    <div className="changes-view">
      <div className="changes-strip">
        {mode.kind !== "ledger" && (
          <button className="chg-back" title="Back" onClick={() => setMode({ kind: "ledger" })}>
            ‹
          </button>
        )}
        <span className="chg-totals muted">
          {noteCount === 0
            ? `No changes in ${CHANGES_DAYS} days`
            : `${noteCount} ${noteCount === 1 ? "note" : "notes"} · `}
          {noteCount > 0 && <span className="chg-add-count">+{added}</span>}
          {noteCount > 0 && " "}
          {noteCount > 0 && <span className="chg-del-count">−{removed}</span>}
        </span>
        {mode.kind === "ledger" && noteCount > 0 && (
          <button className="chg-through" onClick={() => setMode({ kind: "stream" })}>
            Read through ›
          </button>
        )}
      </div>
      <div className="changes-results">
        {mode.kind === "ledger" ? (
          noteCount === 0 ? (
            <p className="chg-empty muted">
              Edits made to markdown notes by other tools — an agent, another editor — show up here.
              Nothing has changed in the last {CHANGES_DAYS} days.
            </p>
          ) : (
            groupByDay(summaries).map((g) => (
              <Fragment key={g.day}>
                <div className="changes-day">{g.day}</div>
                <ul>
                  {g.rows.map((r) => (
                    <li
                      key={r.note}
                      className="chg-row"
                      onClick={() => setMode({ kind: "note", note: r.note })}
                    >
                      <NoteName note={r.note} />
                      <span className="chg-chips">
                        <span className="chg-add-count">+{r.added}</span>
                        <span className="chg-del-count">−{r.removed}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Fragment>
            ))
          )
        ) : details === null ? (
          <p className="chg-empty muted">Loading…</p>
        ) : (
          details.map((nc) => <NoteDetail key={nc.note} nc={nc} onOpenLine={onOpenLine} />)
        )}
      </div>
    </div>
  );
}
