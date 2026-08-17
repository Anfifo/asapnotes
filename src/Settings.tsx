import { useEffect, useRef, useState } from "react";
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
