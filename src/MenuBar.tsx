import { useEffect, useRef, useState, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import mark from "../assets/mark.svg";
import { Icon, type IconName } from "./icons";

/** `checked` makes the item one of a set of states: a check column appears on
 * every item of that menu, ticked where it is true. */
export type MenuEntry =
  { label: string; detail?: string; checked?: boolean; run: () => void } | "sep";

export interface MenuDef {
  label: string;
  /** Alt-shortcut letter; defaults to the label's first letter. */
  mnemonic?: string;
  /** Render as a value chip instead of a menu title: a glyph and the current
   * value, a hairline after it. The label stays the menu's name for the
   * keyboard; bare Alt skips chips and opens the first real menu. */
  chip?: { icon: IconName; text: string };
  items: MenuEntry[];
}

/** Label with the Alt-mnemonic letter underlined. */
function MnemonicLabel({ label, letter }: { label: string; letter: string }) {
  const i = label.toLowerCase().indexOf(letter.toLowerCase());
  if (i < 0) return <>{label}</>;
  return (
    <>
      {label.slice(0, i)}
      <u>{label[i]}</u>
      {label.slice(i + 1)}
    </>
  );
}

interface MenuBarProps {
  menus: MenuDef[];
  /** Text in the centered search pill — the open note doubles as the window title. */
  searchLabel: string;
  /** Click on the search pill (opens the combined command/note palette). */
  onSearch: () => void;
  /** Rendered beside the search pill, inside the flex row — where the meeting
   * chip lives, so a running recording is visible whatever tab is up. */
  status?: ReactNode;
  /** ✕ hides to the tray (residency invariant) — never exits the app. */
  onHide: () => void;
}

/** Custom title bar: dropdown menus, drag region, window buttons. The window
 * is undecorated, so this row *is* the OS title bar.
 * Keyboard-reachable: Alt toggles the first menu, Alt+letter opens one by
 * mnemonic, arrows navigate, Enter runs, Esc closes. */
export function MenuBar({ menus, searchLabel, onSearch, status, onHide }: MenuBarProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  // Keyboard highlight within the open dropdown (-1 = mouse only).
  const [selIdx, setSelIdx] = useState(-1);

  const menusRef = useRef(menus);
  menusRef.current = menus;
  const openRef = useRef(openMenu);
  openRef.current = openMenu;
  const selRef = useRef(selIdx);
  selRef.current = selIdx;
  // Alt pressed alone arms the menubar toggle for keyup (Windows convention);
  // any other key while it's held (Alt+Tab, Alt+F4…) disarms it.
  const altPending = useRef(false);

  useEffect(() => {
    const mnemonicOf = (m: MenuDef) => (m.mnemonic ?? m.label[0]).toLowerCase();
    const openViaKeyboard = (label: string) => {
      setOpenMenu(label);
      setSelIdx(0);
    };
    const close = () => {
      setOpenMenu(null);
      setSelIdx(-1);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const all = menusRef.current;
      if (e.key === "Alt") {
        if (!e.repeat) altPending.current = true;
        e.preventDefault(); // suppress the webview's own Alt handling
        return;
      }
      // AltGr (Ctrl+Alt) types characters on many layouts — leave it alone.
      if (e.altKey && !e.ctrlKey && e.key.length === 1) {
        altPending.current = false;
        const menu = all.find((m) => mnemonicOf(m) === e.key.toLowerCase());
        if (menu) {
          e.preventDefault();
          openViaKeyboard(menu.label);
        }
        return;
      }
      altPending.current = false;
      const open = openRef.current;
      if (!open) return;
      const idx = all.findIndex((m) => m.label === open);
      const items = all[idx]?.items ?? [];
      const steps = items.flatMap((it, i) => (it === "sep" ? [] : [i]));
      const move = (dir: 1 | -1) => {
        if (steps.length === 0) return;
        const pos = steps.indexOf(selRef.current);
        if (pos < 0) setSelIdx(dir > 0 ? steps[0] : steps[steps.length - 1]);
        else setSelIdx(steps[(pos + dir + steps.length) % steps.length]);
      };
      switch (e.key) {
        case "ArrowRight":
          openViaKeyboard(all[(idx + 1) % all.length].label);
          break;
        case "ArrowLeft":
          openViaKeyboard(all[(idx + all.length - 1) % all.length].label);
          break;
        case "ArrowDown":
          move(1);
          break;
        case "ArrowUp":
          move(-1);
          break;
        case "Home":
          setSelIdx(steps[0] ?? -1);
          break;
        case "End":
          setSelIdx(steps[steps.length - 1] ?? -1);
          break;
        case "Enter": {
          const item = items[selRef.current];
          if (item && item !== "sep") {
            close();
            item.run();
          }
          break;
        }
        default:
          return; // anything else falls through to the editor
      }
      e.preventDefault();
      e.stopPropagation();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt" && altPending.current) {
        altPending.current = false;
        e.preventDefault();
        if (openRef.current) close();
        else {
          const first = menusRef.current.find((m) => !m.chip);
          if (first) openViaKeyboard(first.label);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, []);

  // While a menu is open: click-away or Esc closes it. App's global Esc
  // handler sees the open dropdown and leaves Esc to the menubar.
  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element).closest(".menubar")) setOpenMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenMenu(null);
        setSelIdx(-1);
      }
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
      <img className="menubar-mark" src={mark} alt="" draggable={false} />
      {menus.map((menu) => {
        const base = menu.chip ? "menu-chip" : "menu-btn";
        const checkable = menu.items.some((it) => it !== "sep" && it.checked !== undefined);
        return (
          <div className="menu" key={menu.label}>
            <button
              className={openMenu === menu.label ? `${base} open` : base}
              aria-label={menu.chip ? `${menu.label}: ${menu.chip.text}` : undefined}
              // preventDefault keeps editor focus/selection — formatting items need it
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setSelIdx(-1);
                setOpenMenu((o) => (o === menu.label ? null : menu.label));
              }}
              onPointerEnter={() => {
                setOpenMenu((o) => {
                  if (o === null || o === menu.label) return o;
                  setSelIdx(-1);
                  return menu.label;
                });
              }}
            >
              {menu.chip ? (
                <>
                  <span className="chip-icon">
                    <Icon name={menu.chip.icon} />
                  </span>
                  <span className="chip-text">{menu.chip.text}</span>
                  <span className="chip-chevron">
                    <Icon name="chevron-down" />
                  </span>
                </>
              ) : (
                <MnemonicLabel label={menu.label} letter={menu.mnemonic ?? menu.label[0]} />
              )}
            </button>
            {menu.chip && <span className="menu-vsep" />}
            {openMenu === menu.label && (
              <div className="menu-drop">
                {menu.items.map((item, i) =>
                  item === "sep" ? (
                    <hr key={i} />
                  ) : (
                    <button
                      key={item.label}
                      className={i === selIdx ? "menu-item selected" : "menu-item"}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setOpenMenu(null);
                        setSelIdx(-1);
                        item.run();
                      }}
                    >
                      {checkable && (
                        <span className="menu-check">{item.checked && <Icon name="check" />}</span>
                      )}
                      <span className="menu-label">{item.label}</span>
                      {item.detail && <span className="menu-detail">{item.detail}</span>}
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
        );
      })}
      {/* Command center: the search pill sits IN the flex row
          between two drag regions, so it can never cross the menus — it
          centers in the leftover space and shrinks (label ellipsizes) first. */}
      <div className="menubar-drag" data-tauri-drag-region />
      <button
        className="menubar-search"
        data-tip="Search notes and commands (Ctrl+K)"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onSearch}
      >
        <span className="search-glyph">
          <Icon name="search" />
        </span>
        <span className="search-label">{searchLabel}</span>
      </button>
      {status}
      <div className="menubar-drag" data-tauri-drag-region />
      {/* Segoe Fluent Icons caption glyphs: minimize / maximize / close */}
      <button
        className="win-btn"
        aria-label="Minimize"
        data-tip="Minimize"
        onClick={() => void win.minimize()}
      >
        {""}
      </button>
      <button
        className="win-btn"
        aria-label="Maximize"
        data-tip="Maximize"
        onClick={() => void win.toggleMaximize()}
      >
        {""}
      </button>
      <button
        className="win-btn win-close"
        aria-label="Hide to tray"
        data-tip="Hide to tray (Esc)"
        onClick={onHide}
      >
        {""}
      </button>
    </div>
  );
}
