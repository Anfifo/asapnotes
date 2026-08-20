/**
 * The project map: a computed picture of a project's notes and the references
 * between them. Never persisted — rebuilt from the notes each time it opens,
 * so it can never go stale; "Export as canvas" snapshots it into a real file
 * when an arrangement is worth keeping.
 *
 * Shape: every markdown note is a card; a markdown link from one note to
 * another becomes an edge; a link to any other real file places that file and
 * draws the edge to it; folders holding notes become one flat layer of group
 * nodes keyed by full path (`recipes` and `recipes/desserts` are two
 * side-by-side groups — the label carries the hierarchy, groups never nest).
 * The lens doesn't paint the group boxes — each card wears its folder as a
 * tab instead — but the groups stay in the document so "Export as canvas…"
 * snapshots keep real spec groups. Two leans, reversible: a link to a folder
 * lands on that folder's first card when the folder has a cluster here (the
 * box it used to land on is invisible on the lens; the first card's tab is
 * where the eye finds the folder); images a note embeds inline are content,
 * not references, so only pointed-at links get edges.
 */

import { fileOf, IMAGE_FILE, relativePath, resolvePath } from "../paths";
import {
  DEFAULT_NODE_H,
  DEFAULT_NODE_W,
  serializeCanvas,
  type CanvasEdge,
  type CanvasNode,
} from "./jsoncanvas";

export interface MapSources {
  /** Absolute directory of the project root (forward slashes) — node paths
   * are written relative to it, so a map saved there resolves unchanged. */
  projectDir: string;
  /** Ids of the project's markdown notes — the cards. */
  noteIds: string[];
  readNote: (id: string) => Promise<string>;
  /** Absolute directory holding a note id. */
  noteDirOf: (id: string) => string;
  /** Note id for an absolute path, null when it lives outside every base. */
  noteIdOf: (abs: string) => string | null;
}

/** Markdown inline links, the image marker captured so embedded images can be
 * told apart from pointed-at references. */
const LINK_RE = /(!?)\[[^\]]*\]\(\s*(<[^>]+>|[^)\s]+)(?:\s[^)]*)?\)/g;

const dirOf = (rel: string) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");

/** A link destination as an absolute path, null when it doesn't point at a
 * file or folder at all (external URL, in-page anchor). `dir` marks a target
 * that says it is a folder (trailing slash). */
const targetPath = (raw: string, fromDir: string): { abs: string; dir: boolean } | null => {
  let t = raw.startsWith("<") && raw.endsWith(">") ? raw.slice(1, -1) : raw;
  if (t.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(t)) return null;
  const hash = t.indexOf("#");
  if (hash > 0) t = t.slice(0, hash); // a heading anchor names the same file
  try {
    t = decodeURIComponent(t);
  } catch {
    // Not URI-encoded after all — take it as written.
  }
  const dir = /[\\/]\s*$/.test(t);
  t = t.replace(/[\\/]+\s*$/, "");
  if (t === "") return null;
  const abs = /^[a-z]:[\\/]/i.test(t) ? t.replace(/\\/g, "/") : resolvePath(fromDir, t);
  return { abs, dir };
};

// Grid metrics, in canvas units. A note with text takes the board's default
// card size — it has an excerpt to show. Everything else is a plain title box:
// half the width and only the room a wrapped two-line title needs, because a
// referenced file the lens can't render, and a note with nothing written in
// it, have nothing to put under the title. An image is the exception — it
// shows its own content, so its box keeps room for the thumbnail. Sized here
// at compute time because layout needs sizes up front.
const W = DEFAULT_NODE_W;
const H = DEFAULT_NODE_H;
const REF_W = 110;
const REF_H = 50;
const IMAGE_H = 96;
/** Cards in the same cluster sit this close — clusters read by proximity now
 * that the lens paints no box around them. */
const GAP = 20;
/** Extra vertical air between a folder cluster's rows: on the lens every card
 * in a folder wears a tab rising 20 above its top edge. */
const TAB_ROOM = 14;
const PAD = 36;
/** Extra headroom inside a group so its label doesn't sit on the first row. */
const LABEL = 28;
/** Distance between clusters, card to card — the unpainted group rect around
 * a folder's cards overlaps into this gap. */
const CLUSTER_GAP = 110;
/** Clusters pack left to right and wrap past this width. */
const ROW_MAX = 2200;

/** Pack items left to right into rows — a row is as tall as its tallest item,
 * so full-size and compact cards mix — aiming the cluster at a square-ish
 * shape from its count. */
const pack = (sizes: { w: number; h: number }[], vGap: number) => {
  const cols = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(sizes.length))));
  const maxW = cols * W + (cols - 1) * GAP;
  const pos: { x: number; y: number }[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  let w = 0;
  for (const s of sizes) {
    if (x > 0 && x + s.w > maxW) {
      x = 0;
      y += rowH + vGap;
      rowH = 0;
    }
    pos.push({ x, y });
    x += s.w + GAP;
    w = Math.max(w, x - GAP);
    rowH = Math.max(rowH, s.h);
  }
  return { pos, w, h: y + rowH };
};

/** Compute a project's map and return it as JSONCanvas text. */
export async function computeProjectMap(project: string, src: MapSources): Promise<string> {
  const { noteIds, readNote, noteIdOf } = src;
  // Directories arrive in whatever separator the backend used; every path
  // compared here is normalized to forward slashes first, or a backslashed
  // base never matches a `resolvePath` result.
  const norm = (p: string) => p.replace(/\\/g, "/");
  const projectDir = norm(src.projectDir);
  const noteDirOf = (id: string) => norm(src.noteDirOf(id));

  // The cards, keyed by lowercased absolute path so link targets can find
  // them — Windows paths compare case-insensitively.
  interface Card {
    id: string;
    abs: string;
    absDir: string;
    folder: string;
  }
  const cards = new Map<string, Card>();
  const cardByPath = new Map<string, string>();
  for (const id of noteIds) {
    const absDir = noteDirOf(id);
    const abs = `${absDir}/${fileOf(id)}`;
    cards.set(id, { id, abs, absDir, folder: dirOf(id.slice(project.length + 1)) });
    cardByPath.set(abs.toLowerCase(), id);
  }

  // Folders that directly hold notes become groups; deeper folders are their
  // own groups, never nested inside.
  const folders = new Map<string, { absDir: string; notes: string[] }>();
  for (const c of cards.values()) {
    if (!c.folder) continue;
    let f = folders.get(c.folder);
    if (!f) folders.set(c.folder, (f = { absDir: c.absDir, notes: [] }));
    f.notes.push(c.id);
  }
  const folderByAbs = new Map([...folders].map(([rel, f]) => [f.absDir.toLowerCase(), rel]));

  // Read every note and collect its references, deduped per (source, target).
  const refs = new Map<string, string>(); // lowercased abs → abs as written
  /** Notes with nothing written in them — their cards have no body to size for. */
  const blank = new Set<string>();
  const links: { from: string; toKind: "note" | "folder" | "ref"; to: string }[] = [];
  const seen = new Set<string>();
  await Promise.all(
    [...cards.values()].map(async (card) => {
      let text: string;
      try {
        text = await readNote(card.id);
      } catch {
        return; // an unreadable note still gets its card, just no edges out
      }
      if (text.trim() === "") blank.add(card.id);
      for (const m of text.matchAll(LINK_RE)) {
        if (m[1] === "!") continue; // an embedded image is content, not a reference
        const target = targetPath(m[2], card.absDir);
        if (!target) continue;
        const lower = target.abs.toLowerCase();
        if (lower === card.abs.toLowerCase()) continue;
        let toKind: "note" | "folder" | "ref";
        let to: string;
        const note = cardByPath.get(lower);
        const folder = folderByAbs.get(lower);
        if (note) {
          toKind = "note";
          to = note;
        } else if (folder) {
          toKind = "folder";
          to = folder;
        } else if (target.dir) {
          // A folder by its own admission, with no group on the map — there
          // is nothing spec-meaningful to draw the edge to, so it is skipped
          // rather than invented as a file card.
          continue;
        } else {
          toKind = "ref";
          to = lower;
          if (!refs.has(lower)) refs.set(lower, target.abs);
        }
        const key = `${card.id}→${toKind}:${to}`;
        if (seen.has(key)) continue;
        seen.add(key);
        links.push({ from: card.id, toKind, to });
      }
    }),
  );

  // Lay the clusters out on a grid: root notes first, folder groups by path,
  // referenced files last. Packed left to right, wrapping into rows.
  const nodes: CanvasNode[] = [];
  const noteNode = new Map<string, string>();
  /** Where a folder link lands: the folder cluster's first card. */
  const folderFirst = new Map<string, string>();
  const refNode = new Map<string, string>();
  let seq = 0;

  const fileField = (abs: string, noteId: string | null) =>
    relativePath(projectDir, abs) ?? noteId ?? abs;

  interface Item {
    abs: string;
    noteId: string | null;
    refKey?: string;
    /** This card has an excerpt to show, so it gets the full card size. */
    full?: boolean;
  }
  const sizeOf = (it: Item) =>
    it.full ? { w: W, h: H } : { w: REF_W, h: IMAGE_FILE.test(it.abs) ? IMAGE_H : REF_H };
  const clusters: { folder: string | null; items: Item[] }[] = [];
  const byId = (a: string, b: string) => a.localeCompare(b);
  const rootItems = [...cards.values()]
    .filter((c) => !c.folder)
    .sort((a, b) => byId(a.id, b.id))
    .map((c) => ({ abs: c.abs, noteId: c.id, full: !blank.has(c.id) }));
  if (rootItems.length > 0) clusters.push({ folder: null, items: rootItems });
  for (const [rel, f] of [...folders].sort(([a], [b]) => byId(a, b))) {
    clusters.push({
      folder: rel,
      items: f.notes
        .sort(byId)
        .map((id) => ({ abs: cards.get(id)!.abs, noteId: id, full: !blank.has(id) })),
    });
  }
  const refItems = [...refs]
    .sort(([a], [b]) => byId(a, b))
    .map(([key, abs]) => ({ abs, noteId: noteIdOf(abs), refKey: key }));
  if (refItems.length > 0) clusters.push({ folder: null, items: refItems });

  // Cluster positions are card-to-card: the group rect (kept for snapshots,
  // unpainted on the lens) wraps its cards and overlaps into the gaps.
  let cx = 0;
  let cy = 0;
  let rowH = 0;
  for (const cluster of clusters) {
    const grouped = cluster.folder !== null;
    const sizes = cluster.items.map(sizeOf);
    const g = pack(sizes, grouped ? GAP + TAB_ROOM : GAP);
    if (cx > 0 && cx + g.w > ROW_MAX) {
      cx = 0;
      cy += rowH + CLUSTER_GAP;
      rowH = 0;
    }
    if (grouped) {
      nodes.push({
        id: `g${++seq}`,
        type: "group",
        x: cx - PAD,
        y: cy - PAD - LABEL,
        width: g.w + 2 * PAD,
        height: g.h + 2 * PAD + LABEL,
        label: cluster.folder!,
        raw: {},
      });
    }
    cluster.items.forEach((it, i) => {
      const id = `n${++seq}`;
      nodes.push({
        id,
        type: "file",
        x: cx + g.pos[i].x,
        y: cy + g.pos[i].y,
        width: sizes[i].w,
        height: sizes[i].h,
        file: fileField(it.abs, it.noteId),
        raw: {},
      });
      if (it.refKey !== undefined) refNode.set(it.refKey, id);
      else if (it.noteId) noteNode.set(it.noteId, id);
      if (grouped && i === 0) folderFirst.set(cluster.folder!, id);
    });
    cx += g.w + CLUSTER_GAP;
    rowH = Math.max(rowH, g.h);
  }

  // A folder link now shares a target with a direct link to that folder's
  // first note, so edges dedupe again on their endpoints; a note linking its
  // own folder would draw an edge to itself, which says nothing.
  const edges: CanvasEdge[] = [];
  const drawn = new Set<string>();
  for (const l of links) {
    const from = noteNode.get(l.from);
    const to =
      l.toKind === "note"
        ? noteNode.get(l.to)
        : l.toKind === "folder"
          ? folderFirst.get(l.to)
          : refNode.get(l.to);
    if (!from || !to || from === to) continue;
    const key = `${from}→${to}`;
    if (drawn.has(key)) continue;
    drawn.add(key);
    edges.push({ id: `e${edges.length + 1}`, fromNode: from, toNode: to, raw: {} });
  }

  return serializeCanvas({ nodes, edges, raw: {} });
}
