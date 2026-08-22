import { forwardRef, memo, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
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
  type InkStroke,
  newId,
  parseCanvas,
  serializeCanvas,
  type Side,
} from "./jsoncanvas";
import { nodeAccent, PRESET_COLORS, strokePath } from "./ink";

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

export type BoardMenuEntry = { label: string; run: () => void } | "sep";

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
  /** Open a file card that isn't a note — the app decides between its
   * read-only file view and the system default. Without it, such cards fall
   * back to opening externally. */
  onOpenFile?: (file: string) => void;
  /** Copy an image at an absolute path into the canvas's assets folder;
   * resolves to the path a node should store, or null when it failed. */
  importImage: (path: string) => Promise<string | null>;
  /** Ask for image files and import them — the "Add image" verb. */
  pickImages: () => Promise<string[]>;
  block: BlockEditing;
  /** Right-click menus render through the app's shared context menu. */
  onMenu: (e: React.MouseEvent, entries: BoardMenuEntry[]) => void;
  /** App-level file verbs (reveal, delete…) appended to a card's menu on a
   * read-only lens — the app supplies them so the map card and the explorer
   * row speak the same menu. */
  fileVerbs?: (target: NodeTarget, file: string) => BoardMenuEntry[];
  /** Whether the type declares the `ink` feature — gates the Draw tools the
   * same way `images` gates drops. Foreign strokes render regardless. */
  inkTools: boolean;
  /** A computed lens (the project map): everything renders and opens, nothing
   * edits. Left-drag pans, the add and draw verbs are gone, and menus keep
   * only their open-things entries. */
  readOnly?: boolean;
  /** The image-annotation lens: rides the read-only gates (nothing selects,
   * moves or deletes) but keeps the ink tools live — the pen comes up raised
   * with a preset color, and the save verb flattens instead of snapshotting.
   * Only meaningful together with `readOnly` and `inkTools`. */
  annotate?: boolean;
  /** Offered on a read-only surface: snapshot what is shown into a real,
   * editable canvas file (or, on the annotation lens, flatten the drawing
   * into the image). The lens raises it from its own menu; the annotation lens
   * also wears it as a button, because flattening is what that tab is for. */
  onSaveAs?: () => void;
  /** Where to open the camera, read once at mount. A tab that remounts every
   * time it is activated can't hold its own pan and zoom, so the app keeps
   * them and hands them back here. Absent (or null): fit the content, which
   * is what a surface seen for the first time wants. */
  camera?: Camera | null;
  /** Every camera move, for the app to remember. */
  onCamera?: (cam: Camera) => void;
  /** What an empty surface says — a computed lens has its own story. */
  emptyHint?: string;
}

const MIN_W = 120;
const MIN_H = 40;
/** Zoom bounds, a factor of ten either side of 1 — so the slider's middle is
 * 100%, its ends are 10% and 1000%, and its position is just log10(z). */
const Z_MIN = 0.1;
const Z_MAX = 10;
/** Pointer travel below this is a click, not a drag — keeps selection clicks
 * from committing micro-moves into the file. */
const DRAG_SLOP = 3;
/** Rendered markdown kept per distinct block text; a session types far fewer
 * distinct texts than this, and a canvas from elsewhere renders once. */
const HTML_CACHE_MAX = 200;
/** Longest side a freshly placed image node gets, in canvas units. Big enough
 * to read, small enough that several fit a screen. */
const IMAGE_MAX = 320;
/** Margin kept between strokes and their ink node's border. */
const INK_PAD = 8;
/** An ink node can be a single dot, so the card minimum would be absurd. */
const INK_MIN = 24;
/** Pen widths on offer, in canvas units: fine and wide. */
const INK_WIDTHS = [2, 5] as const;
/** Eraser reach in screen pixels, so it stays forgiving at any zoom. */
const ERASE_RADIUS = 6;
/** Reach for pressing a stroke with the pointer, in screen pixels. */
const PICK_RADIUS = 4;
export interface Camera {
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
  /** A stroke being drawn: points in canvas coordinates until it commits. */
  | { kind: "ink"; points: [number, number, number][] }
  /** An eraser pass: strokes vanish live, one journal entry on release. */
  | { kind: "erase"; orig: Scene; erased: boolean }
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

/** Which of the stylesheet's six folder-tab color pairs a folder wears — a
 * stable hash of its path, so a folder keeps its color across recomputes.
 * Tabs are lens-only chrome, never persisted, so these are free of the spec's
 * six canvas colors. */
const folderColor = (path: string) => {
  let h = 5381;
  for (let i = 0; i < path.length; i++) h = (h * 33 + path.charCodeAt(i)) >>> 0;
  return `var(--folder-${h % 6})`;
};

/** Pointer pressure for a stroke point: 0.5 is the neutral "no pen data"
 * value, which is also what a mouse reports — a zero (some pens on hover
 * transitions) would draw nothing. */
const penPressure = (e: { pressure: number }) => (e.pressure > 0 ? e.pressure : 0.5);

/** Bounding box of stroke points, padded so the line's own width (up to its
 * 2× pressure ceiling) never clips at the node border. */
const strokeBounds = (points: [number, number, number][], width: number) => {
  const pad = width + INK_PAD;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
};

const shiftStroke = (s: InkStroke, dx: number, dy: number): InkStroke =>
  dx === 0 && dy === 0 ? s : { ...s, points: s.points.map(([x, y, p]) => [x + dx, y + dy, p]) };

/** Distance from a point to the segment a→b. */
const distToSeg = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

/** Is a node-local point within `reach` of the stroke's polyline? */
const strokeNear = (q: Point, s: InkStroke, reach: number) => {
  const pts = s.points;
  if (pts.length === 1) return Math.hypot(q.x - pts[0][0], q.y - pts[0][1]) <= reach;
  for (let i = 1; i < pts.length; i++) {
    if (
      distToSeg(q, { x: pts[i - 1][0], y: pts[i - 1][1] }, { x: pts[i][0], y: pts[i][1] }) <= reach
    )
      return true;
  }
  return false;
};

/** An ink node's bitmap — a cache of the vector strokes, which stay the truth
 * in the file. Redrawn when the strokes change and re-rasterized (debounced)
 * when zoom settles; during a drag or zoom frame the bitmap only rides the
 * surface transform, so no frame ever pays for rasterization. */
const InkCanvas = memo(function InkCanvas({
  node,
  zoom,
  themeTick,
}: {
  node: CanvasNode;
  zoom: number;
  /** Bumped when the app theme swaps: the default stroke color is the theme's
   * ink, resolved at draw time, so the bitmap must be told to look again. */
  themeTick: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [res, setRes] = useState(zoom);
  useEffect(() => {
    const t = setTimeout(() => setRes(zoom), 150);
    return () => clearTimeout(t);
  }, [zoom]);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const scale = Math.min(3, Math.max(0.25, res)) * (window.devicePixelRatio || 1);
    cv.width = Math.max(1, Math.round(node.width * scale));
    cv.height = Math.max(1, Math.round(node.height * scale));
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const ink = getComputedStyle(cv).color;
    for (const s of node.strokes ?? []) strokePath(ctx, s, nodeAccent(s.color) ?? ink);
  }, [node.strokes, node.width, node.height, res, themeTick]);
  return <canvas ref={ref} className="board-ink-bitmap" />;
});

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
    onOpenFile,
    importImage,
    pickImages,
    block,
    onMenu,
    fileVerbs,
    inkTools,
    readOnly = false,
    annotate = false,
    onSaveAs,
    camera = null,
    onCamera,
    emptyHint,
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
  const [cam, setCam] = useState<Camera>(camera ?? { x: 0, y: 0, z: 1 });
  const [addOpen, setAddOpen] = useState(false);
  const [query, setQuery] = useState("");
  /** Active tool: select is every gesture built so far; pen and eraser take
   * over the left button while they hold it. The annotation lens opens with
   * the pen already raised — drawing is what the tab is for — and in a preset
   * color, because the theme's ink is picked for the app surface, not for
   * whatever pixels the image happens to have. */
  const [tool, setTool] = useState<"select" | "pen" | "eraser">(annotate ? "pen" : "select");
  const [penColor, setPenColor] = useState<string | undefined>(annotate ? "1" : undefined);
  const [penWidth, setPenWidth] = useState<number>(INK_WIDTHS[0]);
  /** Bumped when the root element's theme stamp changes — ink bitmaps resolve
   * the theme's ink color at draw time and must redraw on a swap. */
  const [themeTick, setThemeTick] = useState(0);
  /** Read-only lens only: the cards whose reference lines are pinned on show,
   * in the order they were clicked — the order picks each card's color, so two
   * traced cards can be told apart. Clicking a card adds or removes it and
   * leaves the others lit; clicking the background puts them all away. */
  const [traced, setTraced] = useState<readonly string[]>([]);
  /** The card under the pointer on a lens: its lines lift out of the ghost
   * layer while it is hovered, so a map can be read without pinning anything.
   * A pin outranks it — that one keeps its color. */
  const [peek, setPeek] = useState<string | null>(null);
  /** A pan in progress — state, not a ref, so the lens cursor can say so. */
  const [panning, setPanning] = useState(false);

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
  /** The ink node this pen session appends to: one node per session, cleared
   * when the tool goes back to select. An eraser detour keeps it — putting the
   * pen down and picking it back up is still the same sitting. */
  const sessionInkRef = useRef<string | null>(null);
  /** Screen-space canvas the in-progress stroke draws on, so drawing never
   * re-renders the surface or touches a node bitmap mid-gesture. */
  const overlayRef = useRef<HTMLCanvasElement>(null);

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

  // The app re-read the file behind the surface (external change while the
  // buffer was clean) — the equivalent of the editor's setDoc: replace
  // everything, history included, so a stale scene can never overwrite the
  // newer file.
  useEffect(() => {
    if (initialDoc === docRef.current) return;
    const { doc, error } = parseCanvas(initialDoc);
    docRef.current = initialDoc;
    rawRef.current = doc.raw;
    liveRef.current = null;
    pendingAddRef.current = null;
    sessionInkRef.current = null;
    setParseError(error);
    setScene({ nodes: doc.nodes, edges: doc.edges });
    pastRef.current = [];
    futureRef.current = [];
    setSelected(new Set());
    setSelectedEdges(new Set());
    setTraced([]);
    setPeek(null);
    setEditing(null);
  }, [initialDoc]);

  // The theme is a `data-theme` stamp on the root element; watching it is what
  // lets ink bitmaps repaint their theme-colored strokes.
  useEffect(() => {
    const mo = new MutationObserver(() => setThemeTick((t) => t + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);

  /** Zoom keeping the screen point (px, py) fixed under the pointer. The new
   * level comes from the old one, so a wheel step and the slider's absolute
   * level share one path. */
  const zoomAround = (px: number, py: number, next: (z: number) => number) =>
    setCam((c) => {
      const nz = clampZ(next(c.z));
      return {
        x: px - ((px - c.x) / c.z) * nz,
        y: py - ((py - c.y) / c.z) * nz,
        z: nz,
      };
    });

  const zoomAt = (px: number, py: number, factor: number) => zoomAround(px, py, (z) => z * factor);

  /** Zoom from the toolbar: the middle of the view is what stays put. */
  const zoomCenter = (next: (z: number) => number) => {
    const el = outerRef.current;
    if (el) zoomAround(el.clientWidth / 2, el.clientHeight / 2, next);
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

  // Open on the whole canvas, not wherever the origin happens to sit — unless
  // the app handed back the camera this surface was left at.
  useEffect(() => {
    if (!camera && sceneRef.current.nodes.length > 0) fit();
    // Mount only: every later `camera` value is this surface's own move echoed
    // back by the app, and re-running would fight the camera it just reported.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Report the camera so a remount can pick it up where this one left off.
  useEffect(() => {
    onCamera?.(cam);
  }, [cam, onCamera]);

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

  // How connected each node is: incoming and outgoing counts from the
  // document's own edges. Computed here, not stamped at compute time, so a map
  // snapshot saved as a canvas keeps counting right as it is edited. Dangling
  // edges don't count — there is no card they could point the reader at.
  const degrees = useMemo(() => {
    const ids = new Set(scene.nodes.map((n) => n.id));
    const m = new Map<string, { in: number; out: number }>();
    const at = (id: string) => {
      let d = m.get(id);
      if (!d) m.set(id, (d = { in: 0, out: 0 }));
      return d;
    };
    for (const e of scene.edges) {
      if (!ids.has(e.fromNode) || !ids.has(e.toNode)) continue;
      at(e.fromNode).out++;
      at(e.toNode).in++;
    }
    return m;
  }, [scene.nodes, scene.edges]);

  /** Tracing reference lines is the map lens's gesture. The annotation lens is
   * read-only too, but its one image node has nothing to trace. */
  const traces = readOnly && !annotate;
  /** A pinned card's color, from its place in the click order — the same color
   * its lines wear, so a burst can be traced back to the card it left. */
  const traceColor = (id: string) => {
    const i = traced.indexOf(id);
    return i < 0 ? undefined : PRESET_COLORS[i % PRESET_COLORS.length];
  };
  /** Is this card's line set legible right now — pinned, or under the pointer? */
  const lit = (id: string) => peek === id || traced.includes(id);

  // On a lens the group backdrops don't paint; each card inside one wears its
  // folder as a tab above its top edge instead. Membership is the spec's own
  // notion — geometric containment — so any computed document works.
  const folderOf = useMemo(() => {
    const m = new Map<string, string>();
    if (!readOnly) return m;
    const gs = scene.nodes.filter((n) => n.type === "group" && n.label);
    for (const n of scene.nodes) {
      if (n.type === "group") continue;
      const center = { x: n.x + n.width / 2, y: n.y + n.height / 2 };
      const g = gs.find((b) => contains(b, center));
      if (g) m.set(n.id, g.label!);
    }
    return m;
  }, [readOnly, scene.nodes]);

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

  /** Switch tools. Leaving select clears the selection — anchors and resize
   * handles have no meaning under a pen — and going back to select ends the
   * drawing session, so the next pen picks up a fresh node. */
  const pickTool = (t: "select" | "pen" | "eraser") => {
    setTool(t);
    if (t === "select") {
      sessionInkRef.current = null;
      return;
    }
    stopEditing();
    setAddOpen(false);
    setSelected(new Set());
    setSelectedEdges(new Set());
    outerRef.current?.focus();
  };

  /** Paint the in-progress stroke onto the screen-space overlay: clear and
   * redraw one stroke, which stays cheap at any stroke length that matters. */
  const drawOverlay = () => {
    const cv = overlayRef.current;
    const el = outerRef.current;
    const d = dragRef.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !el || !ctx || d?.kind !== "ink") return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(el.clientWidth * dpr);
    const h = Math.round(el.clientHeight * dpr);
    if (cv.width !== w) cv.width = w;
    if (cv.height !== h) cv.height = h;
    const c = camRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, el.clientWidth, el.clientHeight);
    ctx.transform(c.z, 0, 0, c.z, c.x, c.y);
    strokePath(
      ctx,
      { points: d.points, width: penWidth, color: penColor },
      nodeAccent(penColor) ?? getComputedStyle(cv).color,
    );
  };

  const clearOverlay = () => {
    const cv = overlayRef.current;
    cv?.getContext("2d")?.clearRect(0, 0, cv.width, cv.height);
  };

  /** Topmost ink node with a stroke within reach of a canvas-space point. Ink
   * divs are pointer-transparent — their mostly-empty bounding box must not
   * shadow the nodes beneath — so pressing a stroke is resolved here instead.
   * A card overlapping the strokes still wins the press: its div is solid and
   * the event never reaches the surface, which is the accepted trade. */
  const inkAt = (p: Point) => {
    const reach = PICK_RADIUS / camRef.current.z;
    const ns = sceneRef.current.nodes;
    for (let i = ns.length - 1; i >= 0; i--) {
      const n = ns[i];
      if (n.type !== "ink" || !n.strokes) continue;
      if (
        p.x < n.x - reach ||
        p.x > n.x + n.width + reach ||
        p.y < n.y - reach ||
        p.y > n.y + n.height + reach
      )
        continue;
      const q = { x: p.x - n.x, y: p.y - n.y };
      if (n.strokes.some((s) => strokeNear(q, s, s.width + reach))) return n;
    }
    return null;
  };

  /** Remove every stroke within the eraser's reach of a canvas-space point.
   * Live scene only — the journal entry lands once, when the pass ends. */
  const eraseAt = (p: Point, d: { orig: Scene; erased: boolean }) => {
    const reach = ERASE_RADIUS / camRef.current.z;
    const cur = sceneRef.current;
    const gone = new Set<string>();
    let changed = false;
    const nodes = cur.nodes.flatMap((n) => {
      if (n.type !== "ink" || !n.strokes || n.strokes.length === 0) return [n];
      if (
        p.x < n.x - reach ||
        p.x > n.x + n.width + reach ||
        p.y < n.y - reach ||
        p.y > n.y + n.height + reach
      )
        return [n];
      const q = { x: p.x - n.x, y: p.y - n.y };
      const kept = n.strokes.filter((s) => !strokeNear(q, s, s.width + reach));
      if (kept.length === n.strokes.length) return [n];
      changed = true;
      if (kept.length === 0) {
        gone.add(n.id); // its last stroke went: the node goes with it
        return [];
      }
      // The rect shrinks back around what is left, so the pointer-transparent
      // box doesn't keep claiming space its strokes no longer reach.
      const bb = strokeBounds(
        kept.flatMap((s) => s.points),
        Math.max(...kept.map((s) => s.width)),
      );
      return [
        {
          ...n,
          x: n.x + bb.x,
          y: n.y + bb.y,
          width: bb.w,
          height: bb.h,
          strokes: kept.map((s) => shiftStroke(s, -bb.x, -bb.y)),
        },
      ];
    });
    if (!changed) return;
    d.erased = true;
    setScene({
      nodes,
      edges: cur.edges.filter((e) => !gone.has(e.fromNode) && !gone.has(e.toNode)),
    });
  };

  /** A press on empty canvas. Left-drag draws a selection rectangle — the
   * surface's primary gesture — and panning moves to the middle button, a
   * held Space, and the wheel, which was already the main way to pan. With a
   * draw tool up, the left button draws or erases instead. */
  const startSurfaceDrag = (e: React.PointerEvent) => {
    // A read-only surface has no marquee to draw, so the left button goes
    // back to the most natural thing it could do: panning — unless a draw
    // tool is up (the annotation lens), which owns the left button as ever.
    const pans =
      e.button === 1 || (e.button === 0 && (panReady || (readOnly && tool === "select")));
    if (e.button !== 0 && !pans) return;
    stopEditing();
    setAddOpen(false);
    outerRef.current?.focus();
    outerRef.current?.setPointerCapture(e.pointerId);
    if (pans) {
      e.preventDefault(); // the middle button otherwise starts an autoscroll
      setPanning(true);
      dragRef.current = {
        kind: "pan",
        startX: e.clientX,
        startY: e.clientY,
        camX: cam.x,
        camY: cam.y,
      };
      return;
    }
    if (tool === "pen") {
      e.preventDefault();
      const p = toCanvas(localPoint(e));
      dragRef.current = { kind: "ink", points: [[p.x, p.y, penPressure(e)]] };
      drawOverlay();
      return;
    }
    if (tool === "eraser") {
      e.preventDefault();
      const d = { kind: "erase" as const, orig: sceneRef.current, erased: false };
      dragRef.current = d;
      eraseAt(toCanvas(localPoint(e)), d);
      return;
    }
    // A press on a stroke moves its ink node, exactly as pressing a card would.
    const ink = inkAt(toCanvas(localPoint(e)));
    if (ink) {
      startNodeDrag(e, ink.id, "move");
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
    // Read-only: the press falls through to the surface and pans instead.
    if (readOnly) return;
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
    if (d.kind === "ink") {
      // Coalesced events carry the pen's real sample rate; the browser only
      // delivers one merged move per frame without them.
      const native = e.nativeEvent;
      const events = native.getCoalescedEvents?.() ?? [native];
      const z = camRef.current.z;
      for (const ev of events) {
        const p = toCanvas(localPoint(ev));
        const last = d.points[d.points.length - 1];
        // Sample only real travel: closer than ~1.5 screen pixels is jitter.
        if (Math.hypot(p.x - last[0], p.y - last[1]) * z < 1.5) continue;
        d.points.push([p.x, p.y, penPressure(ev)]);
      }
      drawOverlay();
      return;
    }
    if (d.kind === "erase") {
      eraseAt(toCanvas(localPoint(e)), d);
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
        if (d.kind === "move") return { ...n, x: n.x + dx, y: n.y + dy };
        // An ink node can be smaller than a card ever is, so the card minimum
        // must not snap it up the moment a resize starts.
        const ink = n.type === "ink";
        const width = Math.max(ink ? INK_MIN : MIN_W, n.width + dx);
        const height = Math.max(ink ? INK_MIN : MIN_H, n.height + dy);
        if (!ink || !n.strokes) return { ...n, width, height };
        // Resizing ink scales the drawing itself — points stretch with the
        // rect (from the drag's origin scene, so nothing accumulates); the
        // nominal line width stays, the way text keeps its size in a box.
        const sx = width / n.width;
        const sy = height / n.height;
        return {
          ...n,
          width,
          height,
          strokes: n.strokes.map((s) => ({
            ...s,
            points: s.points.map(([x, y, p]) => [x * sx, y * sy, p] as [number, number, number]),
          })),
        };
      }),
    });
  };

  const endDrag = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (d.kind === "pan") {
      setPanning(false);
      // On a lens a pan that never traveled was a click: on a card it pins or
      // unpins that card's reference lines, on the background it unpins all.
      if (traces && Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) < DRAG_SLOP) {
        const n = nodeAt(toCanvas(localPoint(e)));
        const id = n && n.type !== "group" ? n.id : null;
        setTraced((t) =>
          id === null ? [] : t.includes(id) ? t.filter((x) => x !== id) : [...t, id],
        );
      }
      return;
    }
    if (d.kind === "ink") {
      clearOverlay();
      const stroke: InkStroke = { points: d.points, width: penWidth, color: penColor };
      const bb = strokeBounds(d.points, penWidth);
      const cur = sceneRef.current;
      // The session's node, if it still exists — an undo may have taken it.
      const target = cur.nodes.find(
        (n) => n.id === sessionInkRef.current && n.type === "ink" && n.strokes,
      );
      if (!target) {
        const id = newId();
        sessionInkRef.current = id;
        commit({
          ...cur,
          nodes: [
            ...cur.nodes,
            {
              id,
              type: "ink",
              x: bb.x,
              y: bb.y,
              width: bb.w,
              height: bb.h,
              strokes: [shiftStroke(stroke, -bb.x, -bb.y)],
              raw: {},
            },
          ],
        });
        return;
      }
      // Grow the node to hold the new stroke; if the origin moves up or left,
      // the strokes already inside shift to stay put on the canvas.
      const nx = Math.min(target.x, bb.x);
      const ny = Math.min(target.y, bb.y);
      const nw = Math.max(target.x + target.width, bb.x + bb.w) - nx;
      const nh = Math.max(target.y + target.height, bb.y + bb.h) - ny;
      commit({
        ...cur,
        nodes: cur.nodes.map((n) =>
          n.id === target.id
            ? {
                ...n,
                x: nx,
                y: ny,
                width: nw,
                height: nh,
                strokes: [
                  ...(n.strokes ?? []).map((s) => shiftStroke(s, target.x - nx, target.y - ny)),
                  shiftStroke(stroke, -nx, -ny),
                ],
              }
            : n,
        ),
      });
      return;
    }
    if (d.kind === "erase") {
      // The strokes already vanished live; this records the whole pass as one
      // undo step, the same shape a node drag's ending takes.
      if (!d.erased) return;
      pendingAddRef.current = null;
      pastRef.current.push(d.orig);
      futureRef.current = [];
      emit(sceneRef.current);
      return;
    }
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
    // A lens has nothing to select or delete; the annotation lens still owns
    // the ink keys — Esc puts the pen down, Ctrl+Z takes a stroke back.
    if (readOnly && !annotate) return;
    if ((e.target as Element).closest("input")) return; // the picker owns its keys
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (readOnly) {
      if (e.key === "Escape" && tool !== "select") {
        pickTool("select");
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
      }
      return;
    }
    if (e.key === "Escape" && tool !== "select") {
      // The window's Esc means "hide"; an active draw tool owns the key the
      // way an open block does, and puts the pen down instead.
      pickTool("select");
      e.preventDefault();
      e.stopPropagation();
    } else if (e.key === "Escape" && editing !== null) {
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
    if (n.type === "ink") {
      return <InkCanvas node={n} zoom={cam.z} themeTick={themeTick} />;
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
            {/* "missing" is news — the file the link names isn't there. A file
                the lens can't render needs no label: the icon and the name
                already say what it is. */}
            {target?.kind === "missing" && <span className="board-node-detail">missing</span>}
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

  /** Pick the pen back up over an existing drawing: new strokes join it
   * instead of starting a node of their own. */
  const drawMore = (n: CanvasNode) => {
    pickTool("pen");
    sessionInkRef.current = n.id;
  };

  /** What double-clicking a node does: open what it stands for. */
  const openNode = (n: CanvasNode) => {
    if (n.type === "text") {
      if (!readOnly) setEditing(n.id);
      return;
    }
    if (n.type === "ink") {
      if (!readOnly || annotate) drawMore(n);
      return;
    }
    if (n.type === "link" && n.url) {
      onOpenLink(n.url);
      return;
    }
    const target = n.file !== undefined ? targets.get(n.id) : undefined;
    if (!target || n.file === undefined) return;
    if (target.kind === "note" && target.id) onOpenNote(target.id);
    else if (target.kind === "image" || target.kind === "file") (onOpenFile ?? onOpenLink)(n.file);
  };

  /** Right-clicking inside a multi-selection acts on all of it; right-clicking
   * outside one makes that node the selection first. */
  const nodeEntries = (n: CanvasNode, ids: string[]): BoardMenuEntry[] => {
    const target = n.file !== undefined ? targets.get(n.id) : undefined;
    const entries: BoardMenuEntry[] = [];
    if (ids.length === 1) {
      if (n.type === "text" && !readOnly)
        entries.push({ label: "Edit text", run: () => setEditing(n.id) });
      if (n.type === "ink" && inkTools && (!readOnly || annotate))
        entries.push({ label: "Draw more here", run: () => drawMore(n) });
      if (target?.kind === "note" && target.id)
        entries.push({ label: "Open note", run: () => onOpenNote(target.id!) });
      if (n.type === "link" && n.url)
        entries.push({ label: "Open link", run: () => onOpenLink(n.url!) });
      if ((target?.kind === "image" || target?.kind === "file") && n.file) {
        if (onOpenFile) entries.push({ label: "Open", run: () => onOpenFile(n.file!) });
        entries.push({ label: "Open externally", run: () => onOpenLink(n.file!) });
      }
      // On a lens the card also speaks the explorer row's file verbs; the app
      // decides what they are per target (a note deletes, a referenced file
      // the corpus doesn't own does not).
      if (readOnly && fileVerbs && target && n.file !== undefined) {
        const extra = fileVerbs(target, n.file);
        if (extra.length > 0) entries.push("sep", ...extra);
      }
    }
    if (!readOnly)
      entries.push({
        label: ids.length > 1 ? `Remove ${ids.length} nodes from canvas` : "Remove from canvas",
        run: () => removeNodes(ids),
      });
    return entries;
  };

  const surfaceEntries = (): BoardMenuEntry[] => {
    if (readOnly) {
      return [
        ...(onSaveAs
          ? [{ label: annotate ? "Save into image" : "Export as canvas…", run: onSaveAs }]
          : []),
        { label: "Fit view", run: fit },
      ];
    }
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
    if (readOnly || editing !== null || e.defaultPrevented) return;
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
    // Degree balls ride file cards only — the ask is about references between
    // files; text and link nodes stay clean.
    const deg = n.file !== undefined ? degrees.get(n.id) : undefined;
    // A pinned card wears its lines' color; the accent a node's own color set
    // outranks it, since that one is in the file.
    const trace = traces ? traceColor(n.id) : undefined;
    const cls = [
      "board-node",
      `board-node-${n.type === "group" || n.type === "link" || n.type === "ink" ? n.type : "box"}`,
      selected.has(n.id) ? "selected" : "",
      trace ? "traced" : "",
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
            ...(accent || trace ? { "--node-accent": accent ?? trace } : {}),
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
          // With a draw tool up the press belongs to the surface: strokes go
          // over nodes, so the node must neither drag nor swallow it.
          if (tool !== "select") return;
          startNodeDrag(e, n.id, "move");
        }}
        onDoubleClick={(e) => {
          if (tool !== "select") return;
          e.stopPropagation();
          openNode(n);
        }}
        // Hovering a card lifts its lines out of the ghost layer for as long as
        // the pointer stays — reading the map costs no clicks, and a click is
        // what makes the trace stay.
        onPointerEnter={traces ? () => setPeek(n.id) : undefined}
        onPointerLeave={traces ? () => setPeek((h) => (h === n.id ? null : h)) : undefined}
        onContextMenu={(e) => {
          e.stopPropagation();
          const ids = selected.has(n.id) ? [...selected] : [n.id];
          if (!selected.has(n.id)) setSelected(new Set([n.id]));
          setSelectedEdges(new Set());
          // A card with nothing to offer (a missing target on a lens) falls
          // back to the surface menu rather than opening an empty box.
          const entries = nodeEntries(n, ids);
          onMenu(e, entries.length > 0 ? entries : surfaceEntries());
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
        {/* Degree balls: green counts what references this file, orange what
            it references. Zero on a side shows nothing. On a lens the whole
            card is the toggle for its lines, so the balls stay pure counts. */}
        {deg !== undefined && deg.in > 0 && (
          <span className="board-ball board-ball-in" data-tip={`Referenced by ${deg.in}`}>
            {deg.in}
          </span>
        )}
        {deg !== undefined && deg.out > 0 && (
          <span className="board-ball board-ball-out" data-tip={`References ${deg.out}`}>
            {deg.out}
          </span>
        )}
        {/* The open the double-click already provides, made visible: a
            hover-revealed button in a file card's free corner. Same routing —
            the double-click keeps working. A missing target has nothing to
            open; a raised draw tool owns the pointer, so the button stands
            down with it. */}
        {n.file !== undefined && target && target.kind !== "missing" && tool === "select" && (
          <button
            className="board-open-btn"
            data-tip="Open"
            aria-label="Open"
            // The press must not select, drag, or start the surface pan —
            // the capture would eat the click this button exists for.
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              openNode(n);
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <path d="M15 3h6v6" />
              <path d="M10 14 21 3" />
            </svg>
          </button>
        )}
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

  /** A card's folder tab, rising from its top edge: folder color + name, a
   * subfolder reading as a breadcrumb — the parent segment named in its own
   * material, middles collapsing to a key square past depth 2. Part of its
   * card: a press falls through and pans, double-click opens the note. */
  const renderTab = (n: CanvasNode) => {
    const path = folderOf.get(n.id);
    if (!path) return null;
    const segs = path.split("/");
    const leaf = folderColor(path);
    return (
      <div
        key={`t-${n.id}`}
        className="board-tab"
        data-tip={path}
        style={
          {
            left: n.x + 8,
            top: n.y - 20,
            maxWidth: n.width - 16,
            "--tab-color": leaf,
          } as React.CSSProperties
        }
        onDoubleClick={(e) => {
          e.stopPropagation();
          openNode(n);
        }}
      >
        {segs.length > 1 && (
          <span
            className="board-tab-seg board-tab-parent"
            style={{ "--seg-color": folderColor(segs[0]) } as React.CSSProperties}
          >
            {segs[0]}
          </span>
        )}
        {segs.length > 2 && (
          <span
            className="board-tab-key"
            style={{ background: folderColor(segs.slice(0, -1).join("/")) }}
          />
        )}
        <span className="board-tab-seg" style={{ "--seg-color": leaf } as React.CSSProperties}>
          {segs[segs.length - 1]}
        </span>
      </div>
    );
  };

  // Groups are backdrops the spec paints behind everything else; connections
  // ride above them and below the cards they join. A lens paints no boxes at
  // all — cards wear folder tabs instead; the groups stay in the document, so
  // a snapshot keeps them.
  const groups = readOnly ? [] : scene.nodes.filter((n) => n.type === "group");
  const cards = scene.nodes.filter((n) => n.type !== "group");
  const byId = new Map(scene.nodes.map((n) => [n.id, n]));
  // On a lens every line draws, but only the lines of a lit card are legible:
  // the rest sit in a ghost layer, faint enough not to clutter and present
  // enough to show the shape of the map. A pinned card's lines take its color;
  // a hovered card's come up in the plain line color. Ghosts render first so
  // the lit lines lie on top of them. All render-only — an exported canvas
  // keeps every line shown and uncolored, and the presets keep a traced line a
  // legal spec color.
  const drawnEdges = scene.edges
    .flatMap((e) => {
      const from = byId.get(e.fromNode);
      const to = byId.get(e.toNode);
      // A dangling edge stays in the file (some other tool's business) but
      // there is nothing to draw it between.
      if (!from || !to) return [];
      const ghost = traces && !lit(e.fromNode) && !lit(e.toNode);
      const traceAccent = traces ? (traceColor(e.fromNode) ?? traceColor(e.toNode)) : undefined;
      const facing = facingSides(from, to);
      const fromSide = e.fromSide ?? facing[0];
      const toSide = e.toSide ?? facing[1];
      const { d, mid } = curve(anchorAt(from, fromSide), fromSide, anchorAt(to, toSide), toSide);
      return [{ edge: e, d, mid, ghost, traceAccent }];
    })
    .sort((a, b) => Number(b.ghost) - Number(a.ghost));
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
      className={[
        "board",
        editing !== null ? "board-editing" : "",
        panReady ? "board-pan" : "",
        readOnly ? "board-readonly" : "",
        panning ? "board-panning" : "",
        tool !== "select" ? `board-tool-${tool}` : "",
      ]
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
      onDoubleClick={(e) => {
        // Ink divs are pointer-transparent, so their double-click lands here.
        if (tool !== "select" || !inkTools) return;
        const ink = inkAt(toCanvas(localPoint(e)));
        if (ink) drawMore(ink);
      }}
      onContextMenu={(e) => {
        e.stopPropagation();
        // Same story for the right button: a stroke's menu is resolved here.
        const ink = tool === "select" ? inkAt(toCanvas(localPoint(e))) : null;
        if (ink) {
          setSelected(new Set([ink.id]));
          setSelectedEdges(new Set());
          onMenu(e, nodeEntries(ink, [ink.id]));
          return;
        }
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
          {drawnEdges.map(({ edge, d, mid, ghost, traceAccent }) => {
            const accent = traceAccent ?? nodeAccent(edge.color);
            return (
              <g
                key={edge.id}
                className={[
                  "board-edge",
                  ghost ? "ghost" : "",
                  selectedEdges.has(edge.id) ? "selected" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={accent ? ({ "--node-accent": accent } as React.CSSProperties) : undefined}
              >
                {/* The fat invisible twin a line needs to be clickable — but a
                    lens has no edge verbs, and its twins would blanket the
                    surface a plain drag pans. */}
                {!readOnly && (
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
                      onMenu(e, [
                        { label: "Remove connection", run: () => removeEdges([edge.id]) },
                      ]);
                    }}
                  />
                )}
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
        {readOnly && cards.map(renderTab)}
      </div>
      {/* The in-progress stroke: screen space, cleared when the stroke commits
          into its node's own bitmap. */}
      {tool === "pen" && <canvas ref={overlayRef} className="board-ink-overlay" />}
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
          {emptyHint ??
            (role === "board"
              ? "This board is empty — “Add note” places the project’s notes on it."
              : "This canvas is empty — “Text” drops a box you can write in.")}
        </div>
      )}
      <div className="board-bar" onPointerDown={(e) => e.stopPropagation()}>
        {/* Flattening is what the annotation lens is for, so it wears the verb.
            The map's snapshot lives in the app's File menu instead — it writes
            a file, which is not something a view's own toolbar should imply. */}
        {annotate && onSaveAs && (
          <button
            className="board-btn"
            data-tip="Flatten the drawing into the image file — the recycle bin keeps the old version"
            onClick={onSaveAs}
          >
            Save into image
          </button>
        )}
        {!readOnly && (
          <div className="board-add">
            {(role === "board" ? ["note", "text", "image"] : ["text", "image", "note"]).map(
              (verb) =>
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
        )}
        {inkTools && (
          <div className="board-draw">
            <button
              className={tool === "pen" ? "board-btn active" : "board-btn"}
              data-tip="Draw on the canvas (Esc puts the pen down)"
              onClick={() => pickTool(tool === "pen" ? "select" : "pen")}
            >
              ✎ Draw
            </button>
            <button
              className={tool === "eraser" ? "board-btn active" : "board-btn"}
              data-tip="Erase strokes (whole strokes, not pixels)"
              onClick={() => pickTool(tool === "eraser" ? "select" : "eraser")}
            >
              Erase
            </button>
            {tool === "pen" && (
              <>
                <span className="board-swatches">
                  <button
                    className={penColor === undefined ? "board-swatch active" : "board-swatch"}
                    data-tip="Ink"
                    aria-label="Ink color"
                    onClick={() => setPenColor(undefined)}
                  />
                  {PRESET_COLORS.map((c, i) => (
                    <button
                      key={c}
                      className={
                        penColor === String(i + 1) ? "board-swatch active" : "board-swatch"
                      }
                      style={{ background: c }}
                      data-tip={`Color ${i + 1}`}
                      aria-label={`Stroke color ${i + 1}`}
                      onClick={() => setPenColor(String(i + 1))}
                    />
                  ))}
                </span>
                <span className="board-widths">
                  {INK_WIDTHS.map((w) => (
                    <button
                      key={w}
                      className={penWidth === w ? "board-btn active" : "board-btn"}
                      data-tip={w === INK_WIDTHS[0] ? "Fine line" : "Wide line"}
                      aria-label={w === INK_WIDTHS[0] ? "Fine line" : "Wide line"}
                      onClick={() => setPenWidth(w)}
                    >
                      {w === INK_WIDTHS[0] ? "•" : "●"}
                    </button>
                  ))}
                </span>
              </>
            )}
          </div>
        )}
        <div className="board-zoom">
          <button
            className="board-btn"
            data-tip="Zoom out"
            onClick={() => zoomCenter((z) => z / 1.2)}
          >
            −
          </button>
          {/* The slider is logarithmic, so its middle is 100% and each half
              covers a factor of ten — a whole map at one end, a card filling
              the view at the other. */}
          <input
            className="board-zoom-slider"
            type="range"
            min={Math.log10(Z_MIN)}
            max={Math.log10(Z_MAX)}
            step={0.01}
            value={Math.log10(cam.z)}
            data-tip="Zoom — the middle is 100%"
            aria-label="Zoom"
            onChange={(e) => {
              const z = 10 ** Number(e.target.value);
              zoomCenter(() => z);
            }}
          />
          <button
            className="board-btn board-zoom-pct"
            data-tip="Back to 100%"
            onClick={() => zoomCenter(() => 1)}
          >
            {Math.round(cam.z * 100)}%
          </button>
          <button
            className="board-btn"
            data-tip="Zoom in"
            onClick={() => zoomCenter((z) => z * 1.2)}
          >
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
