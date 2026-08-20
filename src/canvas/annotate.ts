/**
 * The image-annotation lens's document and its flatten. The lens itself is
 * BoardView in annotate mode; this module computes the one-image document it
 * renders and rasterizes the finished drawing back into the image's pixels.
 *
 * Loaded on demand (dynamic import at the call site) like the rest of the
 * canvas machinery — a summon never pays for it.
 */

import { parseCanvas, serializeCanvas } from "./jsoncanvas";
import { nodeAccent, strokePath } from "./ink";

/** Natural pixel size of an image, or null when it can't be decoded. */
export const imageNaturalSize = (url: string): Promise<{ width: number; height: number } | null> =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () =>
      resolve(
        img.naturalWidth && img.naturalHeight
          ? { width: img.naturalWidth, height: img.naturalHeight }
          : null,
      );
    img.onerror = () => resolve(null);
    img.src = url;
  });

/** The lens's computed document: one file node at the origin, sized at the
 * image's natural pixels — canvas units equal image pixels, so a stroke's
 * coordinates are already the pixels the flatten paints. */
export const annotateDocFor = (file: string, width: number, height: number): string =>
  serializeCanvas({
    nodes: [{ id: "image", type: "file", file, x: 0, y: 0, width, height, raw: {} }],
    edges: [],
    raw: {},
  });

/** The document after a flatten: the strokes just written are pixels now —
 * an eraser could no longer take them back — so they leave the lens too. */
export const withoutInk = (text: string): string => {
  const { doc } = parseCanvas(text);
  return serializeCanvas({ ...doc, nodes: doc.nodes.filter((n) => n.type !== "ink") });
};

/** Rasterize the session's strokes into the image and encode it back in its
 * own format. The vector strokes stay the truth until this runs — after it
 * they are pixels, which is the picked design, stated plainly. */
export async function flattenAnnotation(opts: {
  /** The lens document as last serialized — the image node plus ink nodes. */
  doc: string;
  /** Asset-protocol URL the current image bytes load from. */
  imageUrl: string;
  /** Encode target: image/png, image/jpeg or image/webp. */
  mime: string;
  /** Resolved color for strokes that carry none (the theme's ink). */
  ink: string;
}): Promise<Uint8Array> {
  const { doc, error } = parseCanvas(opts.doc);
  if (error) throw new Error(error);
  const imgNode = doc.nodes.find((n) => n.type === "file");
  if (!imgNode) throw new Error("the drawing lost its image node");

  // Decoded from fetched bytes, not an <img> — an image element loaded from
  // the asset protocol is cross-origin to the page and would taint the
  // canvas, which refuses to export tainted pixels.
  const res = await fetch(opts.imageUrl);
  if (!res.ok) throw new Error("the image could not be read back");
  const img = await createImageBitmap(await res.blob());

  const cv = document.createElement("canvas");
  cv.width = img.width;
  cv.height = img.height;
  const ctx = cv.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(img, 0, 0);

  // Canvas units equal image pixels by construction; the scale factors are a
  // guard in case they ever drift apart.
  const sx = img.width / imgNode.width;
  const sy = img.height / imgNode.height;
  for (const n of doc.nodes) {
    if (n.type !== "ink" || !n.strokes) continue;
    ctx.setTransform(sx, 0, 0, sy, (n.x - imgNode.x) * sx, (n.y - imgNode.y) * sy);
    for (const s of n.strokes) strokePath(ctx, s, nodeAccent(s.color) ?? opts.ink);
  }

  const blob = await new Promise<Blob | null>((resolve) => cv.toBlob(resolve, opts.mime, 0.92));
  if (!blob || (opts.mime !== "image/png" && blob.type !== opts.mime)) {
    // toBlob falls back to PNG silently when it can't encode the asked-for
    // type; writing PNG bytes under a .jpg name would be a lie in the file.
    throw new Error(`this image type can't be re-encoded here`);
  }
  return new Uint8Array(await blob.arrayBuffer());
}
