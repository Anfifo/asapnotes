import { ReactNode, useEffect, useRef, useState } from "react";
import { FileIcon } from "./fileIcons";
import { FileInfo, MountInfo } from "./notes";
import { colorOf, iconOf } from "./noteTypes";
import { fileOf, projectOf } from "./paths";

const RECENT_COUNT = 5;

/** Folder hierarchy of a project's notes (deep external projects). */
interface TreeNode {
  folders: Map<string, TreeNode>;
  /** Full note ids of the files directly in this folder. */
  files: string[];
}

/** `bareDirs` are project-relative folders that get a node whether or not any
 * note was listed under them — mount points and just-created folders — because
 * an empty folder the user put there is still a folder. */
function buildTree(ids: string[], bareDirs: string[]): TreeNode {
  const root: TreeNode = { folders: new Map(), files: [] };
  const folder = (path: string[]) => {
    let node = root;
    for (const seg of path) {
      let child = node.folders.get(seg);
      if (!child) {
        child = { folders: new Map(), files: [] };
        node.folders.set(seg, child);
      }
      node = child;
    }
    return node;
  };
  for (const id of ids) folder(id.split("/").slice(1, -1)).files.push(id);
  for (const at of bareDirs) folder(at.split("/"));
  return root;
}

/** Small link glyph on an attached folder's own row. */
const mountGlyph = (
  <svg className="mount-glyph" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
    <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
  </svg>
);

interface ExplorerProps {
  notes: FileInfo[];
  drafts: FileInfo[];
  projects: string[];
  /** Registered projects whose folder is gone from disk — their headings say
   * so, instead of reading as empty projects. */
  missingProjects: string[];
  /** Folders attached into projects — shown at their mount point, marked there
   * and nowhere below it. */
  mounts: MountInfo[];
  /** Project of the open note — hoisted to the top of the panel. */
  currentProject: string | null;
  /** The open note lives in no project: hoist the loose files instead — all
   * projectless notes and drafts, under the same pane treatment a project gets. */
  looseCurrent: boolean;
  openId: string | null;
  onSelect: (id: string, isNote: boolean) => void;
  /** Right-click on a note/draft row — App shows the context menu. */
  onContext: (e: React.MouseEvent, id: string, isNote: boolean) => void;
  /** Right-click on a project/folder heading ("" = notes root). */
  onDirContext: (e: React.MouseEvent, dir: string) => void;
  /** Right-click on the panel's empty space. */
  onBodyContext: (e: React.MouseEvent) => void;
  /** Begin inline name-first creation in a folder ("" = notes root). */
  onStartCreate: (dir: string) => void;
  /** Folder with an active inline create row, null when none. */
  creatingIn: string | null;
  /** What the create row makes: a note file, a real folder here, or a virtual
   * folder whose backing directory is created in the virtual-folders home. */
  creatingKind: "note" | "folder" | "virtual";
  onCreate: (dir: string, name: string) => void;
  onCreateCancel: () => void;
  /** Folders created this session that hold no note yet. The tree derives from
   * note files, so without this an empty new folder would vanish on sight. */
  newFolders: string[];
  /** Which of the panel's views is showing. */
  view: "files" | "search" | "changes";
  onViewChange: (view: "files" | "search" | "changes") => void;
  /** Rendered in place of the file tree while `view` is "search". */
  searchSlot: ReactNode;
  /** Rendered in place of the file tree while `view` is "changes". */
  changesSlot: ReactNode;
  /** Notes with external edits in the window — the ± button's count. */
  changesCount: number;
  /** Docked beside the editor (true) vs floating over it. */
  pinned: boolean;
  onTogglePin: () => void;
  onCollapse: () => void;
  width: number;
  onResize: (width: number) => void;
  /** Drag finished — the moment to persist the width. */
  onResizeEnd: () => void;
  /** Height of the current-project panel; null sizes it to its content. */
  paneHeight: number | null;
  onPaneResize: (height: number) => void;
  /** Split drag finished — the moment to persist the pane height. */
  onPaneResizeEnd: () => void;
  /** Double-click on a split — back to size-to-content. */
  onPaneReset: () => void;
  /** Panels closed from their header ×; the View menu reopens them. */
  hideRecent: boolean;
  hideNotes: boolean;
  onHideRecent: () => void;
  onHideNotes: () => void;
  /** Where a type's color lands on a row: icon + extension, or icon only. */
  tint: "full" | "icon";
}

/** Side panel: the open note's project first, then recent files (collapsed
 * by default) and the remaining notes grouped by project. */
export function Explorer({
  notes,
  drafts,
  projects,
  missingProjects,
  mounts,
  currentProject,
  looseCurrent,
  openId,
  onSelect,
  onContext,
  onDirContext,
  onBodyContext,
  onStartCreate,
  creatingIn,
  creatingKind,
  onCreate,
  onCreateCancel,
  newFolders,
  view,
  onViewChange,
  searchSlot,
  changesSlot,
  changesCount,
  pinned,
  onTogglePin,
  onCollapse,
  width,
  onResize,
  onResizeEnd,
  paneHeight,
  onPaneResize,
  onPaneResizeEnd,
  onPaneReset,
  hideRecent,
  hideNotes,
  onHideRecent,
  onHideNotes,
  tint,
}: ExplorerProps) {
  const noteNames = new Set(notes.map((n) => n.name));
  const draftIds = new Set(drafts.map((d) => d.name));
  // The panel's left x while a resize drag is active, else null.
  const dragLeft = useRef<number | null>(null);
  // A split drag's start: pointer y and the project panel's height then.
  const paneDrag = useRef<{ y: number; h: number } | null>(null);
  const paneRef = useRef<HTMLElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);
  // Non-current projects start collapsed; a project's tree isn't built until
  // its first expand, so big external projects cost nothing while closed.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Creation targeting a collapsed project expands it so the input is visible.
  useEffect(() => {
    if (creatingIn === null) return;
    const p = creatingIn.split("/")[0];
    if (p && p !== currentProject) {
      setExpanded((s) => (s.has(p) ? s : new Set(s).add(p)));
    }
  }, [creatingIn, currentProject]);

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
  // Whether a pane is hoisted to the top slot: the open note's project, or —
  // for a projectless note — the loose files as a pseudo-project.
  const paneCurrent = currentProject !== null || looseCurrent;
  // The pseudo-project pane's files: every projectless note and draft merged
  // to one entry per name, newest first like Recent — the root has no folder
  // tree to impose another order.
  let looseIds: string[] = [];
  if (looseCurrent) {
    const looseLatest = new Map<string, number>();
    for (const f of [...notes, ...drafts]) {
      if (!projectOf(f.name)) {
        looseLatest.set(f.name, Math.max(looseLatest.get(f.name) ?? 0, f.modified_ms));
      }
    }
    looseIds = [...looseLatest.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  }
  const inProject = (p: string) => notes.filter((n) => projectOf(n.name) === p).map((n) => n.name);
  // Keyed by folder id, so a row only has to ask about itself.
  const mountByDir = new Map(mounts.map((m) => [`${m.project}/${m.at}`, m]));
  // Folders shown whether or not any note was listed under them: mount points,
  // and folders created just now that are still empty.
  const bareDirsIn = (p: string) => [
    ...mounts.filter((m) => m.project === p).map((m) => m.at),
    ...newFolders.filter((d) => projectOf(d) === p).map((d) => d.slice(p.length + 1)),
  ];

  const item = (id: string, showProject = false) => {
    const file = fileOf(id);
    const dot = file.lastIndexOf(".");
    const stem = dot > 0 ? file.slice(0, dot) : file;
    // Every extension shows, the default `.md` included — names render as
    // they are on disk, and the tint marks the type either way.
    const ext = dot > 0 ? file.slice(dot) : "";
    const color = colorOf(id);
    return (
      <li
        key={id}
        className={id === openId ? "current" : undefined}
        onClick={() => onSelect(id, noteNames.has(id))}
        onContextMenu={(e) => onContext(e, id, noteNames.has(id))}
      >
        <FileIcon icon={iconOf(id)} color={color} />
        <span className="explorer-name">
          {stem}
          {ext &&
            (tint === "icon" ? (
              <span className="explorer-ext mute">{ext}</span>
            ) : (
              <span className="explorer-ext" style={color ? { color } : undefined}>
                {ext}
              </span>
            ))}
        </span>
        {showProject && projectOf(id) && <span className="explorer-detail">{projectOf(id)}</span>}
        {draftIds.has(id) && <span className="dirty">●</span>}
      </li>
    );
  };

  /** Hover-revealed "close this panel" button for a panel's heading row. */
  const hideBtn = (onHide: () => void) => (
    <button
      className="hide-btn"
      title="Hide panel — the View menu brings it back"
      onClick={(e) => {
        // On the Recent summary this click would otherwise toggle the list.
        e.preventDefault();
        e.stopPropagation();
        onHide();
      }}
    >
      ×
    </button>
  );

  /** Hover-revealed "new note in this folder" button for a heading row. */
  const addBtn = (dir: string) => (
    <button
      className="add-btn"
      title="New note"
      onClick={(e) => {
        // A summary parent would otherwise toggle its folder on this click.
        e.preventDefault();
        e.stopPropagation();
        onStartCreate(dir);
      }}
    >
      +
    </button>
  );

  // Inline name-first creation: Enter creates, Esc/blur cancels. Key events
  // stop here so the app-level Esc (hide window) and shortcuts don't fire.
  const createRow = (dir: string) => (
    <li className="create-row" key="__create">
      <input
        autoFocus
        placeholder={
          creatingKind === "virtual"
            ? "virtual folder name…"
            : creatingKind === "folder"
              ? "folder name…"
              : "note name…"
        }
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") onCreate(dir, e.currentTarget.value);
          else if (e.key === "Escape") onCreateCancel();
        }}
        onBlur={onCreateCancel}
      />
    </li>
  );

  const renderTree = (node: TreeNode, base: string): ReactNode => {
    // The containers directly under `base` jointly draw one guide line; it
    // turns amber when the open note lives somewhere below.
    const trail = openId?.startsWith(`${base}/`) ? " trail" : "";
    return (
      <>
        {[...node.folders.keys()].sort().map((name) => {
          const dir = `${base}/${name}`;
          const holdsCreate = creatingIn === dir || creatingIn?.startsWith(`${dir}/`);
          // An attached folder says so once, on its own row: inside it the files
          // genuinely do live together, so marking every descendant would read as
          // breakage rather than as information.
          const mount = mountByDir.get(dir);
          return (
            <details
              key={name}
              className={(mount ? "explorer-folder mount" : "explorer-folder") + trail}
              open={holdsCreate || undefined}
            >
              <summary onContextMenu={(e) => onDirContext(e, dir)} title={mount?.path}>
                {mount && mountGlyph}
                <span className="explorer-name">{name}</span>
                {mount?.conflicted && (
                  <span className="explorer-detail">hidden by a real folder</span>
                )}
                {mount && !mount.conflicted && mount.missing && (
                  <span className="explorer-detail">folder is missing</span>
                )}
                {addBtn(dir)}
              </summary>
              {renderTree(node.folders.get(name)!, dir)}
            </details>
          );
        })}
        {(node.files.length > 0 || creatingIn === base) && (
          <ul className={trail ? "trail" : undefined}>
            {creatingIn === base && createRow(base)}
            {node.files.map((id) => item(id))}
          </ul>
        )}
      </>
    );
  };

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
      <summary onContextMenu={(e) => onDirContext(e, p)}>
        <span className="explorer-name">{p}</span>
        {missingProjects.includes(p) && <span className="explorer-detail">folder is missing</span>}
        {addBtn(p)}
      </summary>
      {expanded.has(p) && renderTree(buildTree(inProject(p), bareDirsIn(p)), p)}
    </details>
  );

  const recentVisible = recent.length > 0 && !hideRecent;

  // Recent sizes to its content, so the only adjustable share is the current
  // project's — either gap around Recent drags that same boundary.
  const split = (
    <div
      className="pane-split"
      title="Drag to resize — double-click for size-to-content"
      onPointerDown={(e) => {
        e.preventDefault();
        if (!paneRef.current) return;
        paneDrag.current = { y: e.clientY, h: paneRef.current.getBoundingClientRect().height };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const drag = paneDrag.current;
        if (drag === null || !cardsRef.current) return;
        // Keep both scroll panels usable: the pane never takes the last stretch.
        const max = cardsRef.current.clientHeight - 140;
        onPaneResize(Math.max(48, Math.min(drag.h + e.clientY - drag.y, max)));
      }}
      onPointerUp={(e) => {
        if (paneDrag.current === null) return;
        paneDrag.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
        onPaneResizeEnd();
      }}
      onDoubleClick={onPaneReset}
    />
  );

  // A gap is only a handle while Notes is there to trade height with.
  const sep = paneCurrent && !hideNotes ? split : <div className="pane-gap" />;

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
          <button
            className={view === "changes" ? "view-btn open" : "view-btn"}
            title="Recent changes"
            onClick={() => onViewChange("changes")}
          >
            ±{changesCount > 0 && <span className="view-count">{changesCount}</span>}
          </button>
        </div>
        <button
          className="view-btn"
          title="New note"
          onClick={() => onStartCreate(currentProject ?? "")}
        >
          +
        </button>
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
      {view === "changes" && changesSlot}
      <div
        className="explorer-cards"
        ref={cardsRef}
        hidden={view !== "files"}
        onContextMenu={onBodyContext}
      >
        {paneCurrent && (
          <section
            className="explorer-card pane"
            ref={paneRef}
            // Fills the column when Notes is closed; otherwise an explicit
            // share from a split drag — shrink stays allowed, so a squeezed
            // window never pushes the other panels out.
            style={
              hideNotes
                ? { flex: "1 1 auto" }
                : paneHeight !== null
                  ? { flex: `0 1 ${paneHeight}px` }
                  : undefined
            }
          >
            {currentProject ? (
              <>
                <h2 onContextMenu={(e) => onDirContext(e, currentProject)}>
                  <span className="explorer-name">{currentProject}</span>
                  {missingProjects.includes(currentProject) && (
                    <span className="explorer-detail">folder is missing</span>
                  )}
                  {addBtn(currentProject)}
                </h2>
                {renderTree(
                  buildTree(inProject(currentProject), bareDirsIn(currentProject)),
                  currentProject,
                )}
              </>
            ) : (
              // The open note lives in no project: the loose files hoisted
              // under the name the project selector gives that state.
              <>
                <h2 onContextMenu={(e) => onDirContext(e, "")}>
                  <span className="explorer-name">No project</span>
                  {addBtn("")}
                </h2>
                {(looseIds.length > 0 || creatingIn === "") && (
                  <ul>
                    {creatingIn === "" && createRow("")}
                    {looseIds.map((id) => item(id))}
                  </ul>
                )}
              </>
            )}
          </section>
        )}
        {recentVisible && (
          <>
            {paneCurrent && sep}
            <details className="explorer-recent explorer-card">
              <summary>
                Recent
                {hideBtn(onHideRecent)}
              </summary>
              <ul>{recent.map((id) => item(id, true))}</ul>
            </details>
          </>
        )}
        {!hideNotes && (
          <>
            {(paneCurrent || recentVisible) && sep}
            <section className="explorer-card notes">
              <h2 onContextMenu={(e) => onDirContext(e, "")}>
                <span className="explorer-name">Notes</span>
                {addBtn("")}
                {hideBtn(onHideNotes)}
              </h2>
              {/* Hoisted to the top pane while a projectless note is open —
                  the same exclusion the current project gets below. */}
              {!looseCurrent && (loose.length > 0 || creatingIn === "") && (
                <ul>
                  {creatingIn === "" && createRow("")}
                  {loose.map((n) => item(n.name))}
                </ul>
              )}
              {projects.filter((p) => p !== currentProject).map(projectSection)}
              {notes.length === 0 && <p className="muted">No saved notes yet</p>}
            </section>
          </>
        )}
        {!paneCurrent && !recentVisible && hideNotes && (
          <div className="explorer-card">
            <p className="muted">Panels hidden — the View menu brings them back</p>
          </div>
        )}
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
