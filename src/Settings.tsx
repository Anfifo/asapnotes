import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Theme } from "./theme";

const THEMES: [Theme, string][] = [
  ["light", "Light"],
  ["dark", "Dark"],
  ["system", "System"],
];

const TINTS: ["full" | "icon", string][] = [
  ["full", "Icon + extension"],
  ["icon", "Icon only"],
];

/** Popup text size steps, as percentages of the default token. */
const POPUP_SIZES: [number, string][] = [
  [85, "Small"],
  [100, "Default"],
  [115, "Large"],
];

const KEYBINDS: [string, string][] = [
  ["Ctrl+Alt+A", "Summon / hide (global)"],
  ["Ctrl+N / Ctrl+T", "New note (tab)"],
  ["Ctrl+S", "Save note"],
  ["Ctrl+W", "Close tab"],
  ["Ctrl+Tab / Ctrl+Shift+Tab", "Next / previous tab"],
  ["Ctrl+K", "Command palette"],
  ["Ctrl+P", "Switch note"],
  ["Ctrl+E", "Preview ⇄ edit"],
  ["Ctrl+Shift+E", "Explorer"],
  ["Ctrl+Shift+F", "Search in all notes"],
  ["Ctrl+B", "Bold"],
  ["Ctrl+I", "Italic"],
  ["Ctrl+1 / 2 / 3", "Heading 1 / 2 / 3"],
  ["Ctrl+Shift+C", "Inline code"],
  ["Ctrl+Shift+8", "Bullet list"],
  ["Ctrl+Shift+7", "Numbered list"],
  ["Ctrl+Shift+9", "Quote"],
  ["Ctrl+Shift+L", "Link"],
  ["Ctrl+F", "Find in note"],
  ["Ctrl+H", "Replace"],
  ["Ctrl+G", "Go to line"],
  ["Ctrl+Shift+K", "Delete line"],
  ["Ctrl+Z / Ctrl+Y", "Undo / redo"],
  ["Tab / Shift+Tab", "Indent / outdent list"],
  ["Ctrl+= / Ctrl+- / Ctrl+0", "Zoom in / out / reset (also Ctrl+scroll)"],
  ["Alt", "Menu bar (Alt+F/E/O/V/H open a menu)"],
  ["Esc", "Hide window"],
];

/** External links must leave the webview — route them through the opener plugin. */
function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        void openUrl(href);
      }}
    >
      {children}
    </a>
  );
}

interface SettingsProps {
  rootPath: string;
  /** Every project, whether it lives in the notes folder (no `path`) or is
   * linked in place from elsewhere. */
  projects: { name: string; path: string | null }[];
  /** Forget a linked project's entry; its folder and files stay put. */
  onUnlinkProject: (name: string) => void;
  /** Pick a different folder for a linked project (e.g. a repo's docs/). */
  onChangeProjectPath: (name: string) => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  /** Where a note type's color lands on explorer rows. */
  explorerTint: "full" | "icon";
  onExplorerTintChange: (tint: "full" | "icon") => void;
  /** Popup text size (menus, context menus, palette) as a % of the default. */
  popupScale: number;
  onPopupScaleChange: (scale: number) => void;
  onClose: () => void;
}

export function Settings({
  rootPath,
  projects,
  onUnlinkProject,
  onChangeProjectPath,
  theme,
  onThemeChange,
  explorerTint,
  onExplorerTintChange,
  popupScale,
  onPopupScaleChange,
  onClose,
}: SettingsProps) {
  const [version, setVersion] = useState("");
  useEffect(() => {
    void getVersion().then(setVersion);
  }, []);

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="settings" onClick={(e) => e.stopPropagation()}>
        <h1>Settings</h1>
        <h2>About</h2>
        <div className="settings-credits">
          <ExternalLink href="https://anfifo.com">
            Made by <b>Anfifo</b>
          </ExternalLink>
          <span aria-hidden>·</span>
          <ExternalLink href="https://buymeacoffee.com/anfifo">☕ Buy me a coffee</ExternalLink>
        </div>
        <table>
          <tbody>
            <tr>
              <td>Version</td>
              <td>asapnotes {version}</td>
            </tr>
            <tr>
              <td>Notes folder</td>
              <td className="settings-path">{rootPath}</td>
            </tr>
            <tr>
              <td>Auto-update</td>
              <td>Planned — updates are manual for now</td>
            </tr>
          </tbody>
        </table>
        <h2>Appearance</h2>
        <table>
          <tbody>
            <tr>
              <td>Theme</td>
              <td>
                <div className="segmented" role="group" aria-label="Theme">
                  {THEMES.map(([value, label]) => (
                    <button
                      key={value}
                      className={value === theme ? "active" : undefined}
                      aria-pressed={value === theme}
                      onClick={() => onThemeChange(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </td>
            </tr>
            <tr>
              <td>File-type color</td>
              <td>
                <div className="segmented" role="group" aria-label="File-type color">
                  {TINTS.map(([value, label]) => (
                    <button
                      key={value}
                      className={value === explorerTint ? "active" : undefined}
                      aria-pressed={value === explorerTint}
                      onClick={() => onExplorerTintChange(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </td>
            </tr>
            <tr>
              <td>Popup text size</td>
              <td>
                <div className="segmented" role="group" aria-label="Popup text size">
                  {POPUP_SIZES.map(([value, label]) => (
                    <button
                      key={value}
                      className={value === popupScale ? "active" : undefined}
                      aria-pressed={value === popupScale}
                      onClick={() => onPopupScaleChange(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        {projects.length > 0 && (
          <>
            <h2>Projects</h2>
            <table>
              <tbody>
                {projects.map(({ name, path }) => (
                  <tr key={name}>
                    <td>{name}</td>
                    {/* A project is a location: the notes folder, or one of its
                        own — which is also what says whether it can be moved
                        or unlinked at all. */}
                    <td className="settings-path">
                      {path ?? <span className="muted">In the notes folder</span>}
                      {path && (
                        <>
                          {" "}
                          <button
                            className="settings-edit"
                            title="Change folder — new projects root at the repo's docs/"
                            onClick={() => onChangeProjectPath(name)}
                          >
                            ✎
                          </button>
                          <button
                            className="settings-remove"
                            title="Unlink — the folder and its files stay untouched"
                            onClick={() => onUnlinkProject(name)}
                          >
                            ✕
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <h2>Keyboard shortcuts</h2>
        <table>
          <tbody>
            {KEYBINDS.map(([keys, action]) => (
              <tr key={keys}>
                <td>
                  <kbd>{keys}</kbd>
                </td>
                <td>{action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
