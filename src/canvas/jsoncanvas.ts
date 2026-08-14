/**
 * JSONCanvas (spec 1.0) model behind the canvas views. Parsing keeps every
 * field it doesn't model — other tools may write these files, and a round
 * trip through this app must never shed their data.
 */

export interface CanvasNode {
  id: string;
  /** Spec node types: "file" | "text" | "link" | "group"; unknown kept as-is. */
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** File nodes: path relative to the canvas file's own folder. */
  file?: string;
  /** Text nodes: their content. */
  text?: string;
  /** The node as the file carried it, for the round trip. */
  raw: Record<string, unknown>;
}

export interface CanvasDoc {
  nodes: CanvasNode[];
  /** Top-level fields beyond `nodes` (edges included), preserved verbatim. */
  raw: Record<string, unknown>;
}

export const DEFAULT_NODE_W = 220;
export const DEFAULT_NODE_H = 150;

const num = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

const empty = (): CanvasDoc => ({ nodes: [], raw: {} });

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
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { doc: empty(), error: "not a JSON object" };
  }
  const { nodes, ...rest } = data as Record<string, unknown>;
  const parsed: CanvasNode[] = [];
  for (const [i, n] of (Array.isArray(nodes) ? nodes : []).entries()) {
    if (typeof n !== "object" || n === null || Array.isArray(n)) continue;
    const raw = n as Record<string, unknown>;
    parsed.push({
      id: typeof raw.id === "string" ? raw.id : `node-${i}`,
      type: typeof raw.type === "string" ? raw.type : "text",
      x: num(raw.x, 0),
      y: num(raw.y, 0),
      width: num(raw.width, DEFAULT_NODE_W),
      height: num(raw.height, DEFAULT_NODE_H),
      file: typeof raw.file === "string" ? raw.file : undefined,
      text: typeof raw.text === "string" ? raw.text : undefined,
      raw,
    });
  }
  return { doc: { nodes: parsed, raw: rest }, error: null };
}

/** Nothing worth writing: no nodes, and no foreign top-level data beyond an
 * empty `edges`. The inverse of parse's "empty text is an empty canvas" — a
 * canvas emptied out again serializes to the very text it opened from. */
const isEmptyDoc = (doc: CanvasDoc) =>
  doc.nodes.length === 0 &&
  Object.entries(doc.raw).every(([k, v]) => k === "edges" && Array.isArray(v) && v.length === 0);

/** Serialize back to JSONCanvas text. Unknown node fields and top-level keys
 * ride through untouched; geometry is written in whole pixels, as the spec's
 * own examples do. */
export function serializeCanvas(doc: CanvasDoc): string {
  if (isEmptyDoc(doc)) return "";
  const nodes = doc.nodes.map((n) => ({
    ...n.raw,
    id: n.id,
    type: n.type,
    ...(n.file !== undefined ? { file: n.file } : {}),
    ...(n.text !== undefined ? { text: n.text } : {}),
    x: Math.round(n.x),
    y: Math.round(n.y),
    width: Math.round(n.width),
    height: Math.round(n.height),
  }));
  return JSON.stringify({ edges: [], ...doc.raw, nodes }, null, 2) + "\n";
}

/** Fresh node id: time-ordered and unique enough within one canvas. */
export const nodeId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
