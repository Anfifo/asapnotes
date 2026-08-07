import { FileInfo } from "./notes";
import { fileOf, projectOf, subdirOf } from "./paths";

const RECENT_COUNT = 5;

interface ExplorerProps {
  notes: FileInfo[];
  drafts: FileInfo[];
  projects: string[];
  openId: string | null;
  onSelect: (id: string, isNote: boolean) => void;
  /** Docked beside the editor (true) vs floating over it. */
  pinned: boolean;
  onTogglePin: () => void;
}

/** Side panel: recent files on top, then loose notes and per-project groups. */
export function Explorer({
  notes,
  drafts,
  projects,
  openId,
  onSelect,
  pinned,
  onTogglePin,
}: ExplorerProps) {
  const noteNames = new Set(notes.map((n) => n.name));
  const draftIds = new Set(drafts.map((d) => d.name));

  // A note with unsaved edits appears in both lists — keep the newest timestamp.
  const latest = new Map<string, number>();
  for (const f of [...notes, ...drafts]) {
    latest.set(f.name, Math.max(latest.get(f.name) ?? 0, f.modified_ms));
  }
  const recent = [...latest.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, RECENT_COUNT)
    .map(([name]) => name);

  const loose = notes.filter((n) => !projectOf(n.name));
  const inProject = (p: string) => notes.filter((n) => projectOf(n.name) === p);

  const item = (id: string, showProject = false) => (
    <li
      key={id}
      className={id === openId ? "current" : undefined}
      onClick={() => onSelect(id, noteNames.has(id))}
    >
      <span className="explorer-name">{fileOf(id).replace(/\.md$/, "")}</span>
      {showProject && projectOf(id) && <span className="explorer-detail">{projectOf(id)}</span>}
      {/* deep external notes: show the subfolder so same-named files differ */}
      {!showProject && subdirOf(id) && <span className="explorer-detail">{subdirOf(id)}</span>}
      {draftIds.has(id) && <span className="dirty">●</span>}
    </li>
  );

  return (
    <nav className={pinned ? "explorer" : "explorer floating"}>
      <header className="explorer-bar">
        <button
          className={pinned ? "pin-btn pinned" : "pin-btn"}
          title={pinned ? "Unpin — float over the editor" : "Pin — dock beside the editor"}
          onClick={onTogglePin}
        >
          📌
        </button>
      </header>
      <div className="explorer-body">
        {recent.length > 0 && (
          <section>
            <h2>Recent</h2>
            <ul>{recent.map((id) => item(id, true))}</ul>
          </section>
        )}
        <section>
          <h2>Notes</h2>
          {loose.length > 0 && <ul>{loose.map((n) => item(n.name))}</ul>}
          {projects.map((p) => (
            <details key={p} open>
              <summary>{p}</summary>
              <ul>{inProject(p).map((n) => item(n.name))}</ul>
            </details>
          ))}
          {notes.length === 0 && <p className="muted">No saved notes yet</p>}
        </section>
      </div>
    </nav>
  );
}
