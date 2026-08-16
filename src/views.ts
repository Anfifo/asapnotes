/**
 * What the app does with a view beyond drawing it — the code half of the
 * note-type registry. The registry is user data and only ever *names* a view;
 * everything a name implies lives here, in this repository, which is the line
 * that keeps a canvas a native view rather than a plugin.
 *
 * Deliberately not the components yet: with three views the choice is still one
 * branch in App, and the dynamic import belongs in this table when a fourth
 * arrives (see docs/project-model.md).
 */

import type { ViewId } from "./noteTypes";

export interface ViewPolicy {
  /**
   * How the buffer reaches disk.
   *
   * `explicit` — Ctrl+S writes the file; edits between saves live in a shadow
   * draft. Right for prose: a save is a decision.
   *
   * `auto` — the file itself is written shortly after each change, and the
   * draft is skipped so dirty state has one source of truth. Right for a
   * surface whose content *is* direct manipulation: nobody expects to press
   * Ctrl+S after dragging a card, and a canvas already writes pasted images to
   * disk the moment they land.
   */
  persist: "explicit" | "auto";
  /**
   * Base file name for an untitled note of this view whose content cannot name
   * itself. Null means derive the name from the first line, which is what
   * prose supports and a JSON document does not.
   */
  nameBase: string | null;
}

const POLICIES: Record<ViewId, ViewPolicy> = {
  markdown: { persist: "explicit", nameBase: null },
  text: { persist: "explicit", nameBase: null },
  canvas: { persist: "auto", nameBase: "untitled" },
};

export const policyOf = (view: ViewId): ViewPolicy => POLICIES[view];
