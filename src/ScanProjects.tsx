import { useState } from "react";
import { ProjectCandidate } from "./notes";

interface ScanProjectsProps {
  candidates: ProjectCandidate[];
  /** Existing project names — candidates colliding with these can't be added. */
  existing: string[];
  onAdd: (chosen: { name: string; path: string }[]) => Promise<void>;
  onClose: () => void;
}

/** Confirmation sheet for File → Scan folder for projects: pick which found
 * folders become (external, linked-in-place) projects. */
export function ScanProjects({ candidates, existing, onAdd, onClose }: ScanProjectsProps) {
  const taken = new Set(existing.map((p) => p.toLowerCase()));
  // A name can only be used once — earlier candidate wins, later ones disable.
  const seen = new Set<string>();
  const rows = candidates.map((c) => {
    const key = c.name.toLowerCase();
    const conflict = taken.has(key)
      ? "name already in use"
      : seen.has(key)
        ? "duplicate name"
        : null;
    seen.add(key);
    return { ...c, conflict };
  });

  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(rows.filter((r) => !r.conflict).map((r) => r.path)),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (path: string) =>
    setChecked((s) => {
      const next = new Set(s);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const submit = async () => {
    const chosen = rows
      .filter((r) => !r.conflict && checked.has(r.path))
      .map((r) => ({ name: r.name, path: r.path }));
    if (chosen.length === 0) return;
    setBusy(true);
    try {
      await onAdd(chosen);
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  };

  const count = rows.filter((r) => !r.conflict && checked.has(r.path)).length;

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="settings scan-panel" onClick={(e) => e.stopPropagation()}>
        <h1>Scan results</h1>
        {rows.length === 0 ? (
          <p className="muted">
            No project folders found — a folder counts when it contains a README.md (or index.md).
          </p>
        ) : (
          <ul className="scan-list">
            {rows.map((r) => (
              <li key={r.path} className={r.conflict ? "conflict" : undefined}>
                <label>
                  <input
                    type="checkbox"
                    disabled={r.conflict !== null}
                    checked={!r.conflict && checked.has(r.path)}
                    onChange={() => toggle(r.path)}
                  />
                  <span className="scan-name">{r.name}</span>
                  <span className="scan-count">
                    {r.conflict ?? `${r.md_count} note${r.md_count === 1 ? "" : "s"}`}
                  </span>
                </label>
                <div className="scan-path">{r.path}</div>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="scan-error">{error}</p>}
        <div className="scan-actions">
          <button className="tool-btn" onClick={onClose}>
            Cancel
          </button>
          {rows.length > 0 && (
            <button className="tool-btn scan-add" disabled={count === 0 || busy} onClick={submit}>
              Add {count} project{count === 1 ? "" : "s"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
