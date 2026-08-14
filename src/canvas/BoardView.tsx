import { useEffect, useMemo, useRef, useState } from "react";
import { FileIcon } from "../fileIcons";
import { colorOf, iconOf } from "../noteTypes";
import { fileOf } from "../paths";
import {
  CanvasNode,
  DEFAULT_NODE_H,
  DEFAULT_NODE_W,
  nodeId,
  parseCanvas,
  serializeCanvas,
} from "./jsoncanvas";

/**
 * A canvas file as a board: its file nodes are cards laid out freely on a
 * pan/zoom surface. The document flows through the same onChange the text
 * editors use — serialization is this module's job, persistence stays the
 * app's — so drafts, dirty state and Ctrl+S all behave as they do everywhere.
 *
 * This module is loaded on demand (dynamic import at the call site): nothing
 * here may be paid for at startup.
 */

/** What a node's `file` path means to the app right now. */
export interface BoardTarget {
  /** Note id when the path resolves into the notes the app knows, else null. */
  id: string | null;
  /** The target is currently listed — false renders as "missing". */
  exists: boolean;
  /** The target file's mtime — keys the excerpt cache, so an edited note's
   * card re-reads its text. */
  modifiedMs: number;
}

export interface BoardMenuEntry {
  label: string;
  run: () => void;
}

interface BoardViewProps {
  initialDoc: string;
  onChange: (doc: string) => void;
  /** Resolve a node's `file` path (relative to this board's folder). */
  resolveTarget: (file: string) => BoardTarget;
  /** Text a card shows under its note's name, null when the note offers none. */
  loadExcerpt: (id: string) => Promise<string | null>;
  /** What a new node stores for a note id: a path relative to this board. */
  fileFor: (id: string) => string;
  /** Notes offered by "Add note" — the board's own project. */
  addItems: { id: string; label: string }[];
  onOpenNote: (id: string) => void;
  /** Right-click menus render through the app's shared context menu. */
  onMenu: (e: React.MouseEvent, entries: BoardMenuEntry[]) => void;
}

const MIN_W = 120;
const MIN_H = 40;
const Z_MIN = 0.25;
const Z_MAX = 2;
/** Pointer travel below this is a click, not a drag — keeps selection clicks
 * from committing micro-moves into the file. */
const DRAG_SLOP = 3;

interface Camera {
  x: number;
  y: number;
  z: number;
}

type Drag =
  | { kind: "pan"; startX: number; startY: number; camX: number; camY: number }
  | {
      kind: "move" | "resize";
      id: string;
      startX: number;
      startY: number;
      orig: CanvasNode[];
      moved: boolean;
    };

const clampZ = (z: number) => Math.min(Z_MAX, Math.max(Z_MIN, z));

export default function BoardView({
  initialDoc,
  onChange,
  resolveTarget,
  loadExcerpt,
  fileFor,
  addItems,
  onOpenNote,
  onMenu,
}: BoardViewProps) {
  const [initial] = useState(() => parseCanvas(initialDoc));
  const [nodes, setNodes] = useState(initial.doc.nodes);
  const [parseError, setParseError] = useState(initial.error);
  const [selected, setSelected] = useState<string | null>(null);
  const [cam, setCam] = useState<Camera>({ x: 0, y: 0, z: 1 });
  const [addOpen, setAddOpen] = useState(false);
  const [query, setQuery] = useState("");

  const outerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const rawRef = useRef(initial.doc.raw);
  /** Last text parsed or emitted — an `initialDoc` that differs is a reload. */
  const docRef = useRef(initialDoc);
  const pastRef = useRef<CanvasNode[][]>([]);
  const futureRef = useRef<CanvasNode[][]>([]);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const camRef = useRef(cam);
  camRef.current = cam;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const emit = (next: CanvasNode[]) => {
    const text = serializeCanvas({ nodes: next, raw: rawRef.current });
    docRef.current = text;
    onChangeRef.current(text);
  };

  /** One undoable step: everything between two commits is one Ctrl+Z. */
  const commit = (next: CanvasNode[]) => {
    pastRef.current.push(nodesRef.current);
    futureRef.current = [];
    setNodes(next);
    emit(next);
  };

  const undo = () => {
    const prev = pastRef.current.pop();
    if (!prev) return false;
    futureRef.current.push(nodesRef.current);
    setNodes(prev);
    emit(prev);
    return true;
  };

  const redo = () => {
    const next = futureRef.current.pop();
    if (!next) return false;
    pastRef.current.push(nodesRef.current);
    setNodes(next);
    emit(next);
    return true;
  };

  // The app re-read the file behind us (external change while the buffer was
  // clean) — the board equivalent of the editor's setDoc: replace everything,
  // history included, so a stale node set can never overwrite the newer file.
  useEffect(() => {
    if (initialDoc === docRef.current) return;
    const { doc, error } = parseCanvas(initialDoc);
    docRef.current = initialDoc;
    rawRef.current = doc.raw;
    setParseError(error);
    setNodes(doc.nodes);
    pastRef.current = [];
    futureRef.current = [];
    setSelected(null);
  }, [initialDoc]);

  /** Zoom keeping the screen point (px, py) fixed under the pointer. */
  const zoomAt = (px: number, py: number, factor: number) =>
    setCam((c) => {
      const nz = clampZ(c.z * factor);
      return {
        x: px - ((px - c.x) / c.z) * nz,
        y: py - ((py - c.y) / c.z) * nz,
        z: nz,
      };
    });

  const zoomCenter = (factor: number) => {
    const el = outerRef.current;
    if (el) zoomAt(el.clientWidth / 2, el.clientHeight / 2, factor);
  };

  const fit = () => {
    const el = outerRef.current;
    const ns = nodesRef.current;
    if (!el || ns.length === 0) {
      setCam({ x: 0, y: 0, z: 1 });
      return;
    }
    const minX = Math.min(...ns.map((n) => n.x)) - 48;
    const minY = Math.min(...ns.map((n) => n.y)) - 48;
    const maxX = Math.max(...ns.map((n) => n.x + n.width)) + 48;
    const maxY = Math.max(...ns.map((n) => n.y + n.height)) + 48;
    const z = clampZ(Math.min(el.clientWidth / (maxX - minX), el.clientHeight / (maxY - minY), 1));
    setCam({
      x: (el.clientWidth - (maxX - minX) * z) / 2 - minX * z,
      y: (el.clientHeight - (maxY - minY) * z) / 2 - minY * z,
      z,
    });
  };

  // Open on the whole board, not wherever the origin happens to sit.
  useEffect(() => {
    if (nodesRef.current.length > 0) fit();
  }, []);

  // Wheel is a native non-passive listener: preventDefault must work (page
  // scroll), and stopPropagation keeps Ctrl+wheel from also driving the app
  // zoom, whose listener sits on the window.
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.ctrlKey) {
        const rect = el.getBoundingClientRect();
        zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.1 : 1 / 1.1);
      } else {
        const dx = e.shiftKey ? e.deltaY : e.deltaX;
        const dy = e.shiftKey ? 0 : e.deltaY;
        setCam((c) => ({ ...c, x: c.x - dx, y: c.y - dy }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const targets = useMemo(() => {
    const m = new Map<string, BoardTarget>();
    for (const n of nodes) if (n.file !== undefined) m.set(n.id, resolveTarget(n.file));
    return m;
  }, [nodes, resolveTarget]);

  const onBoardIds = useMemo(() => {
    const ids = new Set<string>();
    for (const t of targets.values()) if (t.id) ids.add(t.id);
    return ids;
  }, [targets]);

  // Card excerpts, keyed by note id + mtime so an external edit re-reads.
  // Loads are async and the surface re-renders on every drag, so in-flight
  // keys are tracked to keep one read per (note, mtime).
  const [excerpts, setExcerpts] = useState<Map<string, string | null>>(new Map());
  const loadingRef = useRef(new Set<string>());
  const aliveRef = useRef(true);
  useEffect(
    () => () => {
      aliveRef.current = false;
    },
    [],
  );
  const excerptKey = (t: BoardTarget) => `${t.id}@${t.modifiedMs}`;
  useEffect(() => {
    for (const t of targets.values()) {
      if (!t.id || !t.exists) continue;
      const key = excerptKey(t);
      if (excerpts.has(key) || loadingRef.current.has(key)) continue;
      loadingRef.current.add(key);
      const id = t.id;
      void loadExcerpt(id).then((text) => {
        loadingRef.current.delete(key);
        if (!aliveRef.current) return;
        setExcerpts((m) => {
          const next = new Map(m);
          // The same note's older mtimes are dead keys now.
          for (const k of next.keys()) if (k.startsWith(`${id}@`)) next.delete(k);
          next.set(key, text);
          return next;
        });
      });
    }
  }, [targets, loadExcerpt, excerpts]);

  const candidates = addItems.filter(
    (i) => !onBoardIds.has(i.id) && i.label.toLowerCase().includes(query.toLowerCase()),
  );

  const addNote = (id: string) => {
    const el = outerRef.current;
    const c = camRef.current;
    // Viewport center, cascading a little so several adds don't stack.
    const step = (nodesRef.current.length % 5) * 24;
    const cx = el ? (el.clientWidth / 2 - c.x) / c.z : 0;
    const cy = el ? (el.clientHeight / 2 - c.y) / c.z : 0;
    commit([
      ...nodesRef.current,
      {
        id: nodeId(),
        type: "file",
        x: cx - DEFAULT_NODE_W / 2 + step,
        y: cy - DEFAULT_NODE_H / 2 + step,
        width: DEFAULT_NODE_W,
        height: DEFAULT_NODE_H,
        file: fileFor(id),
        raw: {},
      },
    ]);
  };

  const removeNode = (id: string) => {
    commit(nodesRef.current.filter((n) => n.id !== id));
    setSelected((s) => (s === id ? null : s));
  };

  const startPan = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    setSelected(null);
    setAddOpen(false);
    outerRef.current?.focus();
    outerRef.current?.setPointerCapture(e.pointerId);
    dragRef.current = {
      kind: "pan",
      startX: e.clientX,
      startY: e.clientY,
      camX: cam.x,
      camY: cam.y,
    };
  };

  const startNodeDrag = (e: React.PointerEvent, id: string, kind: "move" | "resize") => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setSelected(id);
    setAddOpen(false);
    outerRef.current?.focus();
    outerRef.current?.setPointerCapture(e.pointerId);
    dragRef.current = {
      kind,
      id,
      startX: e.clientX,
      startY: e.clientY,
      orig: nodesRef.current,
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === "pan") {
      setCam((c) => ({ ...c, x: d.camX + e.clientX - d.startX, y: d.camY + e.clientY - d.startY }));
      return;
    }
    if (!d.moved && Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) < DRAG_SLOP)
      return;
    d.moved = true;
    const dx = (e.clientX - d.startX) / camRef.current.z;
    const dy = (e.clientY - d.startY) / camRef.current.z;
    setNodes(
      d.orig.map((n) => {
        if (n.id !== d.id) return n;
        return d.kind === "move"
          ? { ...n, x: n.x + dx, y: n.y + dy }
          : {
              ...n,
              width: Math.max(MIN_W, n.width + dx),
              height: Math.max(MIN_H, n.height + dy),
            };
      }),
    );
  };

  const endDrag = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || d.kind === "pan" || !d.moved) return;
    // The live moves already updated state; record one undo step, and bring a
    // moved node to the front — render order is the file's array order.
    const cur = nodesRef.current;
    const next =
      d.kind === "move"
        ? [...cur.filter((n) => n.id !== d.id), ...cur.filter((n) => n.id === d.id)]
        : cur;
    pastRef.current.push(d.orig);
    futureRef.current = [];
    setNodes(next);
    emit(next);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as Element).closest("input")) return; // the picker owns its keys
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === "z" && !e.shiftKey) {
      if (undo()) {
        e.preventDefault();
        e.stopPropagation();
      }
    } else if ((mod && key === "y") || (mod && e.shiftKey && key === "z")) {
      if (redo()) {
        e.preventDefault();
        e.stopPropagation();
      }
    } else if ((e.key === "Delete" || e.key === "Backspace") && selected) {
      removeNode(selected);
      e.preventDefault();
    }
  };

  if (parseError) {
    return (
      <div className="board board-broken">
        <div>
          <p>
            This canvas file couldn’t be read, so it opened locked — editing it here would overwrite
            whatever it holds.
          </p>
          <p className="board-broken-msg">{parseError}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={outerRef}
      className="board"
      tabIndex={0}
      onPointerDown={startPan}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => {
        e.stopPropagation();
        onMenu(e, [
          { label: "Add note…", run: () => setAddOpen(true) },
          { label: "Fit view", run: fit },
        ]);
      }}
      style={{
        backgroundSize: `${24 * cam.z}px ${24 * cam.z}px`,
        backgroundPosition: `${cam.x}px ${cam.y}px`,
      }}
    >
      <div
        className="board-surface"
        style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})` }}
      >
        {nodes.map((n) => {
          const target = n.file !== undefined ? targets.get(n.id) : undefined;
          const missing = target !== undefined && !target.exists;
          const cls = ["board-node", selected === n.id ? "selected" : "", missing ? "missing" : ""]
            .filter(Boolean)
            .join(" ");
          return (
            <div
              key={n.id}
              className={cls}
              style={{ left: n.x, top: n.y, width: n.width, height: n.height }}
              onPointerDown={(e) => startNodeDrag(e, n.id, "move")}
              onDoubleClick={() => {
                if (target?.id && target.exists) onOpenNote(target.id);
              }}
              onContextMenu={(e) => {
                e.stopPropagation();
                setSelected(n.id);
                onMenu(e, [
                  ...(target?.id && target.exists
                    ? [{ label: "Open note", run: () => onOpenNote(target.id!) }]
                    : []),
                  { label: "Remove from board", run: () => removeNode(n.id) },
                ]);
              }}
            >
              {n.file !== undefined ? (
                <>
                  <div className="board-node-head">
                    <FileIcon icon={iconOf(n.file)} color={colorOf(n.file)} />
                    <span className="board-node-name">{fileOf(n.file)}</span>
                    {missing && <span className="board-node-detail">missing</span>}
                  </div>
                  {target?.id && target.exists && excerpts.get(excerptKey(target)) && (
                    <div className="board-node-body">{excerpts.get(excerptKey(target))}</div>
                  )}
                </>
              ) : n.type === "text" ? (
                <div className="board-node-text">{n.text}</div>
              ) : (
                <span className="board-node-detail">{n.type}</span>
              )}
              {selected === n.id && (
                <div
                  className="board-resize"
                  onPointerDown={(e) => startNodeDrag(e, n.id, "resize")}
                />
              )}
            </div>
          );
        })}
      </div>
      {nodes.length === 0 && (
        <div className="board-hint">
          This board is empty — “Add note” places the project’s notes on it.
        </div>
      )}
      <div className="board-bar" onPointerDown={(e) => e.stopPropagation()}>
        <div className="board-add">
          <button
            className="board-btn"
            data-tip="Place a note on the board"
            onClick={() => setAddOpen((o) => !o)}
          >
            + Add note
          </button>
          {addOpen && (
            <div className="board-picker">
              <input
                autoFocus
                placeholder="Filter notes…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setAddOpen(false);
                    outerRef.current?.focus();
                  } else if (e.key === "Enter" && candidates.length > 0) {
                    addNote(candidates[0].id);
                  }
                }}
              />
              <ul>
                {candidates.slice(0, 40).map((c) => (
                  <li key={c.id}>
                    <button onClick={() => addNote(c.id)}>{c.label}</button>
                  </li>
                ))}
              </ul>
              {candidates.length === 0 && (
                <div className="board-picker-empty">
                  {addItems.length === 0 ? "No notes in this project yet" : "Nothing left to add"}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="board-zoom">
          <button className="board-btn" data-tip="Zoom out" onClick={() => zoomCenter(1 / 1.2)}>
            −
          </button>
          <button
            className="board-btn board-zoom-pct"
            data-tip="Reset zoom"
            onClick={() => setCam((c) => ({ ...c, z: 1 }))}
          >
            {Math.round(cam.z * 100)}%
          </button>
          <button className="board-btn" data-tip="Zoom in" onClick={() => zoomCenter(1.2)}>
            +
          </button>
          <button className="board-btn" data-tip="Fit every node in view" onClick={fit}>
            Fit
          </button>
        </div>
      </div>
    </div>
  );
}
