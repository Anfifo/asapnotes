import { Fragment } from "react";
import { MeetingRecording, RecordingTrack } from "./notes";
import { MenuEntry } from "./MenuBar";
import { fileOf, projectOf } from "./paths";
import { formatElapsed } from "./meetingTime";

interface RecordingsViewProps {
  recordings: MeetingRecording[];
  /** Open the meeting note at the line that links the recording. */
  onOpen: (note: string, line: number) => void;
  onReveal: (track: RecordingTrack) => void;
  onCopyPath: (track: RecordingTrack) => void;
  /** Show a context menu at the pointer — App owns the one menu surface. */
  onMenu: (e: React.MouseEvent, entries: MenuEntry[]) => void;
}

interface Section {
  project: string;
  rows: MeetingRecording[];
}

/** A section per project in first-seen order; the list arrives newest first,
 * so the project with the latest meeting leads. */
function groupByProject(recordings: MeetingRecording[]): Section[] {
  const sections: Section[] = [];
  for (const r of recordings) {
    const project = projectOf(r.note) ?? "No project";
    let section = sections.find((x) => x.project === project);
    if (!section) {
      section = { project, rows: [] };
      sections.push(section);
    }
    section.rows.push(r);
  }
  return sections;
}

const recordedAt = (r: MeetingRecording) => Math.max(0, ...r.tracks.map((t) => t.modified_ms));

/** The day a meeting happened; the year only once it is not this one. */
function dayOf(ms: number): string {
  if (ms === 0) return "";
  const when = new Date(ms);
  const thisYear = when.getFullYear() === new Date().getFullYear();
  return when.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(thisYear ? {} : { year: "numeric" }),
  });
}

/** Chip text: the row is one line, and the name needs most of it. */
const shortLabel = (t: RecordingTrack) => (t.label === "system audio" ? "sys" : "mic");

/** Every meeting the notes link a recording from, grouped by project. The
 * notes are the index, so a row is a line in a note and opens it there. */
export function RecordingsView({
  recordings,
  onOpen,
  onReveal,
  onCopyPath,
  onMenu,
}: RecordingsViewProps) {
  const rowMenu = (e: React.MouseEvent, r: MeetingRecording) =>
    onMenu(e, [
      { label: "Open note", run: () => onOpen(r.note, r.line) },
      "sep",
      ...r.tracks.flatMap((t): MenuEntry[] =>
        t.exists
          ? [
              { label: `Reveal ${t.label} in File Explorer`, run: () => onReveal(t) },
              { label: `Copy ${t.label} path`, run: () => onCopyPath(t) },
            ]
          : [],
      ),
    ]);

  return (
    <div className="changes-view">
      <div className="changes-strip">
        <span className="chg-totals muted">
          {recordings.length === 0
            ? "No recordings"
            : `${recordings.length} ${recordings.length === 1 ? "meeting" : "meetings"}`}
        </span>
      </div>
      <div className="changes-results">
        {recordings.length === 0 ? (
          <p className="chg-empty muted">
            Meetings recorded from the microphone button show up here, under the note they were
            recorded into.
          </p>
        ) : (
          groupByProject(recordings).map((section) => (
            <Fragment key={section.project}>
              <div className="changes-project">{section.project}</div>
              <ul>
                {section.rows.map((r) => (
                  <li
                    key={`${r.note}:${r.line}`}
                    className="chg-row rec-row"
                    onClick={() => onOpen(r.note, r.line)}
                    onContextMenu={(e) => rowMenu(e, r)}
                  >
                    <span className="explorer-name">{fileOf(r.note)}</span>
                    <span className="explorer-detail">{dayOf(recordedAt(r))}</span>
                    <span className="chg-chips rec-chips">
                      {r.seconds !== null && <span>{formatElapsed(r.seconds)}</span>}
                      {r.tracks.map((t) => (
                        <span
                          key={t.path}
                          className={t.exists ? "rec-track" : "rec-track gone"}
                          data-tip={t.exists ? t.label : `${t.label} — file missing`}
                        >
                          {shortLabel(t)}
                        </span>
                      ))}
                    </span>
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
