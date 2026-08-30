/**
 * The project map's three layouts by name — the one piece of the map module
 * the app shell imports eagerly (for the setting and the palette), so it stays
 * free of the layout code itself, which loads with the view.
 */

export type ViewKind = "clusters" | "constellation" | "ledger";

export const VIEW_KINDS: readonly ViewKind[] = ["clusters", "constellation", "ledger"];

export const VIEW_LABELS: Record<ViewKind, string> = {
  clusters: "Clusters",
  constellation: "Constellation",
  ledger: "Ledger",
};

/** What a map opens in when the setting is absent or names nothing known. */
export const DEFAULT_VIEW: ViewKind = "constellation";

export const isViewKind = (v: unknown): v is ViewKind =>
  typeof v === "string" && (VIEW_KINDS as readonly string[]).includes(v);
