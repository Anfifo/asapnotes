import { invoke } from "@tauri-apps/api/core";

export interface FileInfo {
  name: string;
  modified_ms: number;
}

export interface ProjectCandidate {
  name: string;
  path: string;
  md_count: number;
}

export const listNotes = () => invoke<FileInfo[]>("list_notes");
export const listProjects = () => invoke<string[]>("list_projects");
export const notesRootPath = () => invoke<string>("notes_root_path");
export const moveNote = (from: string, to: string) => invoke<void>("move_note", { from, to });
/** Returns the project-base-relative asset path, e.g. "assets/img-123.png".
 * The project rides in a header, so it must survive the ASCII-only rule. */
export const saveAsset = (bytes: Uint8Array, ext: string, project?: string | null) =>
  invoke<string>("save_asset", bytes, {
    headers: project ? { ext, project: encodeURIComponent(project) } : { ext },
  });
export const importAsset = (src: string, project?: string | null) =>
  invoke<string>("import_asset", { src, project: project ?? null });
export const readNote = (name: string) => invoke<string>("read_note", { name });
export const saveNote = (name: string, content: string) =>
  invoke<void>("save_note", { name, content });

export const listDrafts = () => invoke<FileInfo[]>("list_drafts");
export const readDraft = (id: string) => invoke<string>("read_draft", { id });
export const writeDraft = (id: string, content: string) =>
  invoke<void>("write_draft", { id, content });
export const deleteDraft = (id: string) => invoke<void>("delete_draft", { id });

export const scanProjects = (dir: string) => invoke<ProjectCandidate[]>("scan_projects", { dir });
export const addExternalProjects = (projects: { name: string; path: string }[]) =>
  invoke<void>("add_external_projects", { projects });
export const removeExternalProject = (name: string) =>
  invoke<void>("remove_external_project", { name });
export const listExternalProjects = () => invoke<Record<string, string>>("list_external_projects");

export const quit = () => invoke<void>("quit");
