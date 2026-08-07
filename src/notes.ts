import { invoke } from "@tauri-apps/api/core";

export interface FileInfo {
  name: string;
  modified_ms: number;
}

export const listNotes = () => invoke<FileInfo[]>("list_notes");
export const listProjects = () => invoke<string[]>("list_projects");
export const notesRootPath = () => invoke<string>("notes_root_path");
export const moveNote = (from: string, to: string) => invoke<void>("move_note", { from, to });
/** Returns the root-relative asset path, e.g. "assets/img-123.png". */
export const saveAsset = (bytes: Uint8Array, ext: string) =>
  invoke<string>("save_asset", bytes, { headers: { ext } });
export const importAsset = (src: string) => invoke<string>("import_asset", { src });
export const readNote = (name: string) => invoke<string>("read_note", { name });
export const saveNote = (name: string, content: string) =>
  invoke<void>("save_note", { name, content });

export const listDrafts = () => invoke<FileInfo[]>("list_drafts");
export const readDraft = (id: string) => invoke<string>("read_draft", { id });
export const writeDraft = (id: string, content: string) =>
  invoke<void>("write_draft", { id, content });
export const deleteDraft = (id: string) => invoke<void>("delete_draft", { id });
