/**
 * JSONCanvas (spec 1.0) model behind the canvas views. Parsing keeps every
 * field it doesn't model — other tools may write these files, and a round
 * trip through this app must never shed their data.
 */

/** Where an edge attaches to its node. */
export type Side = "top" | "right" | "bottom" | "left";

const SIDES: Side[] = ["top", "right", "bottom", "left"];

const asSide = (v: unknown): Side | undefined =>
  typeof v === "string" && (SIDES as string[]).includes(v) ? (v as Side) : undefined;

/** One drawn stroke on an ink node. Points are `[x, y, pressure]`, relative to
 * the node's own origin so a node move never rewrites them; pressure is 0..1
 * with 0.5 meaning "no pen data" (what a mouse reports). */
export interface InkStroke {
  points: [number, number, number][];
  /** Nominal line width in canvas units; pressure modulates around it. */
  width: number;
  /** Same rule as node color: a preset "1".."6" or hex. Absent means the
   * theme's ink color. */
  color?: string;
}

export interface CanvasNode {
  id: string;
  /** Spec node types: "file" | "text" | "link" | "group"; unknown kept as-is.
   * "ink" is this app's documented extension — freehand strokes, which the
   * spec's axis-aligned rectangles can't carry. */
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** File nodes: path relative to the canvas file's own folder. An image is a
   * file node too — the spec has no image type. */
  file?: string;
  /** Text nodes: their content, as markdown. */
  text?: string;
  /** Link nodes: the URL they stand for. */
  url?: string;
  /** Group nodes: the caption on the group's frame. */
  label?: string;
  /** Spec color: a preset "1".."6" or a hex value. Rendered, never authored
   * here — a foreign file's colors survive and show. */
  color?: string;
  /** Ink nodes: their strokes. A conforming reader that doesn't know the
   * extension opens the file and skips them. */
  strokes?: InkStroke[];
  /** The node as the file carried it, for the round trip. */
  raw: Record<string, unknown>;
}

export interface CanvasEdge {
  id: string;
  fromNode: string;
  fromSide?: Side;
  toNode: string;
  toSide?: Side;
  /** Spec ends: "none" | "arrow", defaulting to none at the start and an arrow
   * at the finish. Read so a foreign file's arrows point where it says. */
  fromEnd?: string;
  toEnd?: string;
  /** Preserved and rendered, not authored: colors and labels ride through. */
  color?: string;
  label?: string;
  raw: Record<string, unknown>;
}

export interface CanvasDoc {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  /** Top-level fields beyond `nodes` and `edges`, preserved verbatim. */
  raw: Record<string, unknown>;
}

export const DEFAULT_NODE_W = 220;
export const DEFAULT_NODE_H = 150;
/** Text boxes open wider than they are tall — prose, not a card. */
export const DEFAULT_TEXT_W = 260;
export const DEFAULT_TEXT_H = 120;

const num = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

const empty = (): CanvasDoc => ({ nodes: [], edges: [], raw: {} });

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Strokes of an ink node, tolerantly: a malformed stroke is skipped rather
 * than failing the node, the same spirit as the node loop itself. A missing
 * pressure reads as 0.5 — the "no pen data" value. */
const parseStrokes = (v: unknown): InkStroke[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const strokes: InkStroke[] = [];
  for (const s of v) {
    if (!isObject(s) || !Array.isArray(s.points)) continue;
    const points: [number, number, number][] = [];
    for (const p of s.points) {
      if (!Array.isArray(p) || typeof p[0] !== "number" || typeof p[1] !== "number") continue;
      points.push([p[0], p[1], typeof p[2] === "number" ? p[2] : 0.5]);
    }
    if (points.length === 0) continue;
    strokes.push({ points, width: num(s.width, 2), color: str(s.color) });
  }
  return strokes;
};

/** Parse a canvas file. Empty text is a new, empty canvas; malformed JSON is
 * an error the caller must surface and stop editing on — a later write would
 * shed whatever the unreadable file holds. */
export function parseCanvas(text: string): { doc: CanvasDoc; error: string | null } {
  if (text.trim() === "") return { doc: empty(), error: null };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { doc: empty(), error: e instanceof Error ? e.message : String(e) };
  }
  if (!isObject(data)) return { doc: empty(), error: "not a JSON object" };
  const { nodes, edges, ...rest } = data;
  const parsedNodes: CanvasNode[] = [];
  for (const [i, n] of (Array.isArray(nodes) ? nodes : []).entries()) {
    if (!isObject(n)) continue;
    parsedNodes.push({
      id: str(n.id) ?? `node-${i}`,
      type: str(n.type) ?? "text",
      x: num(n.x, 0),
      y: num(n.y, 0),
      width: num(n.width, DEFAULT_NODE_W),
      height: num(n.height, DEFAULT_NODE_H),
      file: str(n.file),
      text: str(n.text),
      url: str(n.url),
      label: str(n.label),
      color: str(n.color),
      strokes: str(n.type) === "ink" ? (parseStrokes(n.strokes) ?? []) : undefined,
      raw: n,
    });
  }
  const parsedEdges: CanvasEdge[] = [];
  for (const [i, e] of (Array.isArray(edges) ? edges : []).entries()) {
    if (!isObject(e)) continue;
    const fromNode = str(e.fromNode);
    const toNode = str(e.toNode);
    // Endpoints are what an edge *is*; one without them can't be drawn or
    // repaired, so it is not carried as an edge.
    if (fromNode === undefined || toNode === undefined) continue;
    parsedEdges.push({
      id: str(e.id) ?? `edge-${i}`,
      fromNode,
      fromSide: asSide(e.fromSide),
      toNode,
      toSide: asSide(e.toSide),
      fromEnd: str(e.fromEnd),
      toEnd: str(e.toEnd),
      color: str(e.color),
      label: str(e.label),
      raw: e,
    });
  }
  return { doc: { nodes: parsedNodes, edges: parsedEdges, raw: rest }, error: null };
}

/** Nothing worth writing: no nodes, no edges, no foreign top-level data. The
 * inverse of parse's "empty text is an empty canvas" — a canvas emptied out
 * again serializes to the very text it opened from. */
const isEmptyDoc = (doc: CanvasDoc) =>
  doc.nodes.length === 0 && doc.edges.length === 0 && Object.keys(doc.raw).length === 0;

/** Drop a key when its value is undefined, so an absent optional field stays
 * absent instead of appearing as `null`. */
const opt = <T>(key: string, value: T | undefined) => (value === undefined ? {} : { [key]: value });

/** Two decimals: node geometry is whole pixels, but a stroke's shape lives in
 * the fractions — whole-pixel points turn a pen's curve into stairsteps. */
const round2 = (v: number) => Math.round(v * 100) / 100;

const serializeStrokes = (strokes: InkStroke[]) =>
  strokes.map((s) => ({
    points: s.points.map(([x, y, p]) => [round2(x), round2(y), round2(p)]),
    width: s.width,
    ...opt("color", s.color),
  }));

/** Serialize back to JSONCanvas text. Unknown node, edge and top-level fields
 * ride through untouched; geometry is written in whole pixels, as the spec's
 * own examples do. */
export function serializeCanvas(doc: CanvasDoc): string {
  if (isEmptyDoc(doc)) return "";
  const nodes = doc.nodes.map((n) => ({
    ...n.raw,
    id: n.id,
    type: n.type,
    ...opt("file", n.file),
    ...opt("text", n.text),
    ...opt("url", n.url),
    ...opt("label", n.label),
    ...opt("color", n.color),
    ...(n.strokes !== undefined ? { strokes: serializeStrokes(n.strokes) } : {}),
    x: Math.round(n.x),
    y: Math.round(n.y),
    width: Math.round(n.width),
    height: Math.round(n.height),
  }));
  const edges = doc.edges.map((e) => ({
    ...e.raw,
    id: e.id,
    fromNode: e.fromNode,
    ...opt("fromSide", e.fromSide),
    toNode: e.toNode,
    ...opt("toSide", e.toSide),
    ...opt("fromEnd", e.fromEnd),
    ...opt("toEnd", e.toEnd),
    ...opt("color", e.color),
    ...opt("label", e.label),
  }));
  return JSON.stringify({ nodes, edges, ...doc.raw }, null, 2) + "\n";
}

/** Fresh node or edge id: time-ordered and unique enough within one canvas. */
export const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
