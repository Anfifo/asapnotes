import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";

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

/** The app's identity card, its own small overlay — configuration lives in
 * Settings, this is only what the app *is*. */
export function About({ onClose }: { onClose: () => void }) {
  const [version, setVersion] = useState("");
  useEffect(() => {
    void getVersion().then(setVersion);
  }, []);

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="settings about" onClick={(e) => e.stopPropagation()}>
        <h1>About asapnotes</h1>
        <table>
          <tbody>
            <tr>
              <td>Version</td>
              <td>asapnotes {version}</td>
            </tr>
            <tr>
              <td>Auto-update</td>
              <td>Planned — updates are manual for now</td>
            </tr>
            <tr>
              <td>Made by</td>
              <td className="settings-credits">
                <ExternalLink href="https://anfifo.com">Anfifo</ExternalLink>
              </td>
            </tr>
            <tr>
              <td>Support</td>
              <td className="settings-credits settings-support">
                <ExternalLink href="https://buymeacoffee.com/anfifo">
                  ☕ Buy me a coffee
                </ExternalLink>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
