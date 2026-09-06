import { ReactNode, SyntheticEvent, useEffect, useRef, useState } from "react";
import { FileIcon } from "./fileIcons";
import { Icon } from "./icons";
import { FileInfo, MountInfo } from "./notes";
import { colorOf, iconOf } from "./noteTypes";
import { fileOf, projectOf } from "./paths";

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
  /** Open a project's map — the computed view of its notes and references. */
  onOpenMap: (project: string) => void;
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
  /** Notes panel closed from its header ×; the View menu reopens it. */
  hideNotes: boolean;
  onHideNotes: () => void;
  /** Where a type's color lands on a row: icon + extension, or icon only. */
  tint: "full" | "icon";
}

/** Side panel: the open note's project first, then the remaining notes
 * grouped by project. */
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
  onOpenMap,
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
  hideNotes,
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
  // Fold state per section, keyed by project name; "" is the "No project"
  // section, the id the root already has everywhere else here. Loose notes are
  // the capture inbox, so that one starts open; projects start collapsed, and
  // a project's tree isn't built until its first expand, so big external
  // projects cost nothing while closed.
  const [expanded, setExpanded] = useState<Set<string>>(new Set([""]));
  const toggleFold = (key: string) => (e: SyntheticEvent<HTMLDetailsElement>) => {
    const open = e.currentTarget.open;
    setExpanded((s) => {
      if (s.has(key) === open) return s;
      const next = new Set(s);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  // Creation targeting a collapsed section expands it so the input is visible.
  // A hoisted section (the current project, or the loose files while a
  // projectless note is open) renders in the top pane, which has no fold.
  useEffect(() => {
    if (creatingIn === null) return;
    const p = creatingIn.split("/")[0];
    const hoisted = p === "" ? looseCurrent : p === currentProject;
    if (!hoisted) {
      setExpanded((s) => (s.has(p) ? s : new Set(s).add(p)));
    }
  }, [creatingIn, currentProject, looseCurrent]);

  const loose = notes.filter((n) => !projectOf(n.name));
  // Whether a pane is hoisted to the top slot: the open note's project, or —
  // for a projectless note — the loose files as a pseudo-project.
  const paneCurrent = currentProject !== null || looseCurrent;
  // The pseudo-project pane's files: every projectless note and draft merged
  // to one entry per name, newest first — the root has no folder tree to
  // impose another order.
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

  const item = (id: string) => {
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
        {draftIds.has(id) && <span className="dirty" />}
      </li>
    );
  };

  /** Hover-revealed "close this panel" button for a panel's heading row. */
  const hideBtn = (onHide: () => void) => (
    <button
      className="hide-btn"
      aria-label="Hide panel"
      data-tip="Hide panel — the View menu brings it back"
      onClick={(e) => {
        e.stopPropagation();
        onHide();
      }}
    >
      <Icon name="x" />
    </button>
  );

  /** The MAP chip — project headings only, since the map is per project.
   * Always visible, worded, wearing the network glyph: the one heading action
   * that opens a surface rather than creating something, so it earns a
   * permanent, named presence where the hover-revealed + does not. */
  const mapChip = (p: string) => (
    <button
      className="map-chip"
      aria-label="Open project map"
      data-tip="Open project map"
      onClick={(e) => {
        // A summary parent would otherwise toggle its folder on this click.
        e.preventDefault();
        e.stopPropagation();
        onOpenMap(p);
      }}
    >
      <Icon name="map" />
      MAP
    </button>
  );

  /** Hover-revealed "new note in this folder" button for a heading row. */
  const addBtn = (dir: string) => (
    <button
      className="add-btn"
      aria-label="New note"
      data-tip="New note"
      onClick={(e) => {
        // A summary parent would otherwise toggle its folder on this click.
        e.preventDefault();
        e.stopPropagation();
        onStartCreate(dir);
      }}
    >
      <Icon name="plus" />
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
              <summary onContextMenu={(e) => onDirContext(e, dir)} data-tip={mount?.path}>
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

  // The loose notes as a section of the Notes card, first among the projects:
  // one row per projectless note, no MAP chip since the map is per project.
  // Shown even when empty so its + is always a target, like a project with
  // no notes yet.
  const looseSection = (
    <details key="" open={expanded.has("")} onToggle={toggleFold("")}>
      <summary onContextMenu={(e) => onDirContext(e, "")}>
        <span className="explorer-name">No project</span>
        {addBtn("")}
      </summary>
      {(loose.length > 0 || creatingIn === "") && (
        <ul>
          {creatingIn === "" && createRow("")}
          {loose.map((n) => item(n.name))}
        </ul>
      )}
    </details>
  );

  const projectSection = (p: string) => (
    <details key={p} open={expanded.has(p)} onToggle={toggleFold(p)}>
      <summary
        onContextMenu={(e) => onDirContext(e, p)}
        // Double-click moves into the project: its map opens, which also
        // makes it the current project. The two clicks toggle the fold twice
        // — net zero, so the heading ends where it started.
        onDoubleClick={(e) => {
          if ((e.target as Element).closest("button")) return;
          onOpenMap(p);
        }}
      >
        <span className="explorer-name">{p}</span>
        {missingProjects.includes(p) && <span className="explorer-detail">folder is missing</span>}
        {mapChip(p)}
        {addBtn(p)}
      </summary>
      {expanded.has(p) && renderTree(buildTree(inProject(p), bareDirsIn(p)), p)}
    </details>
  );

  // The gap between the two panels drags the current project's share.
  const split = (
    <div
      className="pane-split"
      data-tip="Drag to resize — double-click for size-to-content"
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
      {/* The bar has no rows of its own, so its right-click is the panel body's. */}
      <header className="explorer-bar" onContextMenu={onBodyContext}>
        <div className="explorer-views">
          <button
            className={view === "files" ? "bar-btn open" : "bar-btn"}
            aria-label="Files"
            data-tip="Files"
            onClick={() => onViewChange("files")}
          >
            <Icon name="files" />
          </button>
          <button
            className={view === "search" ? "bar-btn open" : "bar-btn"}
            aria-label="Search in notes"
            data-tip="Search in notes (Ctrl+Shift+F)"
            onClick={() => onViewChange("search")}
          >
            <Icon name="search" />
          </button>
          <button
            className={view === "changes" ? "bar-btn open" : "bar-btn"}
            aria-label="Recent changes"
            data-tip="Recent changes"
            onClick={() => onViewChange("changes")}
          >
            <Icon name="diff" />
            {changesCount > 0 && <span className="view-count">{changesCount}</span>}
          </button>
        </div>
        {/* Seam between what is looked at (the views) and what is done (the actions). */}
        <span className="bar-sep" />
        <button
          className="bar-btn"
          aria-label="New note"
          data-tip="New note"
          onClick={() => onStartCreate(currentProject ?? "")}
        >
          <Icon name="plus" />
        </button>
        <button
          className={pinned ? "bar-btn pin pinned" : "bar-btn pin"}
          aria-label={pinned ? "Unpin explorer" : "Pin explorer"}
          data-tip={pinned ? "Unpin — float over the editor" : "Pin — dock beside the editor"}
          onClick={onTogglePin}
        >
          <Icon name="pin" />
        </button>
        <button
          className="bar-btn"
          aria-label="Collapse explorer"
          data-tip="Collapse explorer (Ctrl+Shift+E)"
          onClick={onCollapse}
        >
          <Icon name="panel-left-close" />
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
                  {mapChip(currentProject)}
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
        {!hideNotes && (
          <>
            {paneCurrent && sep}
            <section className="explorer-card notes">
              <h2 onContextMenu={(e) => onDirContext(e, "")}>
                <span className="explorer-name">Notes</span>
                {addBtn("")}
                {hideBtn(onHideNotes)}
              </h2>
              {/* Hoisted to the top pane while a projectless note is open —
                  the same exclusion the current project gets below. */}
              {!looseCurrent && looseSection}
              {projects.filter((p) => p !== currentProject).map(projectSection)}
              {notes.length === 0 && <p className="muted">No saved notes yet</p>}
            </section>
          </>
        )}
        {!paneCurrent && hideNotes && (
          <div className="explorer-card">
            <p className="muted">Panels hidden — the View menu brings them back</p>
          </div>
        )}
      </div>
      <div
        className="explorer-resize"
        data-tip="Drag to resize"
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
