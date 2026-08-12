/**
 * The note-type registry: which extensions are notes, and what the app may
 * offer for each. The data lives in app-data `settings.json`, which the backend
 * ships defaults for and reads the same way — so the allowlist is one list, not
 * two kept in sync.
 *
 * `view` and `icon` are ids into in-tree tables: a user can add an extension or
 * recolor one by editing JSON, but a new view is code in this repository.
 *
 * Loaded once when settings arrive, which is before any note opens (both happen
 * after the same startup round trip), and replaced when they reload. A reload
 * reaches the chrome on the next render and the editor on the next open — the
 * editor's extensions are chosen when it mounts.
 */

/** Affordances a type can declare. A closed set: every name is something the
 * app implements, and the chrome keys off these rather than "is it markdown". */
export type Feature = "live-preview" | "preview" | "mentions" | "format" | "images" | "ink";

const FEATURES: Feature[] = ["live-preview", "preview", "mentions", "format", "images", "ink"];

/** Editing surfaces that exist. Anything else in the file reads as "text". */
export type ViewId = "markdown" | "text";

/** One registry entry, as it appears in `settings.json`. `view` and `features`
 * are plain strings because the file is user-editable; unknown values mean
 * nothing rather than breaking. */
export interface NoteType {
  id: string;
  name: string;
  extensions: string[];
  view: string;
  icon: string | null;
  color: string | null;
  features: string[];
}

let registry: NoteType[] = [];

export function setNoteTypes(types: NoteType[]) {
  registry = types;
}

const extOf = (path: string) => {
  const file = path.split("/").pop() ?? path;
  const dot = file.lastIndexOf(".");
  // A leading-dot name has no stem, so it isn't a note either.
  return dot > 0 ? file.slice(dot + 1).toLowerCase() : null;
};

/** First type claiming this file's extension, null when none does. */
export function noteTypeOf(path: string): NoteType | null {
  const ext = extOf(path);
  if (!ext) return null;
  return registry.find((t) => t.extensions.some((e) => e.toLowerCase() === ext)) ?? null;
}

/** Is this a note at all — the registry's extensions are the allowlist. */
export const isNoteFile = (path: string) => noteTypeOf(path) !== null;

export const hasFeature = (path: string, feature: Feature) =>
  noteTypeOf(path)?.features.includes(feature) ?? false;

/** Features a path's type declares, narrowed to the ones the app implements. */
export const featuresOf = (path: string): Feature[] => {
  const declared = noteTypeOf(path)?.features ?? [];
  return FEATURES.filter((f) => declared.includes(f));
};

/** Editing surface for a path. */
export const viewOf = (path: string): ViewId =>
  noteTypeOf(path)?.view === "markdown" ? "markdown" : "text";

/** Tint ids the app defines per theme (as `--tint-*` in App.css). */
const TINTS = ["blue", "amber", "rose", "purple", "green", "orange", "gray", "teal"];

/** CSS color for a path's type: a theme-aware tint when `color` names one, a
 * literal when the user wrote one, null when the type is colorless. */
export function colorOf(path: string): string | null {
  const color = noteTypeOf(path)?.color;
  if (!color) return null;
  if (color.startsWith("#")) return color;
  return TINTS.includes(color) ? `var(--tint-${color})` : null;
}

/** Glyph id for a path's type, null when it declares none. */
export const iconOf = (path: string): string | null => noteTypeOf(path)?.icon ?? null;
