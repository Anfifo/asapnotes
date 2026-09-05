/**
 * The project map: a computed, read-only view of a project's notes and the
 * references between them, in one of three layouts (see `layouts.ts`). Nodes
 * are DOM so cards can carry rendered text; connections are one SVG layer
 * under them. Hovering a node lifts its connections out of the ghost layer;
 * clicking pins them in a color and opens the node's details — its opening
 * text and the notes on either end of its references — and double-clicking
 * opens the note. Loaded on demand: a summon never pays for this module.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { FileIcon } from "../fileIcons";
import { Icon } from "../icons";
import type { MenuEntry } from "../MenuBar";
import { colorOf, iconOf } from "../noteTypes";
import type { MapGraph, MapNode } from "./graph";
import {
  cardCurve,
  dotCurve,
  layoutClusters,
  layoutConstellation,
  layoutLedger,
  ledgerArc,
  TAB_RISE,
  VIEW_KINDS,
  VIEW_LABELS,
  type Layout,
  type Point,
  type Rect,
  type ViewKind,
} from "./layouts";

export interface Camera {
  x: number;
  y: number;
  z: number;
}

export interface MapViewProps {
  /** The computed graph; null while the notes are still being read. */
  graph: MapGraph | null;
  view: ViewKind;
  onView: (view: ViewKind) => void;
  /** Where this view was left last time, or null to fit on mount. */
  camera: Camera | null;
  onCamera: (cam: Camera) => void;
  onOpenNote: (id: string) => void;
  /** A referenced file that isn't a note: the app decides how it opens. */
  onOpenFile: (abs: string) => void;
  /** URL the webview can load an image at. */
  imageUrl: (abs: string) => string;
  onMenu: (e: React.MouseEvent, entries: MenuEntry[]) => void;
  /** The file verbs a node's menu carries after its own — the explorer row's
   * for a note, reveal for a file the corpus doesn't own. */
  fileVerbs: (node: MapNode) => MenuEntry[];
  /** What an empty map says. */
  emptyHint: string;
}

const Z_MIN = 0.1;
const Z_MAX = 10;
const clampZ = (z: number) => Math.min(Z_MAX, Math.max(Z_MIN, z));
/** A press that travels less than this is a click, not a pan. */
const DRAG_SLOP = 3;
/** Pin colors, taken in click order, so two pinned nodes' lines can't be
 * confused. Literal on purpose: a trace has to read on both themes and against
 * every folder color. */
const PIN_COLORS = ["#c8402f", "#c8762f", "#c8a72f", "#4f9e4f", "#3f8fbf", "#8f5fbf"];

/** A folder's hue: the project's folders (and their ancestors, which the
 * breadcrumb tabs color too) sorted, then spread evenly round the wheel, so no
 * two folders share a color and the spacing is the widest the count allows.
 * Lightness and chroma come from the stylesheet, which re-tunes them per theme. */
const folderHues = (nodes: readonly MapNode[]) => {
  const paths = new Set<string>();
  for (const n of nodes) {
    const segs = n.folder.split("/");
    for (let i = 1; i <= segs.length; i++) paths.add(segs.slice(0, i).join("/"));
  }
  const sorted = [...paths].sort();
  return new Map(sorted.map((f, i) => [f, Math.round(20 + (i * 360) / sorted.length)]));
};

/** The last constellation's dot centres per project, so the next open starts
 * from them and only settles: a new note lands near its folder and nothing
 * else moves. Session memory — a fresh launch lays out from the seed again. */
const warmStarts = new Map<string, Map<string, Point>>();

const center = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export default function MapView({
  graph,
  view,
  onView,
  camera,
  onCamera,
  onOpenNote,
  onOpenFile,
  imageUrl,
  onMenu,
  fileVerbs,
  emptyHint,
}: MapViewProps) {
  const hues = useMemo(() => folderHues(graph?.nodes ?? []), [graph]);
  const folderColor = (path: string) =>
    `oklch(var(--folder-l) var(--folder-c) ${hues.get(path) ?? 0})`;

  const layout = useMemo<Layout | null>(() => {
    if (!graph) return null;
    switch (view) {
      case "clusters":
        return layoutClusters(graph);
      case "constellation":
        return layoutConstellation(graph, warmStarts.get(graph.project) ?? null);
      case "ledger":
        return layoutLedger(graph);
    }
  }, [graph, view]);
  useEffect(() => {
    if (!graph || !layout || view !== "constellation") return;
    warmStarts.set(graph.project, new Map([...layout.rects].map(([k, r]) => [k, center(r)])));
  }, [graph, layout, view]);

  const nodes = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.key, n])), [graph]);
  const neighbours = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of graph?.edges ?? []) {
      (m.get(e.from) ?? m.set(e.from, new Set()).get(e.from)!).add(e.to);
      (m.get(e.to) ?? m.set(e.to, new Set()).get(e.to)!).add(e.from);
    }
    return m;
  }, [graph]);

  const outerRef = useRef<HTMLDivElement>(null);
  const [cam, setCam] = useState<Camera>(camera ?? { x: 0, y: 0, z: 1 });
  const camRef = useRef(cam);
  camRef.current = cam;
  const onCameraRef = useRef(onCamera);
  onCameraRef.current = onCamera;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const [panning, setPanning] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  /** Where the pointer entered the hovered node, in this surface's own pixels
   * — where the hover card goes. */
  const [hoverAt, setHoverAt] = useState<Point>({ x: 0, y: 0 });
  const [pins, setPins] = useState<string[]>([]);
  /** The node whose details are open — the one pinned most recently. */
  const [detail, setDetail] = useState<string | null>(null);
  /** Whether the last press panned the camera — the click it ends with is not one. */
  const dragged = useRef(false);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(
    null,
  );

  const scrolls = view === "ledger";

  const fit = () => {
    const el = outerRef.current;
    if (!el || !layout || layout.rects.size === 0) {
      setCam({ x: 0, y: 0, z: 1 });
      return;
    }
    const b = layout.bounds;
    const pad = 48;
    const z = clampZ(
      Math.min(el.clientWidth / (b.w + 2 * pad), el.clientHeight / (b.h + 2 * pad), 1),
    );
    setCam({
      x: (el.clientWidth - b.w * z) / 2 - b.x * z,
      y: (el.clientHeight - b.h * z) / 2 - b.y * z,
      z,
    });
  };

  // Open fitted, unless the app handed back where this view was left. Runs
  // per view switch, since each view has its own camera memory; the `camera`
  // prop itself is not a dependency — every later value is this surface's own
  // move echoed back, and re-fitting on it would fight the camera it reported.
  const ready = layout !== null;
  useLayoutEffect(() => {
    if (!ready) return;
    if (cameraRef.current) setCam(cameraRef.current);
    else fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, ready]);
  useEffect(() => {
    onCameraRef.current(cam);
  }, [cam]);

  /** Zoom keeping the surface point under (px, py) fixed. */
  const zoomAround = (px: number, py: number, next: (z: number) => number) =>
    setCam((c) => {
      const nz = clampZ(next(c.z));
      return { x: px - ((px - c.x) / c.z) * nz, y: py - ((py - c.y) / c.z) * nz, z: nz };
    });
  const zoomCenter = (next: (z: number) => number) => {
    const el = outerRef.current;
    if (el) zoomAround(el.clientWidth / 2, el.clientHeight / 2, next);
  };

  // Wheel is a native non-passive listener: preventDefault must work (page
  // scroll), and stopPropagation keeps Ctrl+wheel from also driving the app
  // zoom, whose listener sits on the window. The ledger scrolls natively.
  useEffect(() => {
    const el = outerRef.current;
    if (!el || scrolls) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.ctrlKey) {
        const rect = el.getBoundingClientRect();
        zoomAround(e.clientX - rect.left, e.clientY - rect.top, (z) =>
          e.deltaY < 0 ? z * 1.1 : z / 1.1,
        );
      } else {
        const dx = e.shiftKey ? e.deltaY : e.deltaX;
        const dy = e.shiftKey ? 0 : e.deltaY;
        setCam((c) => ({ ...c, x: c.x - dx, y: c.y - dy }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [scrolls]);

  const localPoint = (e: { clientX: number; clientY: number }): Point => {
    const rect = outerRef.current?.getBoundingClientRect();
    return rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : { x: 0, y: 0 };
  };

  // Left or middle button drags the camera; a press that never travels is a
  // click, which on the background clears every pin. The pointer is captured
  // only once the press has become a drag: capturing on the press itself
  // would pull the pointer off the node under it, so the node lost its hover
  // and the click that followed went to the surface instead of the node.
  const onSurfaceDown = (e: React.PointerEvent) => {
    if (scrolls || (e.button !== 0 && e.button !== 1)) return;
    const c = camRef.current;
    drag.current = { x: e.clientX, y: e.clientY, cx: c.x, cy: c.y, moved: false };
  };
  const onSurfaceMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
    if (!d.moved) {
      d.moved = true;
      setPanning(true);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    setCam((c) => ({ ...c, x: d.cx + dx, y: d.cy + dy }));
  };
  const onSurfaceUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setPanning(false);
    // A drag that ends over a node still fires a click there; swallow it.
    dragged.current = d?.moved ?? false;
    const onNode = (e.target as Element | null)?.closest(".map-node") !== null;
    if (d && !d.moved && e.button === 0 && !onNode) clearPins();
  };

  const clearPins = () => {
    setPins([]);
    setDetail(null);
  };

  const pinColor = (key: string) => {
    const i = pins.indexOf(key);
    return i < 0 ? null : PIN_COLORS[i % PIN_COLORS.length];
  };

  /** Bring a node to the middle of the view, at the current zoom — or, on the
   * ledger, scroll its row into sight. */
  const reveal = (key: string) => {
    const r = layout?.rects.get(key);
    const el = outerRef.current;
    if (!r || !el) return;
    if (scrolls) {
      el.querySelector(`[data-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: "center" });
      return;
    }
    const c = center(r);
    setCam((cam) => ({
      ...cam,
      x: el.clientWidth / 2 - c.x * cam.z,
      y: el.clientHeight / 2 - c.y * cam.z,
    }));
  };

  /** A click on a node: pin it (or unpin a pinned one) and show its details. */
  const toggle = (key: string) => {
    if (pins.includes(key)) {
      setPins((p) => p.filter((k) => k !== key));
      if (detail === key) setDetail(null);
    } else {
      setPins((p) => [...p, key]);
      setDetail(key);
    }
  };

  /** From the details panel: pin the node named in a row and show it. */
  const select = (key: string) => {
    if (!pins.includes(key)) setPins((p) => [...p, key]);
    setDetail(key);
    reveal(key);
  };

  const openNode = (n: MapNode) => {
    if (n.noteId) onOpenNote(n.noteId);
    else if (n.kind !== "missing") onOpenFile(n.abs);
  };

  const nodeMenu = (e: React.MouseEvent, n: MapNode) => {
    e.stopPropagation();
    const own: MenuEntry[] = [
      ...(n.kind !== "missing"
        ? [{ label: n.noteId ? "Open note" : "Open file", run: () => openNode(n) }]
        : []),
      { label: "Details", run: () => select(n.key) },
    ];
    const verbs = fileVerbs(n);
    onMenu(e, verbs.length > 0 ? [...own, "sep", ...verbs] : own);
  };

  const surfaceMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    onMenu(e, [
      ...VIEW_KINDS.map((k) => ({
        label: `View as ${VIEW_LABELS[k].toLowerCase()}`,
        run: () => onView(k),
      })),
      ...(scrolls ? [] : ["sep" as const, { label: "Fit to view", run: fit }]),
    ]);
  };

  const enter = (e: React.PointerEvent, key: string) => {
    setHover(key);
    setHoverAt(localPoint(e));
  };
  const leave = (key: string) => setHover((h) => (h === key ? null : h));

  const active = hover !== null || pins.length > 0;
  const adjacent = useMemo(() => {
    const s = new Set<string>();
    for (const k of hover ? [...pins, hover] : pins)
      for (const m of neighbours.get(k) ?? []) s.add(m);
    return s;
  }, [hover, pins, neighbours]);

  const nodeClass = (n: MapNode, form: "card" | "dot" | "row") =>
    [
      "map-node",
      form,
      n.kind === "missing" ? "missing" : "",
      n.kind === "image" ? "image" : "",
      n.kind === "file" ? "ref" : "",
      hover === n.key ? "hot" : "",
      adjacent.has(n.key) ? "adj" : "",
      pinColor(n.key) ? "pinned" : "",
    ]
      .filter(Boolean)
      .join(" ");

  const nodeStyle = (n: MapNode, r: Rect, extra?: CSSProperties): CSSProperties =>
    ({
      left: r.x,
      top: r.y,
      width: r.w,
      height: r.h,
      "--fc": folderColor(n.folder),
      ...(pinColor(n.key) ? { "--pin": pinColor(n.key) } : {}),
      ...extra,
    }) as CSSProperties;

  const nodeHandlers = (n: MapNode) => ({
    onPointerEnter: (e: React.PointerEvent) => enter(e, n.key),
    onPointerLeave: () => leave(n.key),
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      if (dragged.current) return;
      toggle(n.key);
    },
    onDoubleClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      openNode(n);
    },
    onContextMenu: (e: React.MouseEvent) => nodeMenu(e, n),
  });

  // ------------------------------------------------------------------ edges

  const edges = useMemo(() => {
    if (!graph || !layout) return [];
    const drawn = graph.edges.flatMap((e) => {
      const a = layout.rects.get(e.from);
      const b = layout.rects.get(e.to);
      if (!a || !b) return [];
      const d =
        view === "clusters"
          ? cardCurve(a, b)
          : view === "constellation"
            ? dotCurve(a, b)
            : ledgerArc(a, b, layout.ledger?.dotX ?? 0);
      return [{ key: `${e.from} ${e.to}`, from: e.from, to: e.to, d }];
    });
    return drawn;
  }, [graph, layout, view]);

  const renderEdges = () => {
    const rows = edges.map((e) => {
      const pin = pinColor(e.from) ?? pinColor(e.to);
      const lit = !pin && (hover === e.from || hover === e.to);
      return { ...e, pin, lit, rank: pin ? 2 : lit ? 1 : 0 };
    });
    // Ghosts first, so the lit and pinned lines lie on top of them.
    rows.sort((a, b) => a.rank - b.rank);
    return rows.map((e) => (
      <path
        key={e.key}
        className={["map-edge", e.pin ? "pin" : e.lit ? "lit" : "ghost"].join(" ")}
        d={e.d}
        style={e.pin ? ({ "--pin": e.pin } as CSSProperties) : undefined}
      />
    ));
  };

  const arrowDefs = (
    <defs>
      {/* `context-stroke` gives the head the line's own color. */}
      <marker
        id="map-arrow"
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
  );

  // ------------------------------------------------------------------ nodes

  /** A card's folder tab, rising from its top edge: folder color + name, a
   * subfolder reading as a breadcrumb — the parent segment in its own
   * material, middles collapsing to a key square past depth 2. */
  const renderTab = (n: MapNode, r: Rect) => {
    if (!n.folder) return null;
    const segs = n.folder.split("/");
    const leaf = folderColor(n.folder);
    return (
      <div
        key={`t-${n.key}`}
        className="map-tab"
        data-tip={n.folder}
        style={
          {
            left: r.x + 8,
            top: r.y - TAB_RISE,
            maxWidth: r.w - 16,
            "--tab-color": leaf,
          } as CSSProperties
        }
        onDoubleClick={(e) => {
          e.stopPropagation();
          openNode(n);
        }}
      >
        {segs.length > 1 && (
          <span
            className="map-tab-seg map-tab-parent"
            style={{ "--seg-color": folderColor(segs[0]) } as CSSProperties}
          >
            {segs[0]}
          </span>
        )}
        {segs.length > 2 && (
          <span
            className="map-tab-key"
            style={{ background: folderColor(segs.slice(0, -1).join("/")) }}
          />
        )}
        <span className="map-tab-seg" style={{ "--seg-color": leaf } as CSSProperties}>
          {segs[segs.length - 1]}
        </span>
      </div>
    );
  };

  const openButton = (n: MapNode) =>
    n.kind !== "missing" && (
      <button
        className="map-open"
        data-tip="Open"
        aria-label="Open"
        // The press must not pin, drag or pan — the capture would eat the
        // click this button exists for.
        onPointerDown={(e) => e.stopPropagation()}
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
    );

  const renderCard = (n: MapNode, r: Rect) => (
    <div key={n.key} className={nodeClass(n, "card")} style={nodeStyle(n, r)} {...nodeHandlers(n)}>
      {n.kind === "image" ? (
        <img className="map-card-img" src={imageUrl(n.abs)} alt={n.name} />
      ) : (
        <>
          <div className="map-card-head">
            <FileIcon icon={iconOf(n.name)} color={colorOf(n.name)} />
            <span className="map-card-name">{n.name}</span>
            {/* "missing" is news — the file the link names isn't there. A file
                the map can't render needs no label: icon and name say what it is. */}
            {n.kind === "missing" && <span className="map-card-tag">missing</span>}
          </div>
          {n.excerpt.trim() !== "" && <div className="map-card-body">{n.excerpt}</div>}
        </>
      )}
      {/* Degree balls: green counts what references this file, orange what it
          references. Zero on a side shows nothing. */}
      {n.in > 0 && (
        <span className="map-ball in" data-tip={`Referenced by ${n.in}`}>
          {n.in}
        </span>
      )}
      {n.out > 0 && (
        <span className="map-ball out" data-tip={`References ${n.out}`}>
          {n.out}
        </span>
      )}
      {openButton(n)}
    </div>
  );

  /** A note's name sits inside its dot on one line, at whatever size fits the
   * disc's width: a long name in a small dot is a hairline, and that is fine —
   * zooming in brings it up, and the hover card carries the readable name. */
  const renderDot = (n: MapNode, r: Rect) => {
    const width = r.w * 0.88;
    const fit = Math.min(width / (n.name.length * 0.65), r.h * 0.45);
    return (
      <div key={n.key} className={nodeClass(n, "dot")} style={nodeStyle(n, r)} {...nodeHandlers(n)}>
        {n.kind === "note" && (
          <span className="map-dot-name" style={{ width, fontSize: fit }}>
            {n.name}
          </span>
        )}
      </div>
    );
  };

  const renderRow = (n: MapNode, r: Rect, dotX: number) => {
    const d = n.kind === "note" ? 8 + Math.sqrt(n.in + n.out) * 2.4 : 7;
    return (
      <div
        key={n.key}
        className={nodeClass(n, "row")}
        style={nodeStyle(n, r)}
        data-key={n.key}
        {...nodeHandlers(n)}
      >
        <span className="map-row-name" style={{ width: dotX - 14 }}>
          <FileIcon icon={iconOf(n.name)} color={colorOf(n.name)} />
          <span className="map-row-text">{n.name}</span>
          {n.kind === "missing" && <span className="map-card-tag">missing</span>}
        </span>
        <span
          className="map-row-dot"
          style={{ left: dotX + 6 - d / 2, top: (r.h - d) / 2, width: d, height: d }}
        />
      </div>
    );
  };

  // ----------------------------------------------------------------- panels

  const folderChip = (folder: string, small = false) => (
    <span
      className={small ? "map-folder small" : "map-folder"}
      style={{ "--fc": folderColor(folder) } as CSSProperties}
    >
      {folder || graph?.project}
    </span>
  );

  const kindLine = (n: MapNode) =>
    n.kind === "missing"
      ? "Dead link — nothing at this path"
      : n.kind === "image"
        ? "Referenced image"
        : n.kind === "file"
          ? "Referenced file — not a note"
          : null;

  const hoverNode = hover ? nodes.get(hover) : undefined;
  const renderHoverCard = () => {
    if (!hoverNode || view === "clusters") return null;
    const el = outerRef.current;
    const w = 220;
    const x =
      hoverAt.x + 14 + w > (el?.clientWidth ?? Infinity) ? hoverAt.x - w - 14 : hoverAt.x + 14;
    const y = Math.min(hoverAt.y + 14, (el?.clientHeight ?? Infinity) - 180);
    return (
      <div className="map-hcard" style={{ left: Math.max(8, x), top: Math.max(8, y) }}>
        <div className="map-hcard-name">
          <FileIcon icon={iconOf(hoverNode.name)} color={colorOf(hoverNode.name)} />
          {hoverNode.name}
        </div>
        {folderChip(hoverNode.folder)}
        {hoverNode.kind === "note" && hoverNode.title !== hoverNode.name && (
          <div className="map-hcard-title">{hoverNode.title}</div>
        )}
        {hoverNode.excerpt.trim() !== "" ? (
          <div className="map-hcard-excerpt">{hoverNode.excerpt}</div>
        ) : (
          kindLine(hoverNode) && <div className="map-hcard-title">{kindLine(hoverNode)}</div>
        )}
        <div className="map-degrees">
          <span className="in">Referenced by {hoverNode.in}</span>
          <span className="out">References {hoverNode.out}</span>
        </div>
      </div>
    );
  };

  const detailNode = detail ? nodes.get(detail) : undefined;
  const detailRows = (keys: string[]) => (
    <ul className="map-detail-list">
      {keys.map((k) => {
        const m = nodes.get(k);
        if (!m) return null;
        return (
          <li key={k}>
            <button
              className="map-detail-row"
              onClick={() => select(k)}
              onDoubleClick={() => openNode(m)}
              data-tip="Click for details, double-click to open"
            >
              <FileIcon icon={iconOf(m.name)} color={colorOf(m.name)} />
              <span className="map-detail-rowname">{m.name}</span>
              {m.folder !== detailNode?.folder && folderChip(m.folder, true)}
            </button>
          </li>
        );
      })}
    </ul>
  );
  const renderDetail = () => {
    if (!detailNode || !graph) return null;
    const n = detailNode;
    const referencedBy = graph.edges.filter((e) => e.to === n.key).map((e) => e.from);
    const references = graph.edges.filter((e) => e.from === n.key).map((e) => e.to);
    return (
      <aside
        className="map-detail"
        style={{ "--pin": pinColor(n.key) ?? "transparent" } as CSSProperties}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
      >
        <div className="map-detail-head">
          <FileIcon icon={iconOf(n.name)} color={colorOf(n.name)} />
          <span className="map-detail-name">{n.name}</span>
          <button
            className="map-detail-close"
            aria-label="Close details"
            data-tip="Close details"
            onClick={() => setDetail(null)}
          >
            <Icon name="x" />
          </button>
        </div>
        {folderChip(n.folder)}
        {n.kind === "note" && n.title !== n.name && (
          <div className="map-detail-title">{n.title}</div>
        )}
        {kindLine(n) && <div className="map-detail-kind">{kindLine(n)}</div>}
        {n.excerpt.trim() !== "" && <div className="map-detail-excerpt">{n.excerpt}</div>}
        {n.kind !== "missing" && (
          <div className="map-detail-actions">
            <button className="map-btn" onClick={() => openNode(n)}>
              {n.noteId ? "Open note" : "Open file"}
            </button>
          </div>
        )}
        <div className="map-detail-section">
          <h4 className="in">Referenced by {referencedBy.length}</h4>
          {referencedBy.length > 0 ? (
            detailRows(referencedBy)
          ) : (
            <div className="map-detail-none">Nothing links here.</div>
          )}
        </div>
        <div className="map-detail-section">
          <h4 className="out">References {references.length}</h4>
          {references.length > 0 ? (
            detailRows(references)
          ) : (
            <div className="map-detail-none">Links to nothing.</div>
          )}
        </div>
      </aside>
    );
  };

  const renderBar = () => (
    <div
      className="map-bar"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div className="segmented map-views" role="group" aria-label="Map view">
        {VIEW_KINDS.map((k) => (
          <button
            key={k}
            className={k === view ? "active" : undefined}
            aria-pressed={k === view}
            onClick={() => onView(k)}
          >
            {VIEW_LABELS[k]}
          </button>
        ))}
      </div>
      {!scrolls && (
        <div className="map-zoom">
          <button
            className="map-btn"
            data-tip="Zoom out"
            onClick={() => zoomCenter((z) => z / 1.2)}
          >
            <Icon name="minus" />
          </button>
          {/* Logarithmic, so the middle is 100% and each half covers a factor
              of ten — a whole map at one end, a card filling the view at the other. */}
          <input
            className="map-zoom-slider"
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
            className="map-btn map-zoom-pct"
            data-tip="Back to 100%"
            onClick={() => zoomCenter(() => 1)}
          >
            {Math.round(cam.z * 100)}%
          </button>
          <button className="map-btn" data-tip="Zoom in" onClick={() => zoomCenter((z) => z * 1.2)}>
            <Icon name="plus" />
          </button>
          <button className="map-btn" data-tip="Fit every node in view" onClick={fit}>
            Fit
          </button>
        </div>
      )}
    </div>
  );

  // ------------------------------------------------------------------ views

  const rootClass = [
    "map",
    `map-${view}`,
    panning ? "panning" : "",
    active ? "dim" : "",
    detailNode ? "with-detail" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (scrolls) {
    const dotX = layout?.ledger?.dotX ?? 0;
    return (
      <div ref={outerRef} className={rootClass} onContextMenu={surfaceMenu}>
        <div className="map-ledger-scroll" onClick={clearPins}>
          {layout && graph && (
            <div
              className="map-ledger-page"
              style={{ width: layout.ledger?.width, height: layout.ledger?.height }}
            >
              <svg
                className="map-edges"
                width={layout.ledger?.width}
                height={layout.ledger?.height}
              >
                {arrowDefs}
                {renderEdges()}
              </svg>
              {layout.headings?.map((h) => (
                <div
                  key={h.folder}
                  className="map-heading"
                  style={
                    { top: h.y, width: dotX + 12, "--fc": folderColor(h.folder) } as CSSProperties
                  }
                >
                  {h.folder || graph.project}
                </div>
              ))}
              {graph.nodes.map((n) => {
                const r = layout.rects.get(n.key);
                return r ? renderRow(n, r, dotX) : null;
              })}
            </div>
          )}
        </div>
        {graph && graph.nodes.length === 0 && <div className="map-hint">{emptyHint}</div>}
        {renderHoverCard()}
        {renderDetail()}
        {renderBar()}
      </div>
    );
  }

  return (
    <div
      ref={outerRef}
      className={rootClass}
      onPointerDown={onSurfaceDown}
      onPointerMove={onSurfaceMove}
      onPointerUp={onSurfaceUp}
      onPointerCancel={onSurfaceUp}
      onContextMenu={surfaceMenu}
      style={{
        backgroundSize: `${24 * cam.z}px ${24 * cam.z}px`,
        backgroundPosition: `${cam.x}px ${cam.y}px`,
      }}
    >
      <div
        className="map-surface"
        style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})` }}
      >
        <svg className="map-edges">
          {arrowDefs}
          {layout?.halos?.map((h) => (
            <g key={h.folder} style={{ "--fc": folderColor(h.folder) } as CSSProperties}>
              <path
                className="map-halo"
                d={
                  h.hull.map((q, i) => `${i ? "L" : "M"}${q.x},${q.y}`).join(" ") +
                  (h.hull.length > 2 ? "Z" : "")
                }
              />
              <text className="map-halo-label" x={h.label.x} y={h.label.y} textAnchor="middle">
                {h.folder || graph?.project}
              </text>
            </g>
          ))}
          {renderEdges()}
        </svg>
        {graph &&
          layout &&
          graph.nodes.map((n) => {
            const r = layout.rects.get(n.key);
            if (!r) return null;
            return view === "clusters" ? renderCard(n, r) : renderDot(n, r);
          })}
        {view === "clusters" &&
          graph &&
          layout &&
          graph.nodes.map((n) => {
            const r = layout.rects.get(n.key);
            return r ? renderTab(n, r) : null;
          })}
      </div>
      {graph && graph.nodes.length === 0 && <div className="map-hint">{emptyHint}</div>}
      {renderHoverCard()}
      {renderDetail()}
      {renderBar()}
    </div>
  );
}
