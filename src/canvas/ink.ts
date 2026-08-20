/**
 * Stroke rendering shared by the canvas surface (ink node bitmaps) and the
 * image-annotation flatten — both must draw the same stroke identically, or
 * what gets saved into an image wouldn't match what was drawn.
 */

import type { InkStroke } from "./jsoncanvas";

/** Spec colors are a preset "1".."6" or a hex value; both become one CSS
 * custom property the node's own rules pick up. Presets are named rather than
 * numbered so the stylesheet reads. */
export const PRESET_COLORS = ["#c8402f", "#c8762f", "#c8a72f", "#4f9e4f", "#3f8fbf", "#8f5fbf"];

export const nodeAccent = (color: string | undefined): string | undefined => {
  if (!color) return undefined;
  if (color.startsWith("#")) return color;
  const n = Number(color);
  return Number.isInteger(n) && n >= 1 && n <= 6 ? PRESET_COLORS[n - 1] : undefined;
};

/** How pressure modulates the nominal width: neutral 0.5 is 1×, a light pen
 * touch thins toward 0.4×, full pressure doubles. */
export const pressureScale = (p: number) => Math.min(2, Math.max(0.4, p * 2));

/** Draw one stroke: each segment carries its own width so pressure reads as a
 * taper, and round caps make the per-segment joints invisible. A single point
 * is a dot. Coordinates are whatever space `ctx` is transformed into. */
export const strokePath = (ctx: CanvasRenderingContext2D, s: InkStroke, color: string) => {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const pts = s.points;
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0][0], pts[0][1], (s.width * pressureScale(pts[0][2])) / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  for (let i = 1; i < pts.length; i++) {
    ctx.beginPath();
    ctx.moveTo(pts[i - 1][0], pts[i - 1][1]);
    ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.lineWidth = (s.width * (pressureScale(pts[i - 1][2]) + pressureScale(pts[i][2]))) / 2;
    ctx.stroke();
  }
};
