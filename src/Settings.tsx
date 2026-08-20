import { useCallback, useEffect, useRef, useState } from "react";
import {
  mcpStatus,
  setMcpGrant,
  setMcpSettingsAccess,
  setMcpWriteScope,
  type McpStatus,
} from "./notes";
import { creatableTypes } from "./noteTypes";
import type { Theme } from "./theme";
import {
  APP_ACTIONS,
  bindingConflict,
  chordOfEvent,
  chordsOf,
  DEFAULT_SUMMON,
  summonConflict,
} from "./keybinds";

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

/** The chords the app can't hand out: the editor's own keymap (chosen when it
 * mounts) and the keys the window handler treats specially. Shown so the
 * whole map is in one place, marked fixed rather than silently missing. */
const FIXED_ROWS: [string, string][] = [
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
  ["Alt", "Menu bar (Alt+F/E/O/V/S open a menu)"],
  ["Esc", "Hide window"],
];

/** One editable shortcut: the chord is a button that records the next chord
 * pressed. While recording, the app's own key handler stands down (it skips
 * anything inside `.chord-recording`), so pressing Ctrl+W records instead of
 * closing a tab. */
function ChordRow({
  label,
  value,
  overridden,
  validate,
  onCommit,
  onReset,
}: {
  label: string;
  value: string;
  overridden: boolean;
  /** Why this chord can't be used, or null when it can. */
  validate: (chord: string) => string | null;
  onCommit: (chord: string) => void;
  onReset: () => void;
}) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <tr>
      <td>
        {recording ? (
          <button
            className="chord-record chord-recording"
            autoFocus
            onKeyDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (e.key === "Escape") {
                setRecording(false);
                setError(null);
                return;
              }
              const chord = chordOfEvent(e.nativeEvent);
              if (!chord) return; // a modifier alone — keep listening
              const problem = validate(chord);
              if (problem) {
                setError(problem);
                return;
              }
              setError(null);
              setRecording(false);
              onCommit(chord);
            }}
            onBlur={() => {
              setRecording(false);
              setError(null);
            }}
          >
            press keys… <span className="chord-hint">(Esc cancels)</span>
          </button>
        ) : (
          <button
            className="chord-record"
            data-tip="Click, then press the new shortcut"
            onClick={() => setRecording(true)}
          >
            <kbd>{value}</kbd>
          </button>
        )}
        {overridden && !recording && (
          <button
            className="settings-remove"
            aria-label={`Reset ${label} to its default`}
            data-tip="Reset to default"
            onClick={onReset}
          >
            ↺
          </button>
        )}
      </td>
      <td>
        {label}
        {recording && error && <span className="chord-error">{error}</span>}
      </td>
    </tr>
  );
}

/** The three grants, in the order the control offers them. "Hidden" rather than
 * "off" because that is what it does: a hidden project answers a sidecar
 * exactly what a note that was never there answers. */
const MCP_GRANTS: [string, string][] = [
  ["off", "Hidden"],
  ["read", "Read"],
  ["write", "Write"],
];

/** Windows paths go into the config with forward slashes — accepted there, and
 * it keeps the pasted line free of escaped backslashes. */
const fwd = (path: string) => path.replace(/\\/g, "/");

/** A log line's time: the clock alone for today, the date as well before that,
 * since the log reaches back further than a session. */
function logTime(atMs: number): string {
  const at = new Date(atMs);
  const time = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const today = new Date().toDateString() === at.toDateString();
  return today ? time : `${at.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

/**
 * Settings → MCP: whether a sidecar can reach these notes, and what it has
 * changed.
 *
 * Ordered by what someone actually comes here to do. Connecting a client is
 * first because it is the step with nothing else to guide it — and the helper's
 * path is something only the running app knows. Access is second, and it is
 * editable: a grant that can only be set by hand-editing JSON is a grant nobody
 * sets. The log is last, and it exists for the same reason the whole feature
 * does — an app an agent can write to should show what was written.
 *
 * This section fetches its own state rather than taking it as props: nothing
 * else in the app needs it, and it has to be re-read after every change here.
 */
function McpSection() {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showLog, setShowLog] = useState(false);

  const load = useCallback(() => {
    mcpStatus()
      .then((s) => {
        setStatus(s);
        setError(null);
      })
      .catch((e: unknown) => setError(String(e)));
  }, []);

  useEffect(load, [load]);

  /** Every change here writes settings.json, so the panel re-reads rather than
   * assuming its own optimistic state took. */
  const apply = (change: Promise<void>) => {
    change.then(load).catch((e: unknown) => setError(String(e)));
  };

  if (error && !status) {
    return (
      <>
        <h2>MCP</h2>
        <p className="settings-note">{error}</p>
      </>
    );
  }
  if (!status) {
    return (
      <>
        <h2>MCP</h2>
        <p className="settings-note">Reading…</p>
      </>
    );
  }

  const projects = Object.entries(status.grants);
  const writable = projects.filter(([, g]) => g === "write").length;
  const readable = projects.filter(([, g]) => g === "read").length;
  const hidden = projects.filter(([, g]) => g === "off").length;

  // A complete, valid entry for a client's server list. Every path goes through
  // JSON.stringify so quoting and escaping are the serializer's problem, but the
  // lines are laid out by hand — a fully pretty-printed object puts each path on
  // a line of its own and doubles the height of the block.
  const server = status.serverPath ?? "<this repo>/mcp/dist/src/index.js";
  const snippet = [
    `"asapnotes": {`,
    `  "command": "node",`,
    `  "args": [${JSON.stringify(fwd(server))}]${status.helperPath ? "," : ""}`,
    ...(status.helperPath
      ? [`  "env": { "ASAPNOTES_MCP_HELPER": ${JSON.stringify(fwd(status.helperPath))} }`]
      : []),
    `}`,
  ].join("\n");

  const copy = () => {
    navigator.clipboard.writeText(snippet).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      },
      (e: unknown) => setError(String(e)),
    );
  };

  return (
    <>
      <h2>Connect a client</h2>
      <table>
        <tbody>
          <tr>
            <td>Status</td>
            <td>
              <span className={status.helperExists ? "mcp-dot ok" : "mcp-dot bad"} />
              {status.helperExists
                ? `Ready — ${status.visibleProjects} project${status.visibleProjects === 1 ? "" : "s"} visible`
                : "The helper hasn't been built"}
            </td>
          </tr>
          <tr>
            <td>Serving</td>
            <td className="settings-path">{status.notesRoot}</td>
          </tr>
        </tbody>
      </table>
      {status.helperExists ? (
        <>
          <pre className="mcp-snippet">{snippet}</pre>
          <p className="settings-note">
            <button className="mcp-btn" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>{" "}
            Paste it into your client&rsquo;s MCP server list.
            {!status.serverPath &&
              " Fill in where this repo's mcp folder is — an installed app doesn't carry it."}
          </p>
        </>
      ) : (
        <p className="settings-note">
          Build it with <code>cargo build --bin asapnotes-mcp</code> in <code>src-tauri</code>, then
          reopen this panel. An installed app ships the helper already.
        </p>
      )}
      {status.settingsError && <p className="settings-note">{status.settingsError}</p>}

      <h2>Project access</h2>
      <table>
        <tbody>
          {projects.map(([project, grant]) => (
            <tr key={project}>
              <td>{project}</td>
              <td>
                <div className="segmented" role="group" aria-label={`MCP access to ${project}`}>
                  {MCP_GRANTS.map(([value, label]) => (
                    <button
                      key={value}
                      className={value === grant ? "active" : undefined}
                      aria-pressed={value === grant}
                      onClick={() => apply(setMcpGrant(project, value))}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </td>
            </tr>
          ))}
          <tr>
            <td>Writes</td>
            <td>
              <div className="segmented" role="group" aria-label="Where writes may land">
                {(
                  [
                    ["current", "Current project"],
                    ["any", "Any project"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    className={value === status.writeScope ? "active" : undefined}
                    aria-pressed={value === status.writeScope}
                    onClick={() => apply(setMcpWriteScope(value))}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </td>
          </tr>
          <tr>
            <td>settings.json</td>
            <td>
              <div className="segmented" role="group" aria-label="Access to settings.json">
                {MCP_GRANTS.map(([value, label]) => (
                  <button
                    key={value}
                    className={value === status.defaults.settings ? "active" : undefined}
                    aria-pressed={value === status.defaults.settings}
                    onClick={() => apply(setMcpSettingsAccess(value))}
                  >
                    {value === "off" ? "Off" : label}
                  </button>
                ))}
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <p className="settings-note">
        {writable} writable · {readable} read-only · {hidden} hidden
        {status.writeScope === "current" &&
          ` · writes go to ${status.currentProject ?? "nothing — no note is open in a project"}`}
      </p>
      {status.defaults.settings !== "off" && (
        <p className="settings-note">
          <span className="mcp-warn">Reading settings.json</span> A sidecar can see every project
          location on this machine. The grants themselves stay out of its reach.
        </p>
      )}
      {error && <p className="settings-note">{error}</p>}

      <h2>Recent activity</h2>
      {status.recentCalls.length === 0 ? (
        <p className="settings-note">No writes yet. Reads are never logged.</p>
      ) : (
        <>
          <button className="mcp-disclose" onClick={() => setShowLog(!showLog)}>
            {showLog ? "▾" : "▸"} {status.recentCalls.length} write
            {status.recentCalls.length === 1 ? "" : "s"}, newest first
          </button>
          {showLog && (
            <table>
              <tbody>
                {status.recentCalls.map((call, at) => (
                  <tr key={`${call.atMs}-${at}`}>
                    <td className="mcp-when">{logTime(call.atMs)}</td>
                    <td className="settings-path">
                      <code>{call.tool}</code> {call.summary}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </>
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
  /** App-shortcut overrides (action id → chord); defaults live in keybinds.ts. */
  keybinds: Record<string, string>;
  onSetKeybind: (action: string, chord: string | null) => void;
  /** The global summon hotkey, and the rebind that re-registers it live. */
  summonHotkey: string;
  onChangeSummonHotkey: (chord: string) => void;
  /** Registry type id "New note" creates; null means markdown. */
  defaultNoteType: string | null;
  onDefaultNoteTypeChange: (id: string | null) => void;
  /** How a referenced non-markdown file opens from a canvas or map: false is
   * the in-app read-only view, true the system default app. */
  openFilesExternally: boolean;
  onOpenFilesExternallyChange: (on: boolean) => void;
  /** A canvas the window opens on at launch — set from the canvas itself, so
   * this row only shows and clears it. */
  openAtLaunch: string | null;
  onClearOpenAtLaunch: () => void;
  /** Where to land on open — "shortcuts" scrolls to that table. */
  section: "top" | "shortcuts";
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
  keybinds,
  onSetKeybind,
  summonHotkey,
  onChangeSummonHotkey,
  defaultNoteType,
  onDefaultNoteTypeChange,
  openFilesExternally,
  onOpenFilesExternallyChange,
  openAtLaunch,
  onClearOpenAtLaunch,
  section,
  onClose,
}: SettingsProps) {
  // "Keyboard shortcuts" opens straight onto its table — it's the last
  // section, buried below the fold at any window size.
  const shortcutsRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (section === "shortcuts") shortcutsRef.current?.scrollIntoView();
  }, [section]);

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="settings" onClick={(e) => e.stopPropagation()}>
        <h1>Settings</h1>
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
        <h2>Notes</h2>
        <table>
          <tbody>
            <tr>
              <td>New note format</td>
              <td>
                <div className="segmented" role="group" aria-label="New note format">
                  {creatableTypes().map((t) => (
                    <button
                      key={t.id}
                      className={t.id === (defaultNoteType ?? "markdown") ? "active" : undefined}
                      aria-pressed={t.id === (defaultNoteType ?? "markdown")}
                      onClick={() => onDefaultNoteTypeChange(t.id === "markdown" ? null : t.id)}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
                <p className="settings-note">
                  What “New note” creates. A note captured from the summon hotkey is always markdown
                  — capture means start typing.
                </p>
              </td>
            </tr>
            <tr>
              <td>Referenced files</td>
              <td>
                <div className="segmented" role="group" aria-label="Referenced files">
                  <button
                    className={!openFilesExternally ? "active" : undefined}
                    aria-pressed={!openFilesExternally}
                    onClick={() => onOpenFilesExternallyChange(false)}
                  >
                    In app, read-only
                  </button>
                  <button
                    className={openFilesExternally ? "active" : undefined}
                    aria-pressed={openFilesExternally}
                    onClick={() => onOpenFilesExternallyChange(true)}
                  >
                    System default
                  </button>
                </div>
                <p className="settings-note">
                  How double-clicking a file card that isn’t a note opens it. Markdown always opens
                  in the app; images always open in the system viewer.
                </p>
              </td>
            </tr>
            {openAtLaunch !== null && (
              <tr>
                <td>Opens at launch</td>
                <td className="settings-path">
                  {openAtLaunch}{" "}
                  <button
                    className="settings-edit"
                    aria-label="Stop opening this canvas at launch"
                    data-tip="Go back to reopening the last tab"
                    onClick={() => onClearOpenAtLaunch()}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <h2>Storage</h2>
        <table>
          <tbody>
            <tr>
              <td>Notes folder</td>
              <td className="settings-path">{rootPath}</td>
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
                            aria-label={`Change folder for ${name}`}
                            data-tip="Change folder — new projects root at the repo's docs/"
                            onClick={() => onChangeProjectPath(name)}
                          >
                            ✎
                          </button>
                          <button
                            className="settings-remove"
                            aria-label={`Unlink ${name}`}
                            data-tip="Unlink — the folder and its files stay untouched"
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
        <McpSection />
        <h2 ref={shortcutsRef}>Keyboard shortcuts</h2>
        <p className="settings-note">Click a shortcut to change it; ↺ puts the default back.</p>
        <table>
          <tbody>
            <ChordRow
              label="Summon / hide (global)"
              value={summonHotkey}
              overridden={summonHotkey !== DEFAULT_SUMMON}
              validate={summonConflict}
              onCommit={onChangeSummonHotkey}
              onReset={() => onChangeSummonHotkey(DEFAULT_SUMMON)}
            />
            {APP_ACTIONS.map((a) => (
              <ChordRow
                key={a.id}
                label={a.label}
                value={chordsOf(a.id, keybinds)}
                overridden={a.id in keybinds}
                validate={(chord) => bindingConflict(a.id, chord, keybinds)}
                onCommit={(chord) => onSetKeybind(a.id, chord)}
                onReset={() => onSetKeybind(a.id, null)}
              />
            ))}
            {FIXED_ROWS.map(([keys, action]) => (
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
