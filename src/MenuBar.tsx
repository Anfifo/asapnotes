import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type MenuEntry = { label: string; detail?: string; run: () => void } | "sep";

export interface MenuDef {
  label: string;
  items: MenuEntry[];
}

interface MenuBarProps {
  menus: MenuDef[];
  /** ✕ hides to the tray (residency invariant) — never exits the app. */
  onHide: () => void;
}

/** Custom title bar: dropdown menus, drag region, window buttons. The window
 * is undecorated (VSCode-style), so this row *is* the OS title bar. */
export function MenuBar({ menus, onHide }: MenuBarProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  // While a menu is open: click-away or Esc closes it. App's global Esc
  // handler sees the open dropdown and leaves Esc to us.
  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element).closest(".menubar")) setOpenMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenu(null);
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [openMenu]);

  const win = getCurrentWindow();

  return (
    <div className="menubar">
      {menus.map((menu) => (
        <div className="menu" key={menu.label}>
          <button
            className={openMenu === menu.label ? "menu-btn open" : "menu-btn"}
            // preventDefault keeps editor focus/selection — formatting items need it
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setOpenMenu((o) => (o === menu.label ? null : menu.label))}
            onPointerEnter={() => setOpenMenu((o) => (o !== null ? menu.label : o))}
          >
            {menu.label}
          </button>
          {openMenu === menu.label && (
            <div className="menu-drop">
              {menu.items.map((item, i) =>
                item === "sep" ? (
                  <hr key={i} />
                ) : (
                  <button
                    key={item.label}
                    className="menu-item"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setOpenMenu(null);
                      item.run();
                    }}
                  >
                    <span>{item.label}</span>
                    {item.detail && <span className="menu-detail">{item.detail}</span>}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      ))}
      <div className="menubar-drag" data-tauri-drag-region />
      <button className="win-btn" title="Minimize" onClick={() => void win.minimize()}>
        &#x2500;
      </button>
      <button className="win-btn" title="Maximize" onClick={() => void win.toggleMaximize()}>
        &#x25A1;
      </button>
      <button className="win-btn win-close" title="Hide to tray (Esc)" onClick={onHide}>
        &#x2715;
      </button>
    </div>
  );
}
