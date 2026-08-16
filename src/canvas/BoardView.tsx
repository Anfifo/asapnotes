import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import Editor from "../Editor";
import { FileIcon } from "../fileIcons";
import { renderMarkdown } from "../markdown";
import type { MentionItem } from "../mentions";
import type { Feature } from "../noteTypes";
import { colorOf, iconOf } from "../noteTypes";
import { fileOf } from "../paths";
import {
  CanvasEdge,
  CanvasNode,
  DEFAULT_NODE_H,
  DEFAULT_NODE_W,
  DEFAULT_TEXT_H,
  DEFAULT_TEXT_W,
  newId,
  parseCanvas,
  serializeCanvas,
  type Side,
} from "./jsoncanvas";

/**
 * A canvas file as a surface: its nodes are cards laid out freely under a
 * pan/zoom camera. One surface serves both vocabularies — a project board whose
 * nodes are note files, and a freeform canvas of text, images and links — since
 * the format makes no distinction and files from other tools mix them freely.
 * `role` only decides which "add" verbs lead.
 *
 * The document flows through the same onChange the text editors use —
 * serialization is this module's job, persistence stays the app's — so drafts,
 * dirty state, autosave and Ctrl+S all behave as they do everywhere.
 *
 * This module is loaded on demand (dynamic import at the call site): nothing
 * here may be paid for at startup.
 */

/** What a node's `file` path means to the app right now. The spec has no image
 * node — an image is a file node — so resolving a path is also how a card
 * learns which kind of thing it is showing. */
export interface NodeTarget {
  /** `note`: a listed note. `image`: an image file, loadable by the webview.
   * `file`: some other real path, openable externally. `missing`: a
   * note-shaped path with nothing behind it. */
  kind: "note" | "image" | "file" | "missing";
  /** Note id — `note` and `missing` only. */
  id: string | null;
  /** Asset-protocol URL — `image` only. */
  url: string | null;
  /** The target file's mtime — keys the excerpt cache, so an edited note's
   * card re-reads its text. */
  modifiedMs: number;
}

export interface BoardMenuEntry {
  label: string;
  run: () => void;
}

/** What the app drives from outside the surface. Files dropped on the window
 * are intercepted by the webview and arrive as paths at the window level, so
 * the drop has to be handed in rather than listened for here. */
export interface CanvasHandle {
  /** Place images at a point in the window, in CSS pixels. */
  dropImages: (paths: string[], clientX: number, clientY: number) => void;
}

/** What the editor mounted in a focused text block needs from the app. The
 * same values the main editor gets, so a block behaves like a small note. */
export interface BlockEditing {
  onPasteImage: (file: File) => Promise<string | null>;
  resolveImage: (src: string) => string;
  mentionItems: MentionItem[];
  mentionLink: (id: string) => string;
  features: readonly Feature[];
}

interface BoardViewProps {
  initialDoc: string;
  onChange: (doc: string) => void;
  /** Which verbs lead: a project's board offers notes first, any other canvas
   * offers text first. Neither ever refuses a node kind. */
  role: "board" | "canvas";
  /** Absolute directory of the canvas file — what relative paths resolve
   * against, images included. */
  noteDir: string;
  /** Resolve a node's `file` path (relative to this canvas's folder). */
  resolveTarget: (file: string) => NodeTarget;
  /** Text a card shows under its note's name, null when the note offers none. */
  loadExcerpt: (id: string) => Promise<string | null>;
  /** What a new node stores for a note id: a path relative to this canvas. */
  fileFor: (id: string) => string;
  /** Notes offered by "Add note" — the canvas's own project. */
  addItems: { id: string; label: string }[];
  onOpenNote: (id: string) => void;
  /** Follow a link node's URL, or a file node the app doesn't own. */
  onOpenLink: (target: string) => void;
  /** Copy an image at an absolute path into the canvas's assets folder;
   * resolves to the path a node should store, or null when it failed. */
  importImage: (path: string) => Promise<string | null>;
  /** Ask for image files and import them — the "Add image" verb. */
  pickImages: () => Promise<string[]>;
  block: BlockEditing;
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
/** Rendered markdown kept per distinct block text; a session types far fewer
 * distinct texts than this, and a canvas from elsewhere renders once. */
const HTML_CACHE_MAX = 200;
/** Longest side a freshly placed image node gets, in canvas units. Big enough
 * to read, small enough that several fit a screen. */
const IMAGE_MAX = 320;

interface Camera {
  x: number;
  y: number;
  z: number;
}

/** Everything the file holds, and the unit both the undo journal and
 * serialization work in — so authoring edges later needs no new plumbing. */
interface Scene {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

type Drag =
  | { kind: "pan"; startX: number; startY: number; camX: number; camY: number }
  | { kind: "marquee"; startX: number; startY: number; base: Set<string> }
  | { kind: "connect" }
  | {
      kind: "move" | "resize";
      /** Every node the gesture carries — one for a resize, the whole
       * selection for a move. */
      ids: string[];
      /** The node actually pressed, which a click (a press that never moved)
       * narrows the selection down to. */
      pressed: string;
      /** Shift/Ctrl was down: the press already toggled this node, so releasing
       * it must not then collapse the selection. */
      additive: boolean;
      startX: number;
      startY: number;
      orig: Scene;
      moved: boolean;
    };

/** Selection rectangle while it is being dragged, in surface CSS pixels. */
interface Marquee {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const clampZ = (z: number) => Math.min(Z_MAX, Math.max(Z_MIN, z));

/** Do a node's bounds and a rectangle overlap? Both axis-aligned, which is all
 * JSONCanvas allows, so this is the whole hit test. */
const overlaps = (n: CanvasNode, a: { x: number; y: number }, b: { x: number; y: number }) =>
  n.x < Math.max(a.x, b.x) &&
  n.x + n.width > Math.min(a.x, b.x) &&
  n.y < Math.max(a.y, b.y) &&
  n.y + n.height > Math.min(a.y, b.y);

const contains = (n: CanvasNode, p: { x: number; y: number }) =>
  p.x >= n.x && p.x <= n.x + n.width && p.y >= n.y && p.y <= n.y + n.height;

interface Point {
  x: number;
  y: number;
}

const SIDE_ORDER: Side[] = ["top", "right", "bottom", "left"];

const OPPOSITE: Record<Side, Side> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};

/** Midpoint of one side of a node — where an edge attaches. */
const anchorAt = (n: CanvasNode, side: Side): Point => {
  switch (side) {
    case "top":
      return { x: n.x + n.width / 2, y: n.y };
    case "bottom":
      return { x: n.x + n.width / 2, y: n.y + n.height };
    case "left":
      return { x: n.x, y: n.y + n.height / 2 };
    case "right":
      return { x: n.x + n.width, y: n.y + n.height / 2 };
  }
};

/** Which sides face each other, for an edge the file didn't pin down and for
 * every edge this app authors — geometry only, no side picker. */
const facingSides = (a: CanvasNode, b: CanvasNode): [Side, Side] => {
  const dx = b.x + b.width / 2 - (a.x + a.width / 2);
  const dy = b.y + b.height / 2 - (a.y + a.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ["right", "left"] : ["left", "right"];
  return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
};

/** The side of `n` facing a loose point — the target end while connecting. */
const sideFacing = (n: CanvasNode, p: Point): Side => {
  const dx = p.x - (n.x + n.width / 2);
  const dy = p.y - (n.y + n.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
};

/** How far a curve leaves its node before bending toward the other end. */
const BEND = 60;

const controlFor = (p: Point, side: Side, dist: number): Point => {
  switch (side) {
    case "top":
      return { x: p.x, y: p.y - dist };
    case "bottom":
      return { x: p.x, y: p.y + dist };
    case "left":
      return { x: p.x - dist, y: p.y };
    case "right":
      return { x: p.x + dist, y: p.y };
  }
};

/** A cubic leaving both ends perpendicular to the side it attaches to. */
const curve = (a: Point, aSide: Side, b: Point, bSide: Side) => {
  const dist = Math.min(BEND, Math.max(24, Math.hypot(b.x - a.x, b.y - a.y) / 2));
  const c1 = controlFor(a, aSide, dist);
  const c2 = controlFor(b, bSide, dist);
  return {
    d: `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`,
    // Where a label sits: the cubic at t=0.5.
    mid: {
      x: (a.x + 3 * c1.x + 3 * c2.x + b.x) / 8,
      y: (a.y + 3 * c1.y + 3 * c2.y + b.y) / 8,
    },
  };
};

/** Spec colors are a preset "1".."6" or a hex value; both become one CSS
 * custom property the node's own rules pick up. Presets are named rather than
 * numbered so the stylesheet reads. */
const PRESET_COLORS = ["#c8402f", "#c8762f", "#c8a72f", "#4f9e4f", "#3f8fbf", "#8f5fbf"];
const nodeAccent = (color: string | undefined): string | undefined => {
  if (!color) return undefined;
  if (color.startsWith("#")) return color;
  const n = Number(color);
  return Number.isInteger(n) && n >= 1 && n <= 6 ? PRESET_COLORS[n - 1] : undefined;
};

/** Natural size of an image, scaled into IMAGE_MAX — read once, when the node
 * is created, so a picture arrives the right shape without the file ever
 * rewriting node geometry on open. */
const imageSize = (url: string | null): Promise<{ width: number; height: number }> =>
  new Promise((resolve) => {
    const fallback = { width: IMAGE_MAX, height: Math.round(IMAGE_MAX * 0.75) };
    if (!url) return resolve(fallback);
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w || !h) return resolve(fallback);
      const scale = Math.min(1, IMAGE_MAX / w, IMAGE_MAX / h);
      resolve({ width: Math.round(w * scale), height: Math.round(h * scale) });
    };
    img.onerror = () => resolve(fallback);
    img.src = url;
  });

const BoardView = forwardRef<CanvasHandle, BoardViewProps>(function BoardView(
  {
    initialDoc,
    onChange,
    role,
    noteDir,
    resolveTarget,
    loadExcerpt,
    fileFor,
    addItems,
    onOpenNote,
    onOpenLink,
    importImage,
    pickImages,
    block,
    onMenu,
  },
  ref,
) {
  const [initial] = useState(() => parseCanvas(initialDoc));
  const [scene, setScene] = useState<Scene>({
    nodes: initial.doc.nodes,
    edges: initial.doc.edges,
  });
  const [parseError, setParseError] = useState(initial.error);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [selectedEdges, setSelectedEdges] = useState<ReadonlySet<string>>(new Set());
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  /** The connection being dragged: where it starts, and where it points now. */
  const [connect, setConnect] = useState<{ fromNode: string; fromSide: Side; to: Point } | null>(
    null,
  );
  /** Space held: left-drag pans while it is, because the plain left-drag draws
   * the selection rectangle. State, not a ref, so the cursor can say so. */
  const [panReady, setPanReady] = useState(false);
  /** The text node holding the one live editor, if any. */
  const [editing, setEditing] = useState<string | null>(null);
  const [cam, setCam] = useState<Camera>({ x: 0, y: 0, z: 1 });
  const [addOpen, setAddOpen] = useState(false);
  const [query, setQuery] = useState("");

  const outerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const rawRef = useRef(initial.doc.raw);
  /** Last text parsed or emitted — an `initialDoc` that differs is a reload. */
  const docRef = useRef(initialDoc);
  const pastRef = useRef<Scene[]>([]);
  const futureRef = useRef<Scene[]>([]);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const camRef = useRef(cam);
  camRef.current = cam;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const marqueeRef = useRef(marquee);
  marqueeRef.current = marquee;
  const connectRef = useRef(connect);
  connectRef.current = connect;
  /** What the focused block's editor holds right now. Uncommitted by design —
   * a keystroke must not re-render the surface — but a save can land at any
   * moment, so every serialization folds it in. */
  const liveRef = useRef<{ id: string; text: string } | null>(null);
  /** A text box added but never typed in: its blur drops it *and* the journal
   * entry its creation pushed, so one Ctrl+Z doesn't restore an empty box. */
  const pendingAddRef = useRef<string | null>(null);

  /** The scene as it would be written: the focused block's live text folded in. */
  const written = (s: Scene): Scene => {
    const live = liveRef.current;
    if (!live) return s;
    return { ...s, nodes: s.nodes.map((n) => (n.id === live.id ? { ...n, text: live.text } : n)) };
  };

  const emit = (next: Scene) => {
    const { nodes, edges } = written(next);
    const text = serializeCanvas({ nodes, edges, raw: rawRef.current });
    docRef.current = text;
    onChangeRef.current(text);
  };

  /** One undoable step: everything between two commits is one Ctrl+Z. */
  const commit = (next: Scene) => {
    pendingAddRef.current = null;
    pastRef.current.push(sceneRef.current);
    futureRef.current = [];
    setScene(next);
    emit(next);
  };

  /** Replace the scene without touching the journal — for walking it. */
  const restore = (s: Scene) => {
    pendingAddRef.current = null;
    setScene(s);
    emit(s);
  };

  const undo = () => {
    const prev = pastRef.current.pop();
    if (!prev) return false;
    futureRef.current.push(sceneRef.current);
    restore(prev);
    return true;
  };

  const redo = () => {
    const next = futureRef.current.pop();
    if (!next) return false;
    pastRef.current.push(sceneRef.current);
    restore(next);
    return true;
  };

  // The app re-read the file behind us (external change while the buffer was
  // clean) — the equivalent of the editor's setDoc: replace everything,
  // history included, so a stale scene can never overwrite the newer file.
  useEffect(() => {
    if (initialDoc === docRef.current) return;
    const { doc, error } = parseCanvas(initialDoc);
    docRef.current = initialDoc;
    rawRef.current = doc.raw;
    liveRef.current = null;
    pendingAddRef.current = null;
    setParseError(error);
    setScene({ nodes: doc.nodes, edges: doc.edges });
    pastRef.current = [];
    futureRef.current = [];
    setSelected(new Set());
    setSelectedEdges(new Set());
    setEditing(null);
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
    const ns = sceneRef.current.nodes;
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

  // Open on the whole canvas, not wherever the origin happens to sit.
  useEffect(() => {
    if (sceneRef.current.nodes.length > 0) fit();
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
    const m = new Map<string, NodeTarget>();
    for (const n of scene.nodes) if (n.file !== undefined) m.set(n.id, resolveTarget(n.file));
    return m;
  }, [scene.nodes, resolveTarget]);

  const onBoardIds = useMemo(() => {
    const ids = new Set<string>();
    for (const t of targets.values()) if (t.kind === "note" && t.id) ids.add(t.id);
    return ids;
  }, [targets]);

  // Card excerpts, keyed by note id + mtime so an external edit re-reads.
  // Loads are async and the surface re-renders on every drag, so in-flight
  // keys are tracked to keep one read per (note, mtime).
  const [excerpts, setExcerpts] = useState<Map<string, string | null>>(new Map());
  const loadingRef = useRef(new Set<string>());
  const aliveRef = useRef(true);
  // Re-armed on mount, not just cleared on unmount: a remount reuses the same
  // ref, so a mount/unmount/mount cycle would otherwise leave this false and
  // every excerpt that arrives afterwards gets discarded.
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  const excerptKey = (t: NodeTarget) => `${t.id}@${t.modifiedMs}`;
  useEffect(() => {
    for (const t of targets.values()) {
      if (t.kind !== "note" || !t.id) continue;
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

  // Static blocks render through the app's one markdown renderer, cached by
  // the text itself — the surface re-renders on every drag frame, and
  // re-parsing every block for a moved card would be the whole cost of a drag.
  const htmlCacheRef = useRef(new Map<string, string>());
  const htmlFor = (text: string) => {
    const cache = htmlCacheRef.current;
    const hit = cache.get(text);
    if (hit !== undefined) return hit;
    if (cache.size >= HTML_CACHE_MAX) cache.clear();
    const html = renderMarkdown(text, noteDir);
    cache.set(text, html);
    return html;
  };
  // Image links in a block resolve against the canvas's own folder, so a moved
  // canvas re-renders them rather than serving stale URLs.
  useEffect(() => htmlCacheRef.current.clear(), [noteDir]);

  const candidates = addItems.filter(
    (i) => !onBoardIds.has(i.id) && i.label.toLowerCase().includes(query.toLowerCase()),
  );

  /** Canvas coordinates of the viewport's middle, cascaded a little so several
   * adds in a row don't land on top of each other. */
  const dropPoint = (w: number, h: number) => {
    const el = outerRef.current;
    const c = camRef.current;
    const step = (sceneRef.current.nodes.length % 5) * 24;
    const cx = el ? (el.clientWidth / 2 - c.x) / c.z : 0;
    const cy = el ? (el.clientHeight / 2 - c.y) / c.z : 0;
    return { x: cx - w / 2 + step, y: cy - h / 2 + step };
  };

  const addNote = (id: string) => {
    const cur = sceneRef.current;
    commit({
      ...cur,
      nodes: [
        ...cur.nodes,
        {
          id: newId(),
          type: "file",
          ...dropPoint(DEFAULT_NODE_W, DEFAULT_NODE_H),
          width: DEFAULT_NODE_W,
          height: DEFAULT_NODE_H,
          file: fileFor(id),
          raw: {},
        },
      ],
    });
  };

  const addText = () => {
    const cur = sceneRef.current;
    const id = newId();
    setAddOpen(false);
    commit({
      ...cur,
      nodes: [
        ...cur.nodes,
        {
          id,
          type: "text",
          ...dropPoint(DEFAULT_TEXT_W, DEFAULT_TEXT_H),
          width: DEFAULT_TEXT_W,
          height: DEFAULT_TEXT_H,
          text: "",
          raw: {},
        },
      ],
    });
    pendingAddRef.current = id;
    setSelected(new Set([id]));
    setEditing(id);
  };

  /** Place image nodes for paths already inside the canvas's assets folder.
   * `at` is a canvas-space point (a drop); without one they land in the middle. */
  const addImages = async (files: string[], at?: { x: number; y: number }) => {
    const sized = await Promise.all(
      files.map(async (file) => ({ file, ...(await imageSize(resolveTarget(file).url)) })),
    );
    const cur = sceneRef.current;
    commit({
      ...cur,
      nodes: [
        ...cur.nodes,
        ...sized.map((s, i) => {
          // Several at once cascade rather than stacking: `dropPoint` can't
          // tell them apart, since none of them are in the scene yet.
          const p = at ?? dropPoint(s.width, s.height);
          return {
            id: newId(),
            type: "file",
            x: p.x + i * 24,
            y: p.y + i * 24,
            width: s.width,
            height: s.height,
            file: s.file,
            raw: {},
          };
        }),
      ],
    });
  };

  const addPickedImages = () => {
    setAddOpen(false);
    void pickImages().then((files) => {
      if (files.length > 0) void addImages(files);
    });
  };

  // Files dropped on the window reach the app, not the DOM: it hands them here
  // with the pointer position so a picture lands where it was let go.
  useImperativeHandle(ref, () => ({
    dropImages: (paths, clientX, clientY) => {
      void (async () => {
        const imported = await Promise.all(paths.map((p) => importImage(p)));
        const files = imported.filter((f): f is string => f !== null);
        if (files.length === 0) return;
        const rect = outerRef.current?.getBoundingClientRect();
        const c = camRef.current;
        // A position that doesn't land on the surface (a conversion the window
        // scale could still get wrong) is no position at all.
        const inside =
          rect &&
          clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top &&
          clientY <= rect.bottom;
        await addImages(
          files,
          inside
            ? { x: (clientX - rect.left - c.x) / c.z, y: (clientY - rect.top - c.y) / c.z }
            : undefined,
        );
      })();
    },
  }));

  const removeNodes = (ids: string[]) => {
    const gone = new Set(ids);
    const cur = sceneRef.current;
    commit({
      nodes: cur.nodes.filter((n) => !gone.has(n.id)),
      // An edge without both endpoints has nothing to draw between.
      edges: cur.edges.filter((e) => !gone.has(e.fromNode) && !gone.has(e.toNode)),
    });
    setSelected((s) => new Set([...s].filter((id) => !gone.has(id))));
    if (editing !== null && gone.has(editing)) {
      liveRef.current = null;
      setEditing(null);
    }
  };

  const removeEdges = (ids: string[]) => {
    const gone = new Set(ids);
    const cur = sceneRef.current;
    commit({ ...cur, edges: cur.edges.filter((e) => !gone.has(e.id)) });
    setSelectedEdges((s) => new Set([...s].filter((id) => !gone.has(id))));
  };

  /** Leave the focused block: its whole editing session becomes one journal
   * entry. A box added and left empty is dropped instead, add and all. */
  const stopEditing = () => {
    const live = liveRef.current;
    setEditing(null);
    if (!live) return;
    liveRef.current = null;
    const cur = sceneRef.current;
    const node = cur.nodes.find((n) => n.id === live.id);
    if (!node || node.text === live.text) return;
    if (live.text.trim() === "" && pendingAddRef.current === live.id) {
      const before = pastRef.current.pop();
      pendingAddRef.current = null;
      if (before) {
        setSelected(new Set());
        restore(before);
        return;
      }
    }
    commit({
      ...cur,
      nodes: cur.nodes.map((n) => (n.id === live.id ? { ...n, text: live.text } : n)),
    });
  };

  /** Surface CSS coordinates of a pointer event. */
  const localPoint = (e: { clientX: number; clientY: number }) => {
    const rect = outerRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  };

  /** Screen point → canvas coordinates, under the current camera. */
  const toCanvas = (p: { x: number; y: number }) => {
    const c = camRef.current;
    return { x: (p.x - c.x) / c.z, y: (p.y - c.y) / c.z };
  };

  /** Start a connection from one side of a node. */
  const startConnect = (e: React.PointerEvent, id: string, side: Side) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const node = sceneRef.current.nodes.find((n) => n.id === id);
    if (!node) return;
    outerRef.current?.setPointerCapture(e.pointerId);
    dragRef.current = { kind: "connect" };
    setConnect({ fromNode: id, fromSide: side, to: anchorAt(node, side) });
  };

  /** Topmost node under a canvas-space point — render order is array order. */
  const nodeAt = (p: Point, exclude?: string) => {
    const ns = sceneRef.current.nodes;
    for (let i = ns.length - 1; i >= 0; i--) {
      if (ns[i].id !== exclude && contains(ns[i], p)) return ns[i];
    }
    return null;
  };

  /** A press on empty canvas. Left-drag draws a selection rectangle — the
   * surface's primary gesture — and panning moves to the middle button, a
   * held Space, and the wheel, which was already the main way to pan. */
  const startSurfaceDrag = (e: React.PointerEvent) => {
    const panning = e.button === 1 || (e.button === 0 && panReady);
    if (e.button !== 0 && !panning) return;
    stopEditing();
    setAddOpen(false);
    outerRef.current?.focus();
    outerRef.current?.setPointerCapture(e.pointerId);
    if (panning) {
      e.preventDefault(); // the middle button otherwise starts an autoscroll
      dragRef.current = {
        kind: "pan",
        startX: e.clientX,
        startY: e.clientY,
        camX: cam.x,
        camY: cam.y,
      };
      return;
    }
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!additive) setSelected(new Set());
    setSelectedEdges(new Set());
    const p = localPoint(e);
    dragRef.current = {
      kind: "marquee",
      startX: e.clientX,
      startY: e.clientY,
      base: additive ? new Set(selectedRef.current) : new Set(),
    };
    setMarquee({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };

  const startNodeDrag = (e: React.PointerEvent, id: string, kind: "move" | "resize") => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (editing !== null && editing !== id) stopEditing();
    setAddOpen(false);
    setSelectedEdges(new Set());
    // Shift or Ctrl adds to the selection; pressing an unselected node makes it
    // the selection, so a plain drag always moves what was just grabbed.
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    let ids: string[];
    if (additive) {
      const next = new Set(selectedRef.current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSelected(next);
      ids = [...next];
    } else if (kind === "move" && selectedRef.current.has(id) && selectedRef.current.size > 1) {
      ids = [...selectedRef.current];
    } else {
      setSelected(new Set([id]));
      ids = [id];
    }
    // Focus follows the surface, except while a block owns the keyboard.
    if (editing !== id) outerRef.current?.focus();
    outerRef.current?.setPointerCapture(e.pointerId);
    dragRef.current = {
      kind,
      ids: kind === "resize" ? [id] : ids,
      pressed: id,
      additive,
      startX: e.clientX,
      startY: e.clientY,
      orig: sceneRef.current,
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
    if (d.kind === "marquee") {
      const p = localPoint(e);
      setMarquee((m) => (m ? { ...m, x1: p.x, y1: p.y } : m));
      return;
    }
    if (d.kind === "connect") {
      const to = toCanvas(localPoint(e));
      setConnect((c) => (c ? { ...c, to } : c));
      return;
    }
    if (!d.moved && Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) < DRAG_SLOP)
      return;
    d.moved = true;
    const dx = (e.clientX - d.startX) / camRef.current.z;
    const dy = (e.clientY - d.startY) / camRef.current.z;
    const carried = new Set(d.ids);
    setScene({
      ...d.orig,
      nodes: d.orig.nodes.map((n) => {
        if (!carried.has(n.id)) return n;
        return d.kind === "move"
          ? { ...n, x: n.x + dx, y: n.y + dy }
          : {
              ...n,
              width: Math.max(MIN_W, n.width + dx),
              height: Math.max(MIN_H, n.height + dy),
            };
      }),
    });
  };

  const endDrag = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (d.kind === "pan") return;
    if (d.kind === "connect") {
      const c = connectRef.current;
      setConnect(null);
      if (!c) return;
      const target = nodeAt(c.to, c.fromNode);
      if (!target) return; // released on empty canvas: nothing to connect to
      const cur = sceneRef.current;
      // One connection per direction per pair — dragging the same pair again
      // would otherwise stack duplicates nobody can tell apart.
      if (cur.edges.some((x) => x.fromNode === c.fromNode && x.toNode === target.id)) return;
      commit({
        ...cur,
        edges: [
          ...cur.edges,
          {
            id: newId(),
            fromNode: c.fromNode,
            fromSide: c.fromSide,
            toNode: target.id,
            toSide: sideFacing(target, c.to),
            raw: {},
          },
        ],
      });
      return;
    }
    if (d.kind === "marquee") {
      const m = marqueeRef.current;
      setMarquee(null);
      if (!m) return;
      const a = toCanvas({ x: m.x0, y: m.y0 });
      const b = toCanvas({ x: m.x1, y: m.y1 });
      // A rectangle too small to have been drawn on purpose is a click on
      // empty canvas, which clears the selection (already done on press).
      if (Math.abs(m.x1 - m.x0) + Math.abs(m.y1 - m.y0) < DRAG_SLOP) return;
      const next = new Set(d.base);
      for (const n of sceneRef.current.nodes) if (overlaps(n, a, b)) next.add(n.id);
      setSelected(next);
      return;
    }
    if (!d.moved) {
      // A press inside a multi-selection keeps the whole thing, so the group can
      // be dragged; letting go without moving means it was a click after all,
      // and a click selects the one node under it.
      if (d.kind === "move" && !d.additive && d.ids.length > 1) {
        setSelected(new Set([d.pressed]));
      }
      return;
    }
    // The live moves already updated state; record one undo step, and bring
    // moved nodes to the front — render order is the file's array order, and
    // the group keeps its relative order within itself.
    const cur = sceneRef.current;
    const carried = new Set(d.ids);
    const next: Scene =
      d.kind === "move"
        ? {
            ...cur,
            nodes: [
              ...cur.nodes.filter((n) => !carried.has(n.id)),
              ...cur.nodes.filter((n) => carried.has(n.id)),
            ],
          }
        : cur;
    pendingAddRef.current = null;
    pastRef.current.push(d.orig);
    futureRef.current = [];
    setScene(next);
    emit(next);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Whoever ran first won: the app's own chord table, or the focused block's
    // editor. CodeMirror's undo returns false on an empty history without
    // preventing the default, which is exactly how Ctrl+Z past the start of a
    // block's history falls through to the canvas journal.
    if (e.defaultPrevented) return;
    if ((e.target as Element).closest("input")) return; // the picker owns its keys
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (e.key === "Escape" && editing !== null) {
      stopEditing();
      outerRef.current?.focus();
      // The window's Esc means "hide"; an open block owns the key instead.
      e.preventDefault();
      e.stopPropagation();
    } else if (mod && key === "z" && !e.shiftKey) {
      if (undo()) {
        e.preventDefault();
        e.stopPropagation();
      }
    } else if ((mod && key === "y") || (mod && e.shiftKey && key === "z")) {
      if (redo()) {
        e.preventDefault();
        e.stopPropagation();
      }
    } else if (mod && key === "a" && editing === null) {
      setSelected(new Set(scene.nodes.map((n) => n.id)));
      e.preventDefault();
      e.stopPropagation();
    } else if (e.key === "Enter" && editing === null && selected.size === 1) {
      const only = [...selected][0];
      if (scene.nodes.find((n) => n.id === only)?.type === "text") {
        setEditing(only);
        e.preventDefault();
      }
    } else if (
      (e.key === "Delete" || e.key === "Backspace") &&
      editing === null &&
      (selected.size > 0 || selectedEdges.size > 0)
    ) {
      // Nodes take their own edges with them, so removing both would try to
      // drop the same connection twice.
      if (selected.size > 0) removeNodes([...selected]);
      else removeEdges([...selectedEdges]);
      e.preventDefault();
    } else if (e.code === "Space" && editing === null) {
      // Held Space turns left-drag back into a pan, since the plain left-drag
      // is the selection rectangle. Swallowed so it can't press a button.
      setPanReady(true);
      e.preventDefault();
    }
  };

  const onKeyUp = (e: React.KeyboardEvent) => {
    if (e.code === "Space") setPanReady(false);
  };

  /** Body of one node, by what the spec says it is. Unknown types keep their
   * name on screen rather than rendering as an empty box. */
  const nodeBody = (n: CanvasNode) => {
    if (n.type === "group") {
      return n.label ? <div className="board-group-label">{n.label}</div> : null;
    }
    if (n.type === "link" && n.url) {
      // A URL, not an embed: rendering the page would be a network request the
      // user never asked for. Opening it is a click away, and explicit.
      return (
        <div className="board-link-body">
          <span className="board-node-name">{n.url.replace(/^https?:\/\//, "")}</span>
          <span className="board-node-detail">link</span>
        </div>
      );
    }
    if (n.file !== undefined) {
      const target = targets.get(n.id);
      if (target?.kind === "image" && target.url) {
        return <img className="board-node-image" src={target.url} alt={fileOf(n.file)} />;
      }
      const excerpt = target?.kind === "note" ? excerpts.get(excerptKey(target)) : null;
      return (
        <>
          <div className="board-node-head">
            <FileIcon icon={iconOf(n.file)} color={colorOf(n.file)} />
            <span className="board-node-name">{fileOf(n.file)}</span>
            {target?.kind === "missing" && <span className="board-node-detail">missing</span>}
            {target?.kind === "file" && <span className="board-node-detail">file</span>}
          </div>
          {excerpt && <div className="board-node-body">{excerpt}</div>}
        </>
      );
    }
    if (n.type === "text") {
      if (editing === n.id) {
        return (
          <Editor
            docKey={n.id}
            initialDoc={n.text ?? ""}
            // Both classes on purpose: a block is an editor, so every
            // live-preview rule scoped to `.editor` applies, and the block
            // class only re-sizes it for a card.
            className="editor board-block-editor"
            placeholder="Type…"
            onChange={(text) => {
              liveRef.current = { id: n.id, text };
              emit(sceneRef.current);
            }}
            onPasteImage={block.onPasteImage}
            resolveImage={block.resolveImage}
            mentionItems={block.mentionItems}
            mentionLink={block.mentionLink}
            onOpenLink={onOpenLink}
            view="markdown"
            features={block.features}
          />
        );
      }
      return n.text ? (
        <div className="board-node-text" dangerouslySetInnerHTML={{ __html: htmlFor(n.text) }} />
      ) : (
        <div className="board-node-detail">Empty text</div>
      );
    }
    return <span className="board-node-detail">{n.type}</span>;
  };

  /** What double-clicking a node does: open what it stands for. */
  const openNode = (n: CanvasNode) => {
    if (n.type === "text") {
      setEditing(n.id);
      return;
    }
    if (n.type === "link" && n.url) {
      onOpenLink(n.url);
      return;
    }
    const target = n.file !== undefined ? targets.get(n.id) : undefined;
    if (!target || n.file === undefined) return;
    if (target.kind === "note" && target.id) onOpenNote(target.id);
    else if (target.kind === "image" || target.kind === "file") onOpenLink(n.file);
  };

  /** Right-clicking inside a multi-selection acts on all of it; right-clicking
   * outside one makes that node the selection first. */
  const nodeEntries = (n: CanvasNode, ids: string[]): BoardMenuEntry[] => {
    const target = n.file !== undefined ? targets.get(n.id) : undefined;
    const entries: BoardMenuEntry[] = [];
    if (ids.length === 1) {
      if (n.type === "text") entries.push({ label: "Edit text", run: () => setEditing(n.id) });
      if (target?.kind === "note" && target.id)
        entries.push({ label: "Open note", run: () => onOpenNote(target.id!) });
      if (n.type === "link" && n.url)
        entries.push({ label: "Open link", run: () => onOpenLink(n.url!) });
      if ((target?.kind === "image" || target?.kind === "file") && n.file)
        entries.push({ label: "Open externally", run: () => onOpenLink(n.file!) });
    }
    entries.push({
      label: ids.length > 1 ? `Remove ${ids.length} nodes from canvas` : "Remove from canvas",
      run: () => removeNodes(ids),
    });
    return entries;
  };

  const surfaceEntries = (): BoardMenuEntry[] => {
    const note = { label: "Add note…", run: () => setAddOpen(true) };
    const content = [
      { label: "Add text", run: addText },
      { label: "Add image…", run: addPickedImages },
    ];
    return [
      ...(role === "board" ? [note, ...content] : [...content, note]),
      { label: "Fit view", run: fit },
    ];
  };

  /** Images pasted onto the surface become nodes. A focused block keeps its own
   * paste — there the picture belongs in the text, as a markdown link. */
  const onPaste = (e: React.ClipboardEvent) => {
    if (editing !== null || e.defaultPrevented) return;
    const images = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    e.preventDefault();
    void (async () => {
      const saved = await Promise.all(images.map((f) => block.onPasteImage(f)));
      const files = saved.filter((f): f is string => f !== null);
      if (files.length > 0) await addImages(files);
    })();
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

  const renderNode = (n: CanvasNode) => {
    const target = n.file !== undefined ? targets.get(n.id) : undefined;
    const accent = nodeAccent(n.color);
    const only = selected.has(n.id) && selected.size === 1 && editing !== n.id;
    const cls = [
      "board-node",
      `board-node-${n.type === "group" || n.type === "link" ? n.type : "box"}`,
      selected.has(n.id) ? "selected" : "",
      editing === n.id ? "editing" : "",
      target?.kind === "missing" ? "missing" : "",
      target?.kind === "image" ? "image" : "",
      accent ? "accent" : "",
    ]
      .filter(Boolean)
      .join(" ");
    return (
      <div
        key={n.id}
        className={cls}
        style={
          {
            left: n.x,
            top: n.y,
            width: n.width,
            height: n.height,
            ...(accent ? { "--node-accent": accent } : {}),
          } as React.CSSProperties
        }
        onPointerDown={(e) => {
          // While this block is being edited, only its grip drags it: the
          // pointer belongs to CodeMirror, and the press must not reach the
          // surface, whose own handler would end the edit.
          if (editing === n.id) {
            e.stopPropagation();
            return;
          }
          startNodeDrag(e, n.id, "move");
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          openNode(n);
        }}
        onContextMenu={(e) => {
          e.stopPropagation();
          const ids = selected.has(n.id) ? [...selected] : [n.id];
          if (!selected.has(n.id)) setSelected(new Set([n.id]));
          setSelectedEdges(new Set());
          onMenu(e, nodeEntries(n, ids));
        }}
      >
        {editing === n.id && (
          <div
            className="board-node-grip"
            data-tip="Drag to move"
            onPointerDown={(e) => startNodeDrag(e, n.id, "move")}
          />
        )}
        {nodeBody(n)}
        {/* Connection handles, on the single selected node: drag one onto
            another node to link them. Inside the border, because the card
            clips its own overflow. */}
        {only &&
          SIDE_ORDER.map((side) => (
            <div
              key={side}
              className={`board-anchor board-anchor-${side}`}
              data-tip="Drag to connect"
              onPointerDown={(e) => startConnect(e, n.id, side)}
            />
          ))}
        {/* One node at a time resizes: a group resize would have to decide
            whether it scales or stretches, which is its own design question. */}
        {only && (
          <div className="board-resize" onPointerDown={(e) => startNodeDrag(e, n.id, "resize")} />
        )}
      </div>
    );
  };

  // Groups are backdrops the spec paints behind everything else; connections
  // ride above them and below the cards they join.
  const groups = scene.nodes.filter((n) => n.type === "group");
  const cards = scene.nodes.filter((n) => n.type !== "group");
  const byId = new Map(scene.nodes.map((n) => [n.id, n]));
  const drawnEdges = scene.edges.flatMap((e) => {
    const from = byId.get(e.fromNode);
    const to = byId.get(e.toNode);
    // A dangling edge stays in the file (some other tool's business) but there
    // is nothing to draw it between.
    if (!from || !to) return [];
    const facing = facingSides(from, to);
    const fromSide = e.fromSide ?? facing[0];
    const toSide = e.toSide ?? facing[1];
    const { d, mid } = curve(anchorAt(from, fromSide), fromSide, anchorAt(to, toSide), toSide);
    return [{ edge: e, d, mid }];
  });
  const connectPreview = (() => {
    if (!connect) return null;
    const from = byId.get(connect.fromNode);
    if (!from) return null;
    // The loose end curves in as if it were arriving at a node facing back the
    // way the line left — it settles onto a real side once it lands.
    return curve(
      anchorAt(from, connect.fromSide),
      connect.fromSide,
      connect.to,
      OPPOSITE[connect.fromSide],
    ).d;
  })();

  return (
    <div
      ref={outerRef}
      // `board-editing` tells the window's Esc handler that a block owns the key.
      className={["board", editing !== null ? "board-editing" : "", panReady ? "board-pan" : ""]
        .filter(Boolean)
        .join(" ")}
      tabIndex={0}
      // Space held when focus leaves would otherwise stay held forever.
      onBlur={() => setPanReady(false)}
      onPointerDown={startSurfaceDrag}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onPaste={onPaste}
      onContextMenu={(e) => {
        e.stopPropagation();
        onMenu(e, surfaceEntries());
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
        {groups.map(renderNode)}
        <svg className="board-edges">
          <defs>
            {/* `context-stroke` gives the head the line's own color, so a
                foreign file's edge colors carry through to the arrow. */}
            <marker
              id="board-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
            </marker>
          </defs>
          {drawnEdges.map(({ edge, d, mid }) => {
            const accent = nodeAccent(edge.color);
            return (
              <g
                key={edge.id}
                className={selectedEdges.has(edge.id) ? "board-edge selected" : "board-edge"}
                style={accent ? ({ "--node-accent": accent } as React.CSSProperties) : undefined}
              >
                <path
                  className="board-edge-hit"
                  d={d}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setSelected(new Set());
                    setSelectedEdges(new Set([edge.id]));
                    outerRef.current?.focus();
                  }}
                  onContextMenu={(e) => {
                    e.stopPropagation();
                    setSelected(new Set());
                    setSelectedEdges(new Set([edge.id]));
                    onMenu(e, [{ label: "Remove connection", run: () => removeEdges([edge.id]) }]);
                  }}
                />
                <path
                  className="board-edge-line"
                  d={d}
                  markerStart={edge.fromEnd === "arrow" ? "url(#board-arrow)" : undefined}
                  markerEnd={edge.toEnd === "none" ? undefined : "url(#board-arrow)"}
                />
                {edge.label && (
                  <text className="board-edge-label" x={mid.x} y={mid.y}>
                    {edge.label}
                  </text>
                )}
              </g>
            );
          })}
          {connectPreview && <path className="board-edge-preview" d={connectPreview} />}
        </svg>
        {cards.map(renderNode)}
      </div>
      {/* Selection rectangle: screen space, so it doesn't scale with the camera. */}
      {marquee && (
        <div
          className="board-marquee"
          style={{
            left: Math.min(marquee.x0, marquee.x1),
            top: Math.min(marquee.y0, marquee.y1),
            width: Math.abs(marquee.x1 - marquee.x0),
            height: Math.abs(marquee.y1 - marquee.y0),
          }}
        />
      )}
      {scene.nodes.length === 0 && (
        <div className="board-hint">
          {role === "board"
            ? "This board is empty — “Add note” places the project’s notes on it."
            : "This canvas is empty — “Text” drops a box you can write in."}
        </div>
      )}
      <div className="board-bar" onPointerDown={(e) => e.stopPropagation()}>
        <div className="board-add">
          {(role === "board" ? ["note", "text", "image"] : ["text", "image", "note"]).map((verb) =>
            verb === "note" ? (
              <button
                key={verb}
                className="board-btn"
                data-tip={role === "board" ? "Place a note on the board" : "Place a note here"}
                onClick={() => setAddOpen((o) => !o)}
              >
                {role === "board" ? "+ Add note" : "+ Note"}
              </button>
            ) : verb === "text" ? (
              <button
                key={verb}
                className="board-btn"
                data-tip="Drop a text box (paste or drop images anywhere)"
                onClick={addText}
              >
                + Text
              </button>
            ) : (
              <button
                key={verb}
                className="board-btn"
                data-tip="Place an image file"
                onClick={addPickedImages}
              >
                + Image
              </button>
            ),
          )}
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
});

export default BoardView;
