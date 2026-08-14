import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";

const KEY = "windowSize";
// Below this the chrome stops fitting — also filters the degenerate sizes
// some resize events report.
const MIN_W = 320;
const MIN_H = 240;

/** Restore the last remembered window size (re-centered), then keep
 * remembering resizes. Runs once at app launch while the window is still
 * hidden, so a summon never sees it move; the config default stands until
 * the first real resize is stored. */
export function initWindowSize() {
  const win = getCurrentWindow();
  void (async () => {
    try {
      const stored = JSON.parse(localStorage.getItem(KEY) ?? "null") as {
        width?: unknown;
        height?: unknown;
      } | null;
      if (
        stored &&
        typeof stored.width === "number" &&
        typeof stored.height === "number" &&
        Number.isFinite(stored.width) &&
        Number.isFinite(stored.height) &&
        stored.width >= MIN_W &&
        stored.height >= MIN_H
      ) {
        await win.setSize(new LogicalSize(stored.width, stored.height));
        // setSize keeps the top-left corner — re-center like a fresh launch.
        await win.center();
      }
    } catch {
      // Corrupt entry or denied call — the config default stands.
    }

    let timer: number | undefined;
    await win.onResized((e) => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        void (async () => {
          // Only the normal size is worth remembering — maximized restores
          // maximized-shaped, and minimize reports a meaningless size.
          if ((await win.isMaximized()) || (await win.isMinimized())) return;
          const size = e.payload.toLogical(await win.scaleFactor());
          if (size.width < MIN_W || size.height < MIN_H) return;
          localStorage.setItem(
            KEY,
            JSON.stringify({ width: Math.round(size.width), height: Math.round(size.height) }),
          );
        })();
      }, 300);
    });
  })();
}
