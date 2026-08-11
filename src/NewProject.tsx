import { useState } from "react";
import { open as openFolderDialog } from "@tauri-apps/plugin-dialog";
import * as api from "./notes";
import { validProjectName } from "./paths";

/** Join for display only — keep whichever separator the base already uses. */
const joinPath = (base: string, seg: string) =>
  base.includes("\\") ? `${base}\\${seg}` : `${base}/${seg}`;

interface NewProjectProps {
  /** Where a notes-folder project would be created. */
  rootPath: string;
  /** Existing project names — the one rule the sheet can check before asking. */
  existing: string[];
  onCreate: (project: api.NewProject) => Promise<void>;
  onClose: () => void;
}

/** Creation sheet for a project, asking the one question the old flow answered
 * silently: where it lives. A notes-folder project is a new subfolder; a picked
 * folder is linked where it already is. */
export function NewProject({ rootPath, existing, onCreate, onClose }: NewProjectProps) {
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [info, setInfo] = useState<api.FolderInfo | null>(null);
  const [useDocs, setUseDocs] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const taken = new Set(existing.map((p) => p.toLowerCase()));
  const nameError = !name
    ? null
    : !validProjectName(name)
      ? "Not a usable folder name"
      : taken.has(name.toLowerCase())
        ? "A project with that name already exists"
        : null;

  const pick = async () => {
    const dir = await openFolderDialog({ directory: true, title: "Folder for the project" });
    if (typeof dir !== "string") return;
    setPicked(dir);
    setError(null);
    // A repository gets the docs-folder option, checked by default, so a manual
    // pick lands where a scanned repository would.
    try {
      const found = await api.folderInfo(dir);
      setInfo(found);
      setUseDocs(found.has_git);
    } catch {
      setInfo(null);
      setUseDocs(false);
    }
    // The folder's own name is the obvious default once there is one.
    if (!name) setName(dir.split(/[\\/]/).filter(Boolean).pop() ?? "");
  };

  const location =
    picked === null
      ? joinPath(rootPath, name || "…")
      : useDocs && info
        ? joinPath(picked, info.docs)
        : picked;

  const canCreate = name.length > 0 && !nameError && !busy;

  const submit = async () => {
    if (!canCreate) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate({ name, path: picked, useDocs });
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  };

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="settings" onClick={(e) => e.stopPropagation()}>
        <h1>New project</h1>
        <h2>Name</h2>
        <input
          className="np-name"
          autoFocus
          value={name}
          placeholder="project name…"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") void submit();
            else if (e.key === "Escape") onClose();
          }}
        />
        {nameError && <p className="scan-error">{nameError}</p>}
        <h2>Where it lives</h2>
        <div className="segmented" role="group" aria-label="Where the project lives">
          <button
            className={picked === null ? "active" : undefined}
            onClick={() => {
              setPicked(null);
              setInfo(null);
              setUseDocs(false);
            }}
          >
            Notes folder
          </button>
          <button className={picked !== null ? "active" : undefined} onClick={() => void pick()}>
            {picked === null ? "A folder on disk…" : "Change folder…"}
          </button>
        </div>
        {info?.has_git && (
          <label className="np-check">
            <input
              type="checkbox"
              checked={useDocs}
              onChange={(e) => setUseDocs(e.target.checked)}
            />
            Use the repository’s {info.docs}/ folder
          </label>
        )}
        <div className="np-location">{location}</div>
        {error && <p className="scan-error">{error}</p>}
        <div className="scan-actions">
          <button className="tool-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="tool-btn scan-add" disabled={!canCreate} onClick={() => void submit()}>
            Create project
          </button>
        </div>
      </div>
    </div>
  );
}
