import { ReactNode, useRef, useState } from "react";
import { FileInfo } from "./notes";
import { fileOf, projectOf } from "./paths";

const RECENT_COUNT = 5;

/** Folder hierarchy of a project's notes (deep external projects). */
interface TreeNode {
  folders: Map<string, TreeNode>;
  /** Full note ids of the files directly in this folder. */
  files: string[];
}

function buildTree(ids: string[]): TreeNode {
  const root: TreeNode = { folders: new Map(), files: [] };
  for (const id of ids) {
    let node = root;
    for (const seg of id.split("/").slice(1, -1)) {
      let child = node.folders.get(seg);
      if (!child) {
        child = { folders: new Map(), files: [] };
        node.folders.set(seg, child);
      }
      node = child;
    }
    node.files.push(id);
  }
  return root;
}

interface ExplorerProps {
  notes: FileInfo[];
  drafts: FileInfo[];
  projects: string[];
  /** Project of the open note — hoisted to the top of the panel. */
  currentProject: string | null;
  openId: string | null;
  onSelect: (id: string, isNote: boolean) => void;
  /** Right-click on a note/draft row — App shows the context menu. */
  onContext: (e: React.MouseEvent, id: string, isNote: boolean) => void;
  /** Which of the panel's two views is showing. */
  view: "files" | "search";
  onViewChange: (view: "files" | "search") => void;
  /** Rendered in place of the file tree while `view` is "search". */
  searchSlot: ReactNode;
  /** Docked beside the editor (true) vs floating over it. */
  pinned: boolean;
  onTogglePin: () => void;
  onCollapse: () => void;
  width: number;
  onResize: (width: number) => void;
  /** Drag finished — the moment to persist the width. */
  onResizeEnd: () => void;
}

/** Side panel: the open note's project first, then recent files (collapsed
 * by default) and the remaining notes grouped by project, VSCode-style. */
export function Explorer({
  notes,
  drafts,
  projects,
  currentProject,
  openId,
  onSelect,
  onContext,
  view,
  onViewChange,
  searchSlot,
  pinned,
  onTogglePin,
  onCollapse,
  width,
  onResize,
  onResizeEnd,
}: ExplorerProps) {
  const noteNames = new Set(notes.map((n) => n.name));
  const draftIds = new Set(drafts.map((d) => d.name));
  // The panel's left x while a resize drag is active, else null.
  const dragLeft = useRef<number | null>(null);
  // Non-current projects start collapsed; a project's tree isn't built until
  // its first expand, so big external projects cost nothing while closed.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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
  const inProject = (p: string) => notes.filter((n) => projectOf(n.name) === p).map((n) => n.name);

  const item = (id: string, showProject = false) => (
    <li
      key={id}
      className={id === openId ? "current" : undefined}
      onClick={() => onSelect(id, noteNames.has(id))}
      onContextMenu={(e) => onContext(e, id, noteNames.has(id))}
    >
      <span className="explorer-name">{fileOf(id).replace(/\.md$/, "")}</span>
      {showProject && projectOf(id) && <span className="explorer-detail">{projectOf(id)}</span>}
      {draftIds.has(id) && <span className="dirty">●</span>}
    </li>
  );

  const renderTree = (node: TreeNode): ReactNode => (
    <>
      {[...node.folders.keys()].sort().map((name) => (
        <details key={name} className="explorer-folder">
          <summary>{name}</summary>
          {renderTree(node.folders.get(name)!)}
        </details>
      ))}
      {node.files.length > 0 && <ul>{node.files.map((id) => item(id))}</ul>}
    </>
  );

  const projectSection = (p: string) => (
    <details
      key={p}
      open={expanded.has(p)}
      onToggle={(e) => {
        const open = e.currentTarget.open;
        setExpanded((s) => {
          if (s.has(p) === open) return s;
          const next = new Set(s);
          if (open) next.add(p);
          else next.delete(p);
          return next;
        });
      }}
    >
      <summary>{p}</summary>
      {expanded.has(p) && renderTree(buildTree(inProject(p)))}
    </details>
  );

  return (
    <nav className={pinned ? "explorer" : "explorer floating"} style={{ width }}>
      <header className="explorer-bar">
        <div className="explorer-views">
          <button
            className={view === "files" ? "view-btn open" : "view-btn"}
            title="Files"
            onClick={() => onViewChange("files")}
          >
            ▤
          </button>
          <button
            className={view === "search" ? "view-btn open" : "view-btn"}
            title="Search in notes (Ctrl+Shift+F)"
            onClick={() => onViewChange("search")}
          >
            ⌕
          </button>
        </div>
        <button
          className={pinned ? "pin-btn pinned" : "pin-btn"}
          title={pinned ? "Unpin — float over the editor" : "Pin — dock beside the editor"}
          onClick={onTogglePin}
        >
          📌
        </button>
        <button
          className="collapse-btn"
          title="Collapse explorer (Ctrl+Shift+E)"
          onClick={onCollapse}
        >
          «
        </button>
      </header>
      {view === "search" && searchSlot}
      <div className="explorer-body" hidden={view === "search"}>
        {currentProject && (
          <section>
            <h2>{currentProject}</h2>
            {renderTree(buildTree(inProject(currentProject)))}
          </section>
        )}
        {recent.length > 0 && (
          <details className="explorer-recent">
            <summary>Recent</summary>
            <ul>{recent.map((id) => item(id, true))}</ul>
          </details>
        )}
        <section>
          <h2>Notes</h2>
          {loose.length > 0 && <ul>{loose.map((n) => item(n.name))}</ul>}
          {projects.filter((p) => p !== currentProject).map(projectSection)}
          {notes.length === 0 && <p className="muted">No saved notes yet</p>}
        </section>
      </div>
      <div
        className="explorer-resize"
        title="Drag to resize"
        onPointerDown={(e) => {
          e.preventDefault();
          dragLeft.current = e.currentTarget.parentElement!.getBoundingClientRect().left;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (dragLeft.current !== null) onResize(e.clientX - dragLeft.current);
        }}
        onPointerUp={(e) => {
          dragLeft.current = null;
          e.currentTarget.releasePointerCapture(e.pointerId);
          onResizeEnd();
        }}
      />
    </nav>
  );
}
