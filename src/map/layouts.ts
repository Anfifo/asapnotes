/**
 * The three ways a project map lays its graph out. Each takes the computed
 * graph and answers with a rectangle per node in world units, which is all the
 * view needs to draw nodes, run edges between them and fit the camera; the
 * view-specific extras (label spots, folder halos, ledger headings) ride along.
 *
 * - Clusters: every note is a card with its opening text, packed into a grid
 *   per folder. The reference shape — what the map looked like first.
 * - Constellation: a dot per file, sized by how connected it is, placed by a
 *   seeded force simulation with a soft pull toward its folder's centre, so
 *   proximity says both "same folder" and "referenced together".
 * - Ledger: one row per file under folder headings, in the explorer's order.
 */

import type { MapGraph, MapNode } from "./graph";

export { VIEW_KINDS, VIEW_LABELS, type ViewKind } from "./viewKinds";

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point {
  w: number;
  h: number;
}

/** Where a dot's label sits, relative to the dot's centre. */
export interface LabelSpot {
  dx: number;
  dy: number;
  anchor: "start" | "middle" | "end";
}

export interface Halo {
  folder: string;
  /** Convex hull of the folder's dot centres — one or two points for a
   * folder that small; the fat round stroke does the rest. */
  hull: Point[];
  /** Where the folder's name sits: above its highest dot. */
  label: Point;
}

export interface Heading {
  folder: string;
  y: number;
}

export interface Layout {
  rects: Map<string, Rect>;
  /** World bounds, for the fit. */
  bounds: Rect;
  labels?: Map<string, LabelSpot>;
  halos?: Halo[];
  headings?: Heading[];
  /** Ledger geometry: the column the dots sit on, and the page's size. */
  ledger?: { dotX: number; width: number; height: number };
}

// Card metrics for the clusters view. A note with text takes the full card —
// it has an excerpt to show. Everything else is a title box: half the width
// and the room a wrapped two-line name needs, because a referenced file and a
// note with nothing written in it have nothing to put under the title. An
// image shows its own content, so its box keeps room for the thumbnail.
export const CARD_W = 220;
export const CARD_H = 150;
export const BOX_W = 110;
export const BOX_H = 50;
export const IMAGE_H = 96;
/** A card's folder tab rises this far above its top edge. */
export const TAB_RISE = 20;

const centerOf = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

const boundsOf = (rects: Iterable<Rect>, pad: { x: number; top: number; bottom: number }) => {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  if (x0 === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
  return {
    x: x0 - pad.x,
    y: y0 - pad.top,
    w: x1 - x0 + 2 * pad.x,
    h: y1 - y0 + pad.top + pad.bottom,
  };
};

/** Nodes filed under each folder, in the graph's own (sorted) order. */
const byFolder = (g: MapGraph) => {
  const m = new Map<string, MapNode[]>();
  for (const f of g.folders) m.set(f, []);
  for (const n of g.nodes) m.get(n.folder)?.push(n);
  return m;
};

// ------------------------------------------------------------------ clusters

/** Card size for a node in the clusters view. */
export const cardSize = (n: MapNode) =>
  n.kind === "note" && n.excerpt.trim() !== ""
    ? { w: CARD_W, h: CARD_H }
    : { w: BOX_W, h: n.kind === "image" ? IMAGE_H : BOX_H };

export function layoutClusters(g: MapGraph): Layout {
  /** Cards in the same folder sit this close — a cluster reads by proximity. */
  const GAP = 20;
  /** Extra vertical air between a folder's rows, for the tabs its cards wear. */
  const TAB_ROOM = 14;
  /** Distance between clusters, card to card. */
  const CLUSTER_GAP = 110;
  /** Clusters pack left to right and wrap past this width. */
  const ROW_MAX = 2200;
  const rects = new Map<string, Rect>();
  let cx = 0;
  let cy = 0;
  let rowH = 0;
  for (const [folder, items] of byFolder(g)) {
    if (items.length === 0) continue;
    // Pack left to right into rows — a row is as tall as its tallest item, so
    // full-size and compact cards mix — aiming at a square-ish cluster.
    const sizes = items.map(cardSize);
    const cols = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(items.length))));
    const maxW = cols * CARD_W + (cols - 1) * GAP;
    const vGap = folder ? GAP + TAB_ROOM : GAP;
    const pos: Point[] = [];
    let x = 0;
    let y = 0;
    let rh = 0;
    let w = 0;
    for (const s of sizes) {
      if (x > 0 && x + s.w > maxW) {
        x = 0;
        y += rh + vGap;
        rh = 0;
      }
      pos.push({ x, y });
      x += s.w + GAP;
      w = Math.max(w, x - GAP);
      rh = Math.max(rh, s.h);
    }
    const h = y + rh;
    if (cx > 0 && cx + w > ROW_MAX) {
      cx = 0;
      cy += rowH + CLUSTER_GAP;
      rowH = 0;
    }
    items.forEach((n, i) => rects.set(n.key, { x: cx + pos[i].x, y: cy + pos[i].y, ...sizes[i] }));
    cx += w + CLUSTER_GAP;
    rowH = Math.max(rowH, h);
  }
  return { rects, bounds: boundsOf(rects.values(), { x: 0, top: TAB_RISE, bottom: 0 }) };
}

// ------------------------------------------------------------- constellation

/** A dot's radius: notes grow with how connected they are; a referenced file
 * stays a small mark. */
export const dotRadius = (n: MapNode) =>
  n.kind === "note" ? 4.5 + Math.sqrt(n.in + n.out) * 1.9 : 3.5;

/** Deterministic pseudo-random numbers, so the same notes always land in the
 * same picture. */
const mulberry = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Andrew's monotone chain; two points or fewer come back as they are. */
const convexHull = (points: Point[]): Point[] => {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const q of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0)
      lower.pop();
    lower.push(q);
  }
  const upper: Point[] = [];
  for (const q of pts.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0)
      upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
};

/** Label width estimate for the collision pass, in world units. */
const LABEL_CHARS = 24;
const LABEL_CHAR_W = 5.7;
const LABEL_H = 12;

/**
 * Place the dots by force. References pull their two ends together, every
 * dot pushes every other apart (further when both carry a label), and a soft
 * pull toward the folder's own centroid keeps a folder together without a box.
 * `warm` is the previous layout's centres: a node that has them starts there
 * and the simulation only settles, so a new note lands near its folder and
 * nothing else moves; without them the start is seeded, hence still stable.
 */
export function layoutConstellation(g: MapGraph, warm: ReadonlyMap<string, Point> | null): Layout {
  const W = 900;
  const H = 640;
  const cx = W / 2;
  const cy = H / 2;
  const nodes = g.nodes;
  const R = new Map(nodes.map((n) => [n.key, dotRadius(n)]));
  const folders = byFolder(g);
  // Folder anchors ring the centre, biggest folder first, so the whisper of a
  // pull toward them keeps two folders from settling on top of each other.
  const order = [...folders.keys()].sort(
    (a, b) => (folders.get(b)?.length ?? 0) - (folders.get(a)?.length ?? 0),
  );
  const anchor = new Map(
    order.map((f, i) => {
      const a = (i / order.length) * Math.PI * 2 - Math.PI / 2;
      return [f, { x: cx + Math.cos(a) * W * 0.22, y: cy + Math.sin(a) * H * 0.2 }];
    }),
  );
  const rnd = mulberry(20260825);
  const warmed = warm !== null && nodes.filter((n) => warm.has(n.key)).length >= nodes.length * 0.6;
  const p = new Map(
    nodes.map((n) => {
      const from = warm?.get(n.key);
      const a = anchor.get(n.folder)!;
      return [
        n.key,
        from
          ? { x: from.x, y: from.y, vx: 0, vy: 0 }
          : { x: a.x + (rnd() - 0.5) * 60, y: a.y + (rnd() - 0.5) * 60, vx: 0, vy: 0 },
      ];
    }),
  );
  const steps = warmed ? 160 : 420;
  for (let it = 0; it < steps; it++) {
    const heat = 1 - it / steps;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = p.get(nodes[i].key)!;
        const b = p.get(nodes[j].key)!;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) {
          dx = 0.1;
          dy = 0.1;
          d2 = 0.02;
        }
        const d = Math.sqrt(d2);
        let f = 2200 / d2;
        // Two labelled notes need label room between them; small marks don't.
        const labelled = Number(nodes[i].kind === "note") + Number(nodes[j].kind === "note");
        const minD =
          R.get(nodes[i].key)! +
          R.get(nodes[j].key)! +
          (labelled === 2 ? 30 : labelled === 1 ? 16 : 12);
        if (d < minD) f += (minD - d) * 0.4;
        f = Math.min(f, 8);
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }
    for (const e of g.edges) {
      const a = p.get(e.from)!;
      const b = p.get(e.to)!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      const L = 58 + R.get(e.from)! + R.get(e.to)!;
      const f = (d - L) * 0.03;
      a.vx += (dx / d) * f;
      a.vy += (dy / d) * f;
      b.vx -= (dx / d) * f;
      b.vy -= (dy / d) * f;
    }
    const cen = new Map<string, { x: number; y: number; n: number }>();
    for (const n of nodes) {
      const q = p.get(n.key)!;
      const c = cen.get(n.folder) ?? { x: 0, y: 0, n: 0 };
      c.x += q.x;
      c.y += q.y;
      c.n++;
      cen.set(n.folder, c);
    }
    for (const n of nodes) {
      const q = p.get(n.key)!;
      const c = cen.get(n.folder)!;
      const a = anchor.get(n.folder)!;
      q.vx += (c.x / c.n - q.x) * 0.025 + (a.x - q.x) * 0.004 + (cx - q.x) * 0.003;
      q.vy += (c.y / c.n - q.y) * 0.025 + (a.y - q.y) * 0.004 + (cy - q.y) * 0.003;
    }
    for (const q of p.values()) {
      q.x += q.vx * 0.5 * (0.3 + heat);
      q.y += q.vy * 0.5 * (0.3 + heat);
      q.vx *= 0.55;
      q.vy *= 0.55;
    }
  }

  const rects = new Map<string, Rect>();
  for (const n of nodes) {
    const q = p.get(n.key)!;
    const r = R.get(n.key)!;
    rects.set(n.key, { x: q.x - r, y: q.y - r, w: 2 * r, h: 2 * r });
  }

  // Folder halos: the hull of each folder's centres, named above its top dot.
  // The names are claimed first so no dot's label lands on one.
  const halos: Halo[] = [];
  const taken: Rect[] = [...rects.values()].map((r) => ({
    x: r.x - 2,
    y: r.y - 2,
    w: r.w + 4,
    h: r.h + 4,
  }));
  const hit = (b: Rect) =>
    taken.some((t) => b.x < t.x + t.w && b.x + b.w > t.x && b.y < t.y + t.h && b.y + b.h > t.y);
  for (const [folder, items] of folders) {
    if (items.length === 0) continue;
    const pts = items.map((n) => centerOf(rects.get(n.key)!));
    const top = items.reduce((m, n) => (rects.get(n.key)!.y < rects.get(m.key)!.y ? n : m));
    const label = {
      x: pts.reduce((a, q) => a + q.x, 0) / pts.length,
      y: rects.get(top.key)!.y - 22,
    };
    const w = Math.max(4, folder.length) * 6.6;
    taken.push({ x: label.x - w / 2, y: label.y - 10, w, h: 13 });
    halos.push({ folder, hull: convexHull(pts), label });
  }

  // Label placement: hubs pick first; each label tries below, above, right and
  // left of its dot and takes the first spot clear of every dot and every
  // label already placed. The last resort is below, overlap and all.
  const labels = new Map<string, LabelSpot>();
  const notes = nodes
    .filter((n) => n.kind === "note")
    .sort((a, b) => b.in + b.out - (a.in + a.out));
  for (const n of notes) {
    const c = centerOf(rects.get(n.key)!);
    const r = R.get(n.key)!;
    const w = Math.min(n.name.length, LABEL_CHARS) * LABEL_CHAR_W;
    const h = LABEL_H;
    const spots: (LabelSpot & { box: Rect })[] = [
      { dx: 0, dy: r + 3, anchor: "middle", box: { x: c.x - w / 2, y: c.y + r + 2, w, h } },
      {
        dx: 0,
        dy: -r - 3 - h,
        anchor: "middle",
        box: { x: c.x - w / 2, y: c.y - r - 3 - h, w, h },
      },
      { dx: r + 5, dy: -h / 2, anchor: "start", box: { x: c.x + r + 5, y: c.y - h / 2, w, h } },
      { dx: -r - 5, dy: -h / 2, anchor: "end", box: { x: c.x - r - 5 - w, y: c.y - h / 2, w, h } },
    ];
    const pick = spots.find((s) => !hit(s.box)) ?? spots[0];
    taken.push(pick.box);
    labels.set(n.key, { dx: pick.dx, dy: pick.dy, anchor: pick.anchor });
  }

  return {
    rects,
    // Room around the dots for their labels and the halos' blur.
    bounds: boundsOf(rects.values(), { x: 90, top: 60, bottom: 40 }),
    labels,
    halos,
  };
}

// -------------------------------------------------------------------- ledger

export const ROW_H = 20;
const HEADING_H = 30;
const FOLDER_GAP = 10;
/** The name column; dots sit just right of it and arcs run further right. */
export const LEDGER_NAME_W = 250;

export function layoutLedger(g: MapGraph): Layout {
  const dotX = LEDGER_NAME_W + 14;
  const width = dotX + 340;
  const rects = new Map<string, Rect>();
  const headings: Heading[] = [];
  let y = 12;
  for (const [folder, items] of byFolder(g)) {
    if (items.length === 0) continue;
    headings.push({ folder, y });
    y += HEADING_H;
    for (const n of items) {
      rects.set(n.key, { x: 0, y, w: width, h: ROW_H });
      y += ROW_H;
    }
    y += FOLDER_GAP;
  }
  const height = y + 8;
  return {
    rects,
    bounds: { x: 0, y: 0, w: width, h: height },
    headings,
    ledger: { dotX, width, height },
  };
}

// --------------------------------------------------------------------- edges

type Side = "top" | "right" | "bottom" | "left";

const anchorAt = (r: Rect, side: Side): Point => {
  switch (side) {
    case "top":
      return { x: r.x + r.w / 2, y: r.y };
    case "bottom":
      return { x: r.x + r.w / 2, y: r.y + r.h };
    case "left":
      return { x: r.x, y: r.y + r.h / 2 };
    case "right":
      return { x: r.x + r.w, y: r.y + r.h / 2 };
  }
};

/** The sides two cards present to each other — the axis they differ most on. */
const facingSides = (a: Rect, b: Rect): [Side, Side] => {
  const ca = centerOf(a);
  const cb = centerOf(b);
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? ["right", "left"] : ["left", "right"];
  return dy > 0 ? ["bottom", "top"] : ["top", "bottom"];
};

const control = (p: Point, side: Side, dist: number): Point => {
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

/** A card-to-card connection: a curve leaving one side and arriving at the
 * facing side, so lines leave cards squarely instead of clipping corners. */
export function cardCurve(a: Rect, b: Rect): string {
  const [sa, sb] = facingSides(a, b);
  const pa = anchorAt(a, sa);
  const pb = anchorAt(b, sb);
  const bend = Math.min(60, Math.hypot(pb.x - pa.x, pb.y - pa.y) / 2);
  const c1 = control(pa, sa, bend);
  const c2 = control(pb, sb, bend);
  return `M${pa.x},${pa.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${pb.x},${pb.y}`;
}

/** A dot-to-dot connection: centre to centre, stopped at each rim so the
 * arrowhead lands on the target's edge, with a slight bend so two lines
 * between the same pair don't lie on each other. */
export function dotCurve(a: Rect, b: Rect): string {
  const ca = centerOf(a);
  const cb = centerOf(b);
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  const d = Math.hypot(dx, dy) || 1;
  const ra = a.w / 2 + 1;
  const rb = b.w / 2 + 2.5;
  const p = { x: ca.x + (dx / d) * ra, y: ca.y + (dy / d) * ra };
  const q = { x: cb.x - (dx / d) * rb, y: cb.y - (dy / d) * rb };
  const k = 0.12;
  const mx = (p.x + q.x) / 2 - (q.y - p.y) * k;
  const my = (p.y + q.y) / 2 + (q.x - p.x) * k;
  return `M${p.x},${p.y} Q${mx},${my} ${q.x},${q.y}`;
}

/** A row-to-row connection on the ledger: an arc bowing out to the right of
 * the dot column, as tall as the distance it spans. */
export function ledgerArc(a: Rect, b: Rect, dotX: number): string {
  const y1 = a.y + a.h / 2;
  const y2 = b.y + b.h / 2;
  const dy = y2 - y1;
  const ry = Math.abs(dy) / 2;
  const rx = Math.min(ry, 300);
  return `M${dotX + 6},${y1} A${rx},${ry} 0 0 ${dy > 0 ? 1 : 0} ${dotX + 6},${y2}`;
}
