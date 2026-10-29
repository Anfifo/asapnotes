import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open as openFolderDialog } from "@tauri-apps/plugin-dialog";
import {
  type Destinations,
  type Project,
  type Routing,
  cancelTranscriptionDownload,
  downloadTranscription,
  mcpStatus,
  removeTranscription,
  setMcpGrant,
  setMcpMeetings,
  setMcpSettingsAccess,
  setMcpWriteScope,
  transcriptionStatus,
  type McpStatus,
  type TranscriptionStatus,
} from "./notes";
import { TranscriptionSetup } from "./Transcribe";
import { Icon } from "./icons";
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
  ["Alt", "Menu bar (Alt+W/F/E/O/V/S open a menu)"],
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
            <Icon name="rotate-ccw" />
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
 * changed. Ordered connect → access → log, by what someone comes here to do.
 *
 * Fetches its own state rather than taking it as props: nothing else in the app
 * needs it, and it has to be re-read after every change made here.
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
          <tr>
            <td>Meetings</td>
            <td>
              <div className="segmented" role="group" aria-label="Agents may record meetings">
                {(
                  [
                    [false, "Off"],
                    [true, "On"],
                  ] as const
                ).map(([on, label]) => (
                  <button
                    key={label}
                    className={(status.defaults.meetings === "on") === on ? "active" : undefined}
                    aria-pressed={(status.defaults.meetings === "on") === on}
                    onClick={() => apply(setMcpMeetings(on))}
                  >
                    {label}
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
      {status.defaults.meetings === "on" && (
        <p className="settings-note">
          <span className="mcp-warn">Recording meetings</span> An agent can start and stop a
          recording of the microphone and system audio. The window comes up and the recording chip
          shows whenever one runs; telling the other participants is still on you.{" "}
          {writable > 0
            ? `Recordings can go into ${projects
                .filter(([, g]) => g === "write")
                .map(([p]) => p)
                .join(", ")}, the projects with Write access.`
            : "No project has Write access yet, so an agent can't start one anywhere: set the project to Write above."}
        </p>
      )}
      {error && <p className="settings-note">{error}</p>}

      <h2>Recent activity</h2>
      {status.recentCalls.length === 0 ? (
        <p className="settings-note">No writes yet. Reads are never logged.</p>
      ) : (
        <>
          <button className="mcp-disclose" onClick={() => setShowLog(!showLog)}>
            <Icon name={showLog ? "chevron-down" : "chevron-right"} /> {status.recentCalls.length}{" "}
            write
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
  /** How a referenced non-markdown file opens from the project map: false is
   * the in-app read-only view, true the system default app. */
  openFilesExternally: boolean;
  onOpenFilesExternallyChange: (on: boolean) => void;
  /** Where new notes land, globally and per project, and each project's code
   * folders. Each change replaces that table whole. */
  routing: Routing;
  onSetDestinations: (destinations: Destinations) => void;
  onSetProjectFolders: (project: string, destinations: Destinations, codeFolders: string[]) => void;
  /** Named sets of projects; "Default" (every project) is implicit and not
   * listed here. Names are unique keys — a rename is remove-and-add to App. */
  workspaces: Record<string, string[]>;
  onAddWorkspace: (name: string) => void;
  onRenameWorkspace: (from: string, to: string) => void;
  onRemoveWorkspace: (name: string) => void;
  onToggleWorkspaceProject: (workspace: string, project: string, on: boolean) => void;
  /** Where to land on open — "shortcuts" scrolls to that table, "workspaces"
   * to that section, "new-workspace" into its name box. */
  section: SettingsSection;
  onClose: () => void;
}

/** The transcription add-on: the engine and the speech models, downloaded on
 * request and removable here. Fetches its own state like the MCP section, and
 * follows the download events so a figure moves while the panel is open. */
function TranscriptionSection() {
  const [status, setStatus] = useState<TranscriptionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    transcriptionStatus()
      .then((s) => {
        setStatus(s);
        setError(null);
      })
      .catch((e: unknown) => setError(String(e)));
  }, []);

  useEffect(load, [load]);
  useEffect(() => {
    const subs = [
      listen("transcription-download", load),
      listen<{ what: string; error: string | null }>("transcription-download-done", (e) => {
        if (e.payload.error) setError(e.payload.error);
        load();
      }),
    ];
    return () => {
      for (const s of subs) void s.then((unlisten) => unlisten());
    };
  }, [load]);

  const run = (change: Promise<void>) => {
    change.then(load).catch((e: unknown) => setError(String(e)));
  };

  return (
    <>
      <h2>Transcription</h2>
      <p className="settings-note">
        An add-on that turns a meeting recording into text on this computer. The engine and a speech
        model are downloads you start here; nothing is fetched otherwise.
      </p>
      {status ? (
        <TranscriptionSetup
          status={status}
          onDownload={(what) => run(downloadTranscription(what))}
          onCancelDownload={() => run(cancelTranscriptionDownload())}
          onRemove={(what) => run(removeTranscription(what))}
        />
      ) : (
        <p className="settings-note">Reading…</p>
      )}
      {error && <p className="settings-note">{error}</p>}
    </>
  );
}

export type SettingsSection = "top" | "shortcuts" | "workspaces" | "new-workspace";

/** A destination folder, edited in place: saved on Enter or blur, reverted on
 * Escape. Callers key it by the stored value, so a write resets the draft. */
function FolderInput({
  value,
  placeholder,
  label,
  onCommit,
}: {
  value: string;
  placeholder: string;
  label: string;
  onCommit: (folder: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    const folder = draft.trim().replace(/^\/+|\/+$/g, "");
    if (folder === value) setDraft(value);
    else onCommit(folder);
  };
  return (
    <input
      className="ws-name ws-new"
      value={draft}
      placeholder={placeholder}
      spellCheck={false}
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(value);
          e.currentTarget.blur();
          e.stopPropagation();
        }
      }}
    />
  );
}

/** `destinations` with one kind's folder set, or removed when empty. */
function withFolder(d: Destinations, kind: "capture" | "meeting" | string, folder: string) {
  if (kind === "capture" || kind === "meeting") return { ...d, [kind]: folder || null };
  const types = { ...d.types };
  if (folder) types[kind] = folder;
  else delete types[kind];
  return { ...d, types };
}

/** One row per kind of new note, each a folder below `base`. Captures only
 * apply outside projects, so a project's table leaves that row out. */
function DestinationRows({
  destinations,
  base,
  withCapture,
  onChange,
}: {
  destinations: Destinations;
  base: string;
  withCapture: boolean;
  onChange: (next: Destinations) => void;
}) {
  const rows: [string, string][] = [
    ...(withCapture ? [["capture", "Quick capture"] as [string, string]] : []),
    ["meeting", "Meetings"],
    ...creatableTypes().map((t): [string, string] => [t.id, `New ${t.name} note`]),
  ];
  const valueOf = (kind: string) =>
    (kind === "capture"
      ? destinations.capture
      : kind === "meeting"
        ? destinations.meeting
        : destinations.types?.[kind]) ?? "";
  return rows.map(([kind, label]) => (
    <tr key={kind}>
      <td>{label}</td>
      <td>
        <FolderInput
          key={valueOf(kind)}
          value={valueOf(kind)}
          placeholder={base}
          label={`Folder for ${label}`}
          onCommit={(folder) => onChange(withFolder(destinations, kind, folder))}
        />
      </td>
    </tr>
  ));
}

/** A project's destinations and code folders, folded until opened. */
function ProjectFolders({
  name,
  project,
  onChange,
}: {
  name: string;
  project: Project | undefined;
  onChange: (destinations: Destinations, codeFolders: string[]) => void;
}) {
  const [shown, setShown] = useState(false);
  const destinations = project?.destinations ?? {};
  const code = project?.codeFolders ?? [];
  const addCode = async () => {
    const picked = await openFolderDialog({ directory: true, title: `Code folder for ${name}` });
    if (typeof picked === "string" && !code.includes(picked)) {
      onChange(destinations, [...code, picked]);
    }
  };
  return (
    <>
      <button className="mcp-disclose" onClick={() => setShown(!shown)}>
        <Icon name={shown ? "chevron-down" : "chevron-right"} /> {name}
        {code.length > 0 && ` · ${code.length} code folder${code.length === 1 ? "" : "s"}`}
      </button>
      {shown && (
        <table>
          <tbody>
            <DestinationRows
              destinations={destinations}
              base="Project folder"
              withCapture={false}
              onChange={(next) => onChange(next, code)}
            />
            <tr>
              <td>Code folders</td>
              <td>
                {code.map((folder) => (
                  <div key={folder} className="settings-path">
                    {folder}
                    <button
                      className="settings-remove"
                      aria-label={`Remove code folder ${folder}`}
                      data-tip="Remove — nothing on disk changes"
                      onClick={() =>
                        onChange(
                          destinations,
                          code.filter((f) => f !== folder),
                        )
                      }
                    >
                      <Icon name="x" />
                    </button>
                  </div>
                ))}
                <button className="mcp-btn" onClick={() => void addCode()}>
                  Add folder…
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </>
  );
}

/** A workspace name, in place: an empty name, "Default", or a taken one
 * reverts rather than saves — the row stays what it was. */
function nameProblem(name: string, taken: string[]): string | null {
  const n = name.trim();
  if (!n) return "A workspace needs a name";
  if (n.toLowerCase() === "default") return "Default is every project";
  if (taken.includes(n)) return `There is already a workspace named ${n}`;
  return null;
}

function WorkspaceName({
  value,
  taken,
  onCommit,
}: {
  value: string;
  taken: string[];
  onCommit: (name: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    const n = draft.trim();
    if (n === value || nameProblem(n, taken)) setDraft(value);
    else onCommit(n);
  };
  return (
    <input
      className="ws-name"
      value={draft}
      spellCheck={false}
      aria-label="Workspace name"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(value);
          e.currentTarget.blur();
          e.stopPropagation();
        }
      }}
    />
  );
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
  routing,
  onSetDestinations,
  onSetProjectFolders,
  workspaces,
  onAddWorkspace,
  onRenameWorkspace,
  onRemoveWorkspace,
  onToggleWorkspaceProject,
  section,
  onClose,
}: SettingsProps) {
  // "Keyboard shortcuts" opens straight onto its table — it's the last
  // section, buried below the fold at any window size. Workspaces likewise,
  // and "New workspace…" from the switcher lands in the name box.
  const shortcutsRef = useRef<HTMLHeadingElement>(null);
  const workspacesRef = useRef<HTMLHeadingElement>(null);
  const newWorkspaceRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (section === "shortcuts") shortcutsRef.current?.scrollIntoView();
    if (section === "workspaces") workspacesRef.current?.scrollIntoView();
    if (section === "new-workspace") {
      workspacesRef.current?.scrollIntoView();
      newWorkspaceRef.current?.focus();
    }
  }, [section]);
  const [newWorkspace, setNewWorkspace] = useState("");
  const workspaceNames = Object.keys(workspaces);
  const addWorkspace = () => {
    const n = newWorkspace.trim();
    if (nameProblem(n, workspaceNames)) return;
    onAddWorkspace(n);
    setNewWorkspace("");
  };

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
                  How opening a file on the project map that isn’t a note works. Markdown always
                  opens in the app; images always open in the system viewer.
                </p>
              </td>
            </tr>
          </tbody>
        </table>
        <h2>Where new notes go</h2>
        <p className="settings-note">
          A folder inside the notes folder, such as inbox or work/meetings; empty means the notes
          folder itself. A new folder at the top level becomes a project. AI tools that create notes
          through asapnotes file them here too.
        </p>
        <table>
          <tbody>
            <DestinationRows
              destinations={routing.destinations ?? {}}
              base="Notes folder"
              withCapture
              onChange={onSetDestinations}
            />
          </tbody>
        </table>
        {projects.length > 0 && (
          <>
            <h2>Project folders</h2>
            <p className="settings-note">
              Inside a project, a kind of note can go to a subfolder of it. Code folders are where
              the project’s work happens, such as its repository: an AI session working in one is
              reminded these notes exist, once the asapnotes plugin for it is installed.
            </p>
            {projects.map(({ name }) => (
              <div key={name}>
                <ProjectFolders
                  name={name}
                  project={routing.projects[name]}
                  onChange={(d, code) => onSetProjectFolders(name, d, code)}
                />
              </div>
            ))}
          </>
        )}
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
        <h2 ref={workspacesRef}>Workspaces</h2>
        <p className="settings-note">
          A workspace is a set of projects; the switcher in the title bar shows one at a time.
          Default is every project. A project can be in any number of workspaces, and nothing moves
          on disk.
        </p>
        <table>
          <tbody>
            {workspaceNames.map((name) => (
              <tr key={name}>
                <td>
                  <WorkspaceName
                    value={name}
                    taken={workspaceNames.filter((n) => n !== name)}
                    onCommit={(to) => onRenameWorkspace(name, to)}
                  />
                </td>
                <td>
                  <div className="ws-members">
                    {projects.map((p) => {
                      const on = workspaces[name].includes(p.name);
                      return (
                        <label key={p.name} className={on ? "ws-project on" : "ws-project"}>
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={(e) =>
                              onToggleWorkspaceProject(name, p.name, e.target.checked)
                            }
                          />
                          {on && <Icon name="check" />}
                          {p.name}
                        </label>
                      );
                    })}
                    {projects.length === 0 && <span className="muted">No projects yet</span>}
                    <button
                      className="settings-remove"
                      aria-label={`Remove workspace ${name}`}
                      data-tip="Remove — the projects stay where they are"
                      onClick={() => onRemoveWorkspace(name)}
                    >
                      <Icon name="x" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            <tr>
              <td>
                <input
                  ref={newWorkspaceRef}
                  className="ws-name ws-new"
                  value={newWorkspace}
                  placeholder="New workspace"
                  spellCheck={false}
                  aria-label="New workspace name"
                  onChange={(e) => setNewWorkspace(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addWorkspace();
                  }}
                />
              </td>
              <td>
                <button
                  className="tool-btn"
                  disabled={nameProblem(newWorkspace, workspaceNames) !== null}
                  data-tip={nameProblem(newWorkspace, workspaceNames) ?? undefined}
                  onClick={addWorkspace}
                >
                  Add
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <TranscriptionSection />
        <McpSection />
        <h2 ref={shortcutsRef}>Keyboard shortcuts</h2>
        <p className="settings-note">
          Click a shortcut to change it; the reset arrow beside a changed one puts the default back.
        </p>
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
