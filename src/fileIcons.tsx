import { ReactNode } from "react";

/**
 * The glyphs the note-type registry's `icon` ids name. Stroke icons from the
 * Lucide set (ISC license, https://lucide.dev/license), inlined the same way
 * the toolbar's are — `currentColor` strokes, no dependency. A new icon id is
 * code here by design: the registry adds extensions from JSON, never assets.
 */

/** The sheet-with-folded-corner outline every file glyph shares. */
const sheet = (
  <>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
  </>
);

const GLYPHS: Record<string, ReactNode> = {
  file: sheet,
  "file-text": (
    <>
      {sheet}
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </>
  ),
  "file-json": (
    <>
      {sheet}
      <path d="M10 12a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1" />
      <path d="M14 12a1 1 0 0 1 1 1v1a1 1 0 0 0 1 1 1 1 0 0 0-1 1v1a1 1 0 0 1-1 1" />
    </>
  ),
  "file-code": (
    <>
      {sheet}
      <path d="m10 13-2 2 2 2" />
      <path d="m14 17 2-2-2-2" />
    </>
  ),
  "file-spreadsheet": (
    <>
      {sheet}
      <path d="M8 13h2" />
      <path d="M14 13h2" />
      <path d="M8 17h2" />
      <path d="M14 17h2" />
    </>
  ),
  "file-terminal": (
    <>
      {sheet}
      <path d="m8 16 2-2-2-2" />
      <path d="M12 18h4" />
    </>
  ),
};

/** A file row's type glyph; unknown or missing ids draw the plain file. */
export function FileIcon({ icon, color }: { icon: string | null; color: string | null }) {
  return (
    <span className="file-icon" style={color ? { color } : undefined} aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {GLYPHS[icon ?? "file"] ?? GLYPHS.file}
      </svg>
    </span>
  );
}
