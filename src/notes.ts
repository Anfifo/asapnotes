import { invoke } from "@tauri-apps/api/core";
import type { NoteType } from "./noteTypes";

export interface FileInfo {
  name: string;
  modified_ms: number;
}

export interface ProjectCandidate {
  name: string;
  path: string;
  md_count: number;
}

/** Backend caps results here; a full page is the caller's cue to say "first N". */
export const SEARCH_LIMIT = 500;

/** One matching line; the caller re-finds the query in `text` to highlight it. */
export interface SearchHit {
  note: string;
  /** 1-based. */
  line: number;
  text: string;
}

/** `deep: false` skips external projects — fast root-only list for first paint. */
export const listNotes = (deep = true) => invoke<FileInfo[]>("list_notes", { deep });

/** A project heading as the explorer sees it. `missing` means its registered
 * folder is gone from disk — the walks list nothing there, so without the
 * flag it would read as an empty project. */
export interface ProjectInfo {
  name: string;
  missing: boolean;
}

export const listProjects = () => invoke<ProjectInfo[]>("list_projects");
/** Parse problems in any project's `.asapnotes.json`. The walks fall back to
 * default rules rather than failing, so a broken file is reported here. */
export const projectConfigErrors = () => invoke<string[]>("project_config_errors");
/** Case-insensitive literal search over every note's contents. Results stop at
 * `limit`, so a full result set is the caller's cue to say so. */
export const searchNotes = (query: string, limit: number = SEARCH_LIMIT) =>
  invoke<SearchHit[]>("search_notes", { query, limit });
export const notesRootPath = () => invoke<string>("notes_root_path");

// --- Recent changes: external edits to markdown notes, from the snapshot store ---

/** How far back the recent-changes view reaches. */
export const CHANGES_DAYS = 7;

/** One external edit as the ledger sees it: which note, when, how much.
 * `seen` is the user's read-marker — the view dims those and the rail badge
 * counts only the rest. */
export interface ChangeSummary {
  note: string;
  atMs: number;
  added: number;
  removed: number;
  seen: boolean;
}

/** One marked line of the lens document: its 1-based position, and the UTF-16
 * column ranges of the words that changed. No ranges means the whole line is
 * new — those are marked wholesale rather than word by word. */
export interface LensLine {
  line: number;
  spans: [number, number][];
}

/** A run of removed lines, hanging after the surviving line above them
 * (`afterLine` 0 = above the first line). */
export interface LensDel {
  afterLine: number;
  lines: string[];
}

/** The note as another tool left it, with the window's external edits marked
 * on it — one baseline, not one document per edit. */
export interface NoteLens {
  note: string;
  text: string;
  added: LensLine[];
  dels: LensDel[];
  addedN: number;
  removedN: number;
  atMs: number;
  /** The user has saved since, so `text` is the state the other tool left
   * behind rather than what is on disk now. */
  ownEditsSince: boolean;
}

/** Snapshot notes that changed on disk behind the app's back — rides the
 * window-focus signal, no watcher. Returns how many edits it recorded. */
export const scanChanges = () => invoke<number>("scan_changes");
export const recentChanges = (days: number = CHANGES_DAYS) =>
  invoke<ChangeSummary[]>("recent_changes", { days });
/** One note's marked document; null when nothing external touched it in the
 * window (its changes have aged out since the ledger was read). */
export const noteLens = (note: string, days: number = CHANGES_DAYS) =>
  invoke<NoteLens | null>("note_lens", { note, days });
/** Mark (or unmark) changes as read in the seen ledger. */
export const setChangesSeen = (items: { note: string; atMs: number }[], seen: boolean) =>
  invoke<void>("set_changes_seen", { items, seen });
export const moveNote = (from: string, to: string) => invoke<void>("move_note", { from, to });
/** Create a real folder inside a project (`dir` is its would-be id path). */
export const createFolder = (dir: string) => invoke<void>("create_folder", { dir });
/** Recycle-bin a folder and everything in it; drafts under it go too. */
export const deleteFolder = (dir: string) => invoke<void>("delete_folder", { dir });
/** Recycle bin, not hard delete; the note's draft goes with it. */
export const deleteNote = (name: string) => invoke<void>("delete_note", { name });
export const revealNote = (name: string) => invoke<void>("reveal_note", { name });
/** URL → default handler; existing absolute path → default app, which for a
 * folder means opening it in File Explorer (executables are revealed there
 * instead, never run). Backs Ctrl+Clicked link targets and the explorer's
 * "Open in File Explorer". */
export const openExternal = (target: string) => invoke<void>("open_external", { target });
/** Returns the asset path relative to the note's base folder, e.g.
 * "assets/img-123.png". The note id rides in a header, so it must survive the
 * ASCII-only rule. */
export const saveAsset = (bytes: Uint8Array, ext: string, note?: string | null) =>
  invoke<string>("save_asset", bytes, {
    headers: note ? { ext, note: encodeURIComponent(note) } : { ext },
  });
export const importAsset = (src: string, note?: string | null) =>
  invoke<string>("import_asset", { src, note: note ?? null });
export const readNote = (name: string) => invoke<string>("read_note", { name });
/** File mtime in ms, null if the file doesn't exist. */
export const noteMtime = (name: string) => invoke<number | null>("note_mtime", { name });
export const saveNote = (name: string, content: string) =>
  invoke<void>("save_note", { name, content });

export const listDrafts = () => invoke<FileInfo[]>("list_drafts");
export const readDraft = (id: string) => invoke<string>("read_draft", { id });
export const writeDraft = (id: string, content: string) =>
  invoke<void>("write_draft", { id, content });
export const deleteDraft = (id: string) => invoke<void>("delete_draft", { id });
/** Recycle-bin a draft — for discarding the only copy of some content, where
 * deleteDraft is the silent cleanup once content is safe elsewhere. */
export const discardDraft = (id: string) => invoke<void>("discard_draft", { id });

export const scanProjects = (dir: string) => invoke<ProjectCandidate[]>("scan_projects", { dir });

/** What a picked folder offers a project about to live in it. */
export interface FolderInfo {
  has_git: boolean;
  /** An existing docs/documentation folder, else the docs/ that would be made. */
  docs: string;
}

export const folderInfo = (path: string) => invoke<FolderInfo>("folder_info", { path });

/** Where a new project lives: no `path` means a subfolder of the notes root.
 * `useDocs` roots it at the picked folder's docs/ (or documentation/) instead,
 * creating docs/ when neither exists. */
export interface NewProject {
  name: string;
  path?: string | null;
  useDocs?: boolean;
}

export const createProject = (project: NewProject) => invoke<void>("create_project", { project });
/** Link folders found by a scan, in bulk. */
export const linkProjects = (projects: { name: string; path: string; useDocs?: boolean }[]) =>
  invoke<void>("link_projects", { projects });
/** Forget a project's entry; its folder and files stay where they are. */
export const unlinkProject = (name: string) => invoke<void>("unlink_project", { name });
export const setProjectPath = (name: string, path: string) =>
  invoke<void>("set_project_path", { name, path });

/** A folder attached into a project, as the explorer sees it. `conflicted`
 * means a real folder took that name over — the real folder wins, and the
 * mount lists nothing until the clash is gone. */
export interface MountInfo {
  project: string;
  /** Project-relative path the folder is attached at. */
  at: string;
  /** The absolute folder it points at. */
  path: string;
  conflicted: boolean;
  /** The backing folder is gone from disk — the explorer says so instead of
   * showing an indistinguishably empty folder. */
  missing: boolean;
  /** Backed by a folder outside the virtual-folders home — one the user owns
   * elsewhere, which deletion warnings call out by path. */
  external: boolean;
}

export const listMounts = () => invoke<MountInfo[]>("list_mounts");
/** Attach an existing folder into a project at a project-relative name
 * ("associate virtual folder"). */
export const addMount = (project: string, at: string, path: string) =>
  invoke<void>("add_mount", { project, at, path });
/** Create a brand-new virtual folder: its backing directory is made in the
 * virtual-folders home (settings `virtualFoldersRoot`, default app data) and
 * attached at `at`. */
export const createVirtualFolder = (project: string, at: string) =>
  invoke<void>("create_virtual_folder", { project, at });
/** Detach it again; the folder and its files stay where they are. */
export const removeMount = (project: string, at: string) =>
  invoke<void>("remove_mount", { project, at });
/** Delete it outright: the backing folder goes to the recycle bin, then the
 * mount is detached. */
export const deleteMount = (project: string, at: string) =>
  invoke<void>("delete_mount", { project, at });

// --- Personal settings (app-data settings.json) ---

/** A folder attached into a project at a project-relative name. `listMounts`
 * is what the app resolves through — it adds the project and the clash check. */
export interface Mount {
  at: string;
  path: string;
}

/** Attributes of a project. No `path` means it lives at `<notes root>/<name>`. */
export interface Project {
  path?: string | null;
  mounts?: Mount[];
  mcp?: string | null;
}

/** Values `localStorage` also mirrors, because they are read before the first
 * paint. Absent means never chosen — the mirror's value stands. */
export interface Appearance {
  theme?: string | null;
  zoom?: number | null;
  /** `pane` is the current-project panel's height; absent = size-to-content.
   * `hideRecent` / `hideNotes` are panels closed from their header. */
  explorer?: {
    width?: number | null;
    pinned?: boolean | null;
    pane?: number | null;
    hideRecent?: boolean | null;
    hideNotes?: boolean | null;
  } | null;
  /** Where a note type's color lands on an explorer row: "full" | "icon". */
  explorerTint?: string | null;
  /** Popup text size (menus, context menus, palette rows) as a percentage of
   * the default (85 | 100 | 115). */
  popupScale?: number | null;
}

export interface Settings {
  version: number;
  appearance: Appearance;
  projects: Record<string, Project>;
  noteTypes: NoteType[];
  /** Personal gitignore-syntax patterns applied to every walk; a project's
   * `.asapnotes.json` list is appended after, so the project file overrides. */
  files?: string[];
  /** Where "New virtual folder" creates backing folders; absent = app data. */
  virtualFoldersRoot?: string | null;
  /** App-shortcut overrides, action id → chord. Only overrides are stored —
   * the defaults live in the frontend's action table (keybinds.ts). */
  keybinds?: Record<string, string>;
  /** The global summon hotkey; absent means the shipped default. */
  summonHotkey?: string | null;
}

/** `error` is set when the file couldn't be parsed: shipped defaults are in
 * force and nothing will be written over it until it's fixed. */
export interface SettingsRead {
  settings: Settings;
  error: string | null;
}

/** `reload` re-reads the file — how a hand-edit takes effect. */
export const getSettings = (reload = false) => invoke<SettingsRead>("get_settings", { reload });
export const setAppearance = (appearance: Appearance) =>
  invoke<void>("set_appearance", { appearance });
/** Replace the keybind overrides wholesale (reset = send without the key). */
export const setKeybinds = (keybinds: Record<string, string>) =>
  invoke<void>("set_keybinds", { keybinds });
/** Re-register the global summon hotkey live and persist it; rejects with the
 * reason when the chord can't be parsed or is taken by another app. */
export const setSummonHotkey = (hotkey: string) => invoke<void>("set_summon_hotkey", { hotkey });

export const quit = () => invoke<void>("quit");
