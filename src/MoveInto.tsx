import { useState } from "react";
import { MountInfo } from "./notes";
import { validFileName } from "./paths";

interface MoveIntoProps {
  /** The project the notes were dropped on. */
  project: string;
  /** How many notes are moving — the wording counts them. */
  count: number;
  /** The project's virtual folders, each an alternative to its own folder. */
  mounts: MountInfo[];
  /** Move into an existing folder id (the project itself, or a mount's). */
  onMove: (dir: string) => void;
  /** Create a virtual folder of this name in the project, then move there. */
  onNewVirtual: (name: string) => void;
  onCancel: () => void;
}

/** Dropping notes on a project heading is the one ambiguous drop: into the
 * project's own folder, or into a virtual folder — whose files stay out of the
 * project directory (and its repository) while showing up in it. In-app,
 * because the choice has more than two answers once a project has virtual
 * folders. */
export function MoveInto({
  project,
  count,
  mounts,
  onMove,
  onNewVirtual,
  onCancel,
}: MoveIntoProps) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const what = count === 1 ? "this note" : `these ${count} notes`;
  const valid = validFileName(name.trim()) && !mounts.some((m) => m.at === name.trim());
  return (
    <div
      className="palette-backdrop"
      onClick={onCancel}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
        // The dialog owns the keyboard while it is up — no app shortcuts.
        e.stopPropagation();
      }}
    >
      <div className="settings close-confirm move-into" onClick={(e) => e.stopPropagation()}>
        <h1>Move into {project}</h1>
        <p>
          Put {what} in the project&apos;s own folder, or in a virtual folder — one that shows under
          the project but keeps its files outside the project directory.
        </p>
        <div className="move-into-choices">
          <button className="tool-btn scan-add" autoFocus onClick={() => onMove(project)}>
            Project folder
          </button>
          {mounts.map((m) => (
            <button key={m.at} className="tool-btn" onClick={() => onMove(`${project}/${m.at}`)}>
              Virtual folder: {m.at}
            </button>
          ))}
          {naming ? (
            <form
              className="move-into-new"
              onSubmit={(e) => {
                e.preventDefault();
                if (valid) onNewVirtual(name.trim());
              }}
            >
              <input
                autoFocus
                placeholder="virtual folder name…"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <button className="tool-btn scan-add" type="submit" disabled={!valid}>
                Create and move
              </button>
            </form>
          ) : (
            <button className="tool-btn" onClick={() => setNaming(true)}>
              New virtual folder…
            </button>
          )}
        </div>
        <div className="scan-actions">
          <button className="tool-btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
