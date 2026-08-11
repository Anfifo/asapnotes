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
export const listProjects = () => invoke<string[]>("list_projects");
/** Parse problems in any project's `.asapnotes.json`. The walks fall back to
 * default rules rather than failing, so a broken file is reported here. */
export const projectConfigErrors = () => invoke<string[]>("project_config_errors");
/** Case-insensitive literal search over every note's contents. Results stop at
 * `limit`, so a full result set is the caller's cue to say so. */
export const searchNotes = (query: string, limit: number = SEARCH_LIMIT) =>
  invoke<SearchHit[]>("search_notes", { query, limit });
export const notesRootPath = () => invoke<string>("notes_root_path");
export const moveNote = (from: string, to: string) => invoke<void>("move_note", { from, to });
/** Create a real folder inside a project (`dir` is its would-be id path). */
export const createFolder = (dir: string) => invoke<void>("create_folder", { dir });
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
}

export const listMounts = () => invoke<MountInfo[]>("list_mounts");
/** Attach an existing folder into a project at a project-relative name. */
export const addMount = (project: string, at: string, path: string) =>
  invoke<void>("add_mount", { project, at, path });
/** Detach it again; the folder and its files stay where they are. */
export const removeMount = (project: string, at: string) =>
  invoke<void>("remove_mount", { project, at });

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
  explorer?: { width?: number | null; pinned?: boolean | null } | null;
}

export interface Settings {
  version: number;
  appearance: Appearance;
  projects: Record<string, Project>;
  noteTypes: NoteType[];
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

export const quit = () => invoke<void>("quit");
