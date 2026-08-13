import { ChangeSummary, CHANGES_DAYS } from "./notes";
import { projectOf } from "./paths";

/** One change as the seen ledger addresses it. */
export interface SeenTarget {
  note: string;
  atMs: number;
}

/** Ledger row: one note with everything that happened to it in the window.
 * `events` are the underlying edits — the unit seen-marking works in — and the
 * row counts as seen only when every one of them is. */
export interface Row {
  note: string;
  added: number;
  removed: number;
  atMs: number;
  events: SeenTarget[];
  seen: boolean;
}

export interface Section {
  project: string;
  rows: Row[];
}

/** The project label a note lives under; loose notes get the wording the
 * project selector uses for them. */
const sectionOf = (note: string) => projectOf(note) ?? "No project";

/** Ledger shape: a section per project, newest change first inside it and
 * across sections — the file name gets the whole row line, and the project is
 * said once per run instead of on every row. The backend emits summaries
 * newest-first, so first-seen order is already the right one. */
export function groupByProject(summaries: ChangeSummary[]): Section[] {
  const sections: Section[] = [];
  for (const s of summaries) {
    const project = sectionOf(s.note);
    let section = sections.find((x) => x.project === project);
    if (!section) {
      section = { project, rows: [] };
      sections.push(section);
    }
    let row = section.rows.find((r) => r.note === s.note);
    if (!row) {
      row = { note: s.note, added: 0, removed: 0, atMs: s.atMs, events: [], seen: true };
      section.rows.push(row);
    }
    row.added += s.added;
    row.removed += s.removed;
    row.atMs = Math.max(row.atMs, s.atMs);
    row.events.push({ note: s.note, atMs: s.atMs });
    row.seen &&= s.seen;
  }
  return sections;
}

/** The changed notes in the order the ledger shows them — the sequence the
 * lens steps through when one note's changes run out. */
export const changedNotes = (summaries: ChangeSummary[]): string[] =>
  groupByProject(summaries).flatMap((s) => s.rows.map((r) => r.note));

/** How long ago, in the two or three characters a row can spare. */
export function stamp(atMs: number): string {
  const minutes = (Date.now() - atMs) / 60000;
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h`;
  const when = new Date(atMs);
  // Inside the window a weekday is unambiguous; past it, say the date.
  return hours < 24 * (CHANGES_DAYS - 1)
    ? when.toLocaleDateString(undefined, { weekday: "short" })
    : when.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
