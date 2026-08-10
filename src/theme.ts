/**
 * Theme selection. The resolved theme is stamped as `data-theme` on the root
 * element instead of the stylesheet reading `prefers-color-scheme` directly —
 * that buys the user a real choice, and it lifts a constraint on the editor:
 * a CodeMirror HighlightStyle carries fixed values and can't follow a media
 * query, so every syntax colour had to sit at one mid-lightness compromise.
 * Routing those colours through CSS variables under an attribute selector lets
 * both themes get properly tuned colours instead.
 */

export type Theme = "light" | "dark" | "system";

const KEY = "theme";

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

export function getTheme(): Theme {
  const saved = localStorage.getItem(KEY);
  return saved === "light" || saved === "dark" ? saved : "system";
}

/** Stamp the resolved theme, so CSS only ever matches "light" or "dark". */
function apply(theme: Theme) {
  const dark = theme === "system" ? darkQuery.matches : theme === "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function setTheme(theme: Theme) {
  if (theme === "system") localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, theme);
  apply(theme);
}

/**
 * Apply the stored theme and keep following the OS while it stays "system".
 * Called before the first render so nothing paints in the wrong theme.
 */
export function initTheme() {
  apply(getTheme());
  darkQuery.addEventListener("change", () => {
    if (getTheme() === "system") apply("system");
  });
}
