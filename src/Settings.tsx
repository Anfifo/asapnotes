import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";

const KEYBINDS: [string, string][] = [
  ["Ctrl+Alt+Space", "Summon / hide (global)"],
  ["Ctrl+N", "New note"],
  ["Ctrl+S", "Save note"],
  ["Ctrl+K", "Command palette"],
  ["Ctrl+P", "Switch note"],
  ["Ctrl+E", "Preview ⇄ edit"],
  ["Ctrl+Shift+E", "Explorer"],
  ["Ctrl+B", "Bold"],
  ["Ctrl+I", "Italic"],
  ["Ctrl+F", "Find in note"],
  ["Ctrl+Z / Ctrl+Y", "Undo / redo"],
  ["Tab / Shift+Tab", "Indent / outdent list"],
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
  /** External (linked-in-place) projects: name → absolute folder path. */
  externalProjects: Record<string, string>;
  onRemoveProject: (name: string) => void;
  onClose: () => void;
}

export function Settings({ rootPath, externalProjects, onRemoveProject, onClose }: SettingsProps) {
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
        {Object.keys(externalProjects).length > 0 && (
          <>
            <h2>Linked projects</h2>
            <table>
              <tbody>
                {Object.entries(externalProjects).map(([name, path]) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td className="settings-path">
                      {path}{" "}
                      <button
                        className="settings-remove"
                        title="Unlink — the folder and its files stay untouched"
                        onClick={() => onRemoveProject(name)}
                      >
                        ✕
                      </button>
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
