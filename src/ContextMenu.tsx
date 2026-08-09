import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MenuEntry } from "./MenuBar";

export interface ContextMenuState {
  x: number;
  y: number;
  entries: MenuEntry[];
}

/** Right-click menu — shares the menubar dropdown's look, positioned at the
 * pointer and clamped into the viewport. Closes on select, click-away, Esc. */
export function ContextMenu({ menu, onClose }: { menu: ContextMenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });

  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({
      x: Math.min(menu.x, Math.max(4, window.innerWidth - r.width - 4)),
      y: Math.min(menu.y, Math.max(4, window.innerHeight - r.height - 4)),
    });
  }, [menu]);

  // App's global Esc handler sees the .menu-drop in the DOM and leaves Esc to us.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element).closest(".ctx-menu")) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="menu-drop ctx-menu" style={{ left: pos.x, top: pos.y }}>
      {menu.entries.map((item, i) =>
        item === "sep" ? (
          <hr key={i} />
        ) : (
          <button
            key={item.label}
            className="menu-item"
            // preventDefault keeps editor focus/selection — cut/copy need it
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onClose();
              item.run();
            }}
          >
            <span>{item.label}</span>
            {item.detail && <span className="menu-detail">{item.detail}</span>}
          </button>
        ),
      )}
    </div>
  );
}
