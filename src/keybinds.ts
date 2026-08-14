/**
 * The app-level shortcut table: every chord the window key handler owns, as
 * data. Defaults live here; settings.json's `keybinds` holds only overrides
 * (action id → chord), and an override replaces *all* of an action's default
 * chords — rebinding "New note" retires Ctrl+N and Ctrl+T together.
 *
 * Editor-internal chords stay in Editor.tsx, chosen when it mounts; they are
 * listed here only so the settings table can show them and the conflict check
 * can refuse handing them out.
 */

export type AppActionId =
  | "new-note"
  | "save"
  | "close-tab"
  | "next-tab"
  | "command-palette"
  | "switch-note"
  | "preview"
  | "explorer"
  | "search"
  | "zoom-in"
  | "zoom-out"
  | "zoom-reset";

export interface AppAction {
  id: AppActionId;
  label: string;
  defaults: string[];
}

export const APP_ACTIONS: AppAction[] = [
  { id: "new-note", label: "New note (tab)", defaults: ["Ctrl+N", "Ctrl+T"] },
  { id: "save", label: "Save note", defaults: ["Ctrl+S"] },
  { id: "close-tab", label: "Close tab", defaults: ["Ctrl+W"] },
  { id: "next-tab", label: "Next tab (Shift reverses)", defaults: ["Ctrl+Tab"] },
  { id: "command-palette", label: "Command palette", defaults: ["Ctrl+K", "Ctrl+Shift+P"] },
  { id: "switch-note", label: "Switch note", defaults: ["Ctrl+P"] },
  { id: "preview", label: "Preview ⇄ edit", defaults: ["Ctrl+E"] },
  { id: "explorer", label: "Explorer", defaults: ["Ctrl+Shift+E"] },
  { id: "search", label: "Search in all notes", defaults: ["Ctrl+Shift+F"] },
  { id: "zoom-in", label: "Zoom in (also Ctrl+scroll)", defaults: ["Ctrl+=", "Ctrl++"] },
  { id: "zoom-out", label: "Zoom out", defaults: ["Ctrl+-"] },
  { id: "zoom-reset", label: "Reset zoom", defaults: ["Ctrl+0"] },
];

/** Shipped summon hotkey; `summonHotkey` in settings.json overrides it. */
export const DEFAULT_SUMMON = "Ctrl+Alt+A";

/** Chords the app can't give away, chord → what owns it. */
export const FIXED_CHORDS: Record<string, string> = {
  "Ctrl+B": "Bold",
  "Ctrl+I": "Italic",
  "Ctrl+1": "Heading 1",
  "Ctrl+2": "Heading 2",
  "Ctrl+3": "Heading 3",
  "Ctrl+Shift+C": "Inline code",
  "Ctrl+Shift+8": "Bullet list",
  "Ctrl+Shift+7": "Numbered list",
  "Ctrl+Shift+9": "Quote",
  "Ctrl+Shift+L": "Link",
  "Ctrl+F": "Find in note",
  "Ctrl+H": "Replace",
  "Ctrl+G": "Go to line",
  "Ctrl+Shift+K": "Delete line",
  "Ctrl+Z": "Undo",
  "Ctrl+Y": "Redo",
  "Ctrl+Shift+Z": "Redo",
  Esc: "Hide window",
  Tab: "Indent",
  "Shift+Tab": "Outdent",
};

/** A keydown as a chord string, or null while only modifiers are down. Letters
 * uppercase; otherwise the event's own key name, so recording and matching
 * can't disagree about a layout's shifted symbols. */
export function chordOfEvent(e: KeyboardEvent): string | null {
  const k = e.key;
  if (k === "Control" || k === "Alt" || k === "Shift" || k === "Meta") return null;
  const key = k === " " ? "Space" : k === "Escape" ? "Esc" : k.length === 1 ? k.toUpperCase() : k;
  return `${e.ctrlKey ? "Ctrl+" : ""}${e.altKey ? "Alt+" : ""}${e.shiftKey ? "Shift+" : ""}${key}`;
}

/** chord → action, with overrides applied. */
export function bindingTable(overrides: Record<string, string>): Map<string, AppActionId> {
  const table = new Map<string, AppActionId>();
  for (const a of APP_ACTIONS) {
    for (const c of overrides[a.id] ? [overrides[a.id]] : a.defaults) table.set(c, a.id);
  }
  return table;
}

const action = (id: AppActionId) => APP_ACTIONS.find((a) => a.id === id)!;

/** What the settings table shows: the override, or the defaults joined. */
export const chordsOf = (id: AppActionId, overrides: Record<string, string>) =>
  overrides[id] ?? action(id).defaults.join(" / ");

/** The primary chord — what menu detail slots and tooltips print. */
export const chordFor = (id: AppActionId, overrides: Record<string, string>) =>
  overrides[id] ?? action(id).defaults[0];

/** Why `chord` can't be bound to `actionId`, or null when it can. */
export function bindingConflict(
  actionId: AppActionId,
  chord: string,
  overrides: Record<string, string>,
): string | null {
  // Bare keys and Shift-only chords would fire while typing.
  if (!/(^|\+)F\d+$/.test(chord) && !chord.startsWith("Ctrl+") && !chord.includes("Alt+")) {
    return "needs Ctrl or Alt (or an F-key)";
  }
  if (FIXED_CHORDS[chord]) return `${chord} is fixed — ${FIXED_CHORDS[chord]}`;
  const owner = bindingTable(overrides).get(chord);
  if (owner && owner !== actionId) return `${chord} already runs ${action(owner).label}`;
  return null;
}

/** Why `chord` can't be the global summon hotkey, or null. Restricted to keys
 * whose names the hotkey registration on the Rust side is known to parse. */
export function summonConflict(chord: string): string | null {
  if (!chord.startsWith("Ctrl+") && !chord.includes("Alt+")) return "needs Ctrl or Alt";
  const key = chord.split("+").pop() ?? "";
  if (!/^([A-Z0-9]|F\d{1,2}|Space)$/.test(key)) return "use a letter, digit, F-key or Space";
  return null;
}
