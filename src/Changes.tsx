import { Fragment } from "react";
import { ChangeSummary, CHANGES_DAYS } from "./notes";
import { MenuEntry } from "./MenuBar";
import { fileOf } from "./paths";
import { groupByProject, Row, Section, SeenTarget, stamp } from "./changesLedger";

interface ChangesViewProps {
  /** The window's external edits, newest first — App owns them because the
   * view button's count badge needs them even while this view is closed. */
  summaries: ChangeSummary[];
  /** Open the marked-up reading of one note, or of the newest change (null). */
  onOpenLens: (note: string | null) => void;
  /** Open the note itself in the editor. */
  onOpenNote: (note: string) => void;
  /** Mark changes read/unread — App applies it and keeps the undo stack. */
  onMarkSeen: (items: SeenTarget[], seen: boolean) => void;
  /** Show a context menu at the pointer — App owns the one menu surface. */
  onMenu: (e: React.MouseEvent, entries: MenuEntry[]) => void;
}

/** What changed in the notes while the app wasn't looking: external edits
 * only — the user's own saves are the diffs' baseline, never shown. The panel
 * is the ledger; a row opens that note's changes as a document. */
export function ChangesView({
  summaries,
  onOpenLens,
  onOpenNote,
  onMarkSeen,
  onMenu,
}: ChangesViewProps) {
  const noteCount = new Set(summaries.map((s) => s.note)).size;
  const added = summaries.reduce((n, s) => n + s.added, 0);
  const removed = summaries.reduce((n, s) => n + s.removed, 0);
  const unseen = summaries.filter((s) => !s.seen);

  /** Toggle a row: an unseen row marks its unseen events, a seen row unmarks
   * all of them — so Ctrl+Z restores exactly what one click did. */
  const toggleRow = (row: Row) => {
    if (row.seen) onMarkSeen(row.events, false);
    else
      onMarkSeen(
        row.events.filter((ev) => !isSeen(ev)),
        true,
      );
  };

  const isSeen = (ev: SeenTarget) =>
    summaries.some((s) => s.note === ev.note && s.atMs === ev.atMs && s.seen);

  const markAllEntry = (): MenuEntry[] =>
    unseen.length > 0
      ? [
          {
            label: "Mark all as seen",
            run: () =>
              onMarkSeen(
                unseen.map(({ note, atMs }) => ({ note, atMs })),
                true,
              ),
          },
        ]
      : [];

  const sectionEntries = (section: Section): MenuEntry[] => {
    const pending = section.rows.flatMap((r) => r.events.filter((ev) => !isSeen(ev)));
    return pending.length > 0
      ? [{ label: `Mark ${section.project} as seen`, run: () => onMarkSeen(pending, true) }]
      : [
          {
            label: `Mark ${section.project} as unseen`,
            run: () =>
              onMarkSeen(
                section.rows.flatMap((r) => r.events),
                false,
              ),
          },
        ];
  };

  const rowMenu = (e: React.MouseEvent, section: Section, row: Row) =>
    onMenu(e, [
      { label: "Open changes", run: () => onOpenLens(row.note) },
      { label: "Open note", run: () => onOpenNote(row.note) },
      "sep",
      row.seen
        ? { label: "Mark as unseen", detail: "Ctrl+Z", run: () => toggleRow(row) }
        : { label: "Mark as seen", run: () => toggleRow(row) },
      ...sectionEntries(section),
      ...markAllEntry(),
    ]);

  return (
    <div className="changes-view">
      <div className="changes-strip">
        <span className="chg-totals muted">
          {noteCount === 0
            ? `No changes in ${CHANGES_DAYS} days`
            : `${noteCount} ${noteCount === 1 ? "note" : "notes"} · `}
          {noteCount > 0 && <span className="chg-add-count">+{added}</span>}
          {noteCount > 0 && " "}
          {noteCount > 0 && <span className="chg-del-count">−{removed}</span>}
        </span>
        {noteCount > 0 && (
          <button className="chg-through" onClick={() => onOpenLens(null)}>
            Read through ›
          </button>
        )}
      </div>
      <div
        className="changes-results"
        onContextMenu={(e) => {
          if (noteCount > 0) onMenu(e, markAllEntry());
        }}
      >
        {noteCount === 0 ? (
          <p className="chg-empty muted">
            Edits made to markdown notes by other tools — an agent, another editor — show up here.
            Nothing has changed in the last {CHANGES_DAYS} days.
          </p>
        ) : (
          groupByProject(summaries).map((section) => (
            <Fragment key={section.project}>
              <div
                className="changes-project"
                onContextMenu={(e) => onMenu(e, sectionEntries(section))}
              >
                {section.project}
              </div>
              <ul>
                {section.rows.map((r) => (
                  <li
                    key={r.note}
                    className={r.seen ? "chg-row seen" : "chg-row"}
                    onClick={() => onOpenLens(r.note)}
                    onContextMenu={(e) => rowMenu(e, section, r)}
                  >
                    <span className="explorer-name">{fileOf(r.note)}</span>
                    <span className="explorer-detail">{stamp(r.atMs)}</span>
                    <span className="chg-chips">
                      <span className="chg-add-count">+{r.added}</span>
                      <span className="chg-del-count">−{r.removed}</span>
                    </span>
                    <button
                      className="chg-seen-btn"
                      aria-label={r.seen ? "Mark as unseen" : "Mark as seen"}
                      data-tip={r.seen ? "Mark as unseen (Ctrl+Z)" : "Mark as seen"}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleRow(r);
                      }}
                    >
                      ✓
                    </button>
                  </li>
                ))}
              </ul>
            </Fragment>
          ))
        )}
      </div>
    </div>
  );
}
