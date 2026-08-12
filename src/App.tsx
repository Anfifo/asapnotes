import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { convertFileSrc } from "@tauri-apps/api/core";
import { confirm as confirmDialog, open as openFolderDialog } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { CloseConfirm } from "./CloseConfirm";
import { ContextMenu, ContextMenuState } from "./ContextMenu";
import Editor, { EditorHandle, EditorStatus, FormatKind } from "./Editor";
import { Explorer } from "./Explorer";
import { MenuBar, MenuDef, MenuEntry } from "./MenuBar";
import { NewProject } from "./NewProject";
import { fileOf, projectOf, relativePath, resolvePath, validFileName, winPath } from "./paths";
import { featuresOf, hasFeature, isNoteFile, noteTypeOf, setNoteTypes, viewOf } from "./noteTypes";
import { Preview } from "./Preview";
import { Palette, PaletteItem } from "./Palette";
import { ScanProjects } from "./ScanProjects";
import { SearchView } from "./Search";
import { Settings } from "./Settings";
import { getTheme, setTheme, type Theme } from "./theme";
import { StatusBar } from "./StatusBar";
import { ToastStack } from "./Toast";
import { Tooltip } from "./Tooltip";
import { errText, useToasts } from "./toasts";
import * as api from "./notes";
import "./App.css";

interface OpenNote {
  /** Root-relative draft path; equals `name` once the note has been saved. */
  id: string;
  /** Saved note path, null while untitled. */
  name: string | null;
}

const AUTOSAVE_MS = 500;
const IMAGE_FILE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

const EXPLORER_DEFAULT_W = 224;
const EXPLORER_MIN_W = 168;
// Editor space a docked explorer must leave — the drag stops there, and only a
// window shrinking past it auto-collapses the panel.
const EDITOR_MIN_W = 280;

const clampZoom = (z: number) => Math.min(3, Math.max(0.5, Math.round(z * 10) / 10));

/** A stored (or hand-edited) explorer width, held to what this window can show.
 * The resize drag has its own limits — this is the boot/settings clamp. */
const clampExplorerWidth = (w: number) =>
  Math.min(Math.max(EXPLORER_MIN_W, w), Math.max(EXPLORER_MIN_W, window.innerWidth - EDITOR_MIN_W));

// Stroke icons (Lucide-style paths) for the symbolic buttons — text glyphs
// like ``` and ❝ read poorly at toolbar size, and emoji render in color that
// ignores the theme. Letters (H1–H3, B, I) stay letters.
const icon = (paths: ReactNode) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {paths}
  </svg>
);

const FORMAT_GROUPS: { kind: FormatKind; glyph: ReactNode; title: string }[][] = [
  [
    { kind: "h1", glyph: "H1", title: "Heading 1 (Ctrl+1)" },
    { kind: "h2", glyph: "H2", title: "Heading 2 (Ctrl+2)" },
    { kind: "h3", glyph: "H3", title: "Heading 3 (Ctrl+3)" },
  ],
  [
    { kind: "bold", glyph: "B", title: "Bold (Ctrl+B)" },
    { kind: "italic", glyph: "I", title: "Italic (Ctrl+I)" },
  ],
  [
    {
      kind: "code",
      glyph: icon(
        <>
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </>,
      ),
      title: "Inline code (Ctrl+Shift+C)",
    },
    {
      kind: "codeblock",
      glyph: icon(
        <>
          <path d="m10 9-3 3 3 3" />
          <path d="m14 15 3-3-3-3" />
          <rect x="3" y="3" width="18" height="18" rx="2" />
        </>,
      ),
      title: "Code block",
    },
  ],
  [
    {
      kind: "bullet",
      glyph: icon(
        <>
          <line x1="9" y1="6" x2="21" y2="6" />
          <line x1="9" y1="12" x2="21" y2="12" />
          <line x1="9" y1="18" x2="21" y2="18" />
          <circle cx="4" cy="6" r="1" fill="currentColor" stroke="none" />
          <circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" />
          <circle cx="4" cy="18" r="1" fill="currentColor" stroke="none" />
        </>,
      ),
      title: "Bullet list (Ctrl+Shift+8)",
    },
    {
      kind: "numbered",
      glyph: icon(
        <>
          <line x1="10" y1="6" x2="21" y2="6" />
          <line x1="10" y1="12" x2="21" y2="12" />
          <line x1="10" y1="18" x2="21" y2="18" />
          <path d="M4 6h1v4" />
          <path d="M4 10h2" />
          <path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
        </>,
      ),
      title: "Numbered list (Ctrl+Shift+7)",
    },
    {
      kind: "quote",
      glyph: icon(
        <>
          <path d="M17 6H3" />
          <path d="M21 12H8" />
          <path d="M21 18H8" />
          <path d="M3 12v6" />
        </>,
      ),
      title: "Quote (Ctrl+Shift+9)",
    },
  ],
  [
    {
      kind: "link",
      glyph: icon(
        <>
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.72" />
        </>,
      ),
      title: "Link (Ctrl+Shift+L)",
    },
  ],
];

interface NoteEntry extends PaletteItem {
  kind: "note";
  /** false = untitled draft that has no saved note yet */
  isNote: boolean;
}

interface CommandEntry extends PaletteItem {
  kind: "command";
  run: () => void;
}

type Entry = NoteEntry | CommandEntry;

/** The name a draft id carries: null only for app-generated `untitled-<ts>` ids.
 * A named draft keeps its name even when the backing file is gone (deleted
 * externally) — the titlebar stays honest and Ctrl+S recreates the file. */
const draftName = (id: string) => (/^untitled-\d+\.md$/.test(fileOf(id)) ? null : id);

/** File name for an untitled note, derived from its first non-empty line. */
function deriveName(doc: string, prefix: string, taken: Set<string>): string {
  const firstLine = doc.split("\n").find((l) => l.trim().length > 0) ?? "";
  const cleaned = firstLine
    .replace(/^[#>\-*\s]+/, "")
    .replace(/[<>:"/\\|?*]/g, "")
    .trim()
    .slice(0, 60)
    .trim();
  const base = cleaned.length > 0 ? cleaned : "untitled";
  let name = `${prefix}${base}.md`;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${prefix}${base} ${n}.md`;
  return name;
}

function App() {
  const { toasts, toast, dismiss } = useToasts();
  const [notes, setNotes] = useState<api.FileInfo[]>([]);
  const [drafts, setDrafts] = useState<api.FileInfo[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  // Projects carrying a location of their own: name → absolute folder, linked
  // in place. Mirrors the entries of settings.json that have a path; the rest
  // live at `<notes root>/<name>`, which is the only difference between them.
  const [projectPaths, setProjectPaths] = useState<Record<string, string>>({});
  // Folders attached into projects. Kept beside the locations above because
  // together they are the table every path in this file resolves through.
  const [mounts, setMounts] = useState<api.MountInfo[]>([]);
  const [scanResults, setScanResults] = useState<api.ProjectCandidate[] | null>(null);
  const [rootPath, setRootPath] = useState("");
  const [open, setOpen] = useState<OpenNote | null>(null);
  // Open tabs, restored across restarts (ids only — content loads on activation
  // so summon latency is untouched). The active tab is the one matching `open`.
  const [tabs, setTabs] = useState<OpenNote[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("tabs") ?? "[]") as OpenNote[];
      return Array.isArray(stored) ? stored.filter((t) => t && typeof t.id === "string") : [];
    } catch {
      return [];
    }
  });
  const [docKey, setDocKey] = useState("");
  const [initialDoc, setInitialDoc] = useState("");
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [paletteOpen, setPaletteOpen] = useState<"notes" | "commands" | null>(null);
  // Pinned = docked beside the editor; survives restarts (default on). Unpinned
  // the panel floats over the editor and closes on select / Esc / click-away.
  const [explorerPinned, setExplorerPinnedState] = useState(
    () => localStorage.getItem("explorerPinned") !== "0",
  );
  const [explorerOpen, setExplorerOpen] = useState(explorerPinned);
  // The explorer panel hosts two views; search is deliberately not persisted —
  // reopening the app should land on the file tree, not a stale query.
  const [explorerView, setExplorerView] = useState<"files" | "search">("files");
  // Bumped on every Ctrl+Shift+F so a repeat press refocuses and selects the
  // query box even when the search view is already showing.
  const [searchFocus, setSearchFocus] = useState(0);
  const [explorerWidth, setExplorerWidth] = useState(() => {
    const saved = Number(localStorage.getItem("explorerWidth"));
    return saved > 0 ? clampExplorerWidth(saved) : EXPLORER_DEFAULT_W;
  });
  // A pinned explorer docks while it leaves the editor a usable strip; a window
  // squeezed past that collapses it to the rail, and reopening floats it.
  const [winWidth, setWinWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWinWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const dockLimit = winWidth - EDITOR_MIN_W;
  const explorerNarrow = explorerWidth > dockLimit;
  const explorerDocked = explorerPinned && !explorerNarrow;
  // Squeezed past the limit, an open docked panel collapses to the rail — and
  // since that wasn't the user's choice, it's remembered and undone once the
  // window widens back. Keyed to the size signal (not `explorerDocked`) so
  // unpinning never reads as a squeeze, and guarded on transitions so re-runs
  // from the other deps can't fire either branch.
  const autoCollapsedRef = useRef(false);
  const prevNarrowRef = useRef(explorerNarrow);
  useEffect(() => {
    const wasNarrow = prevNarrowRef.current;
    prevNarrowRef.current = explorerNarrow;
    if (!wasNarrow && explorerNarrow && explorerPinned && explorerOpen) {
      autoCollapsedRef.current = true;
      setExplorerOpen(false);
    } else if (wasNarrow && !explorerNarrow && autoCollapsedRef.current) {
      autoCollapsedRef.current = false;
      setExplorerOpen(true);
    }
  }, [explorerNarrow, explorerPinned, explorerOpen]);
  const [creatingProject, setCreatingProject] = useState(false);
  // Explorer-driven creation is name-first: the target dir ("" = notes root)
  // gets an inline input row in the tree, Enter creates the file — or, with
  // kind "folder", a real directory.
  const [explorerCreate, setExplorerCreate] = useState<string | null>(null);
  const [explorerCreateKind, setExplorerCreateKind] = useState<"note" | "folder" | "virtual">(
    "note",
  );
  // Folders created this session that hold no note yet: the explorer tree
  // derives from note files, so these are remembered to stay visible.
  const [newFolders, setNewFolders] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [summonMs, setSummonMs] = useState<number | null>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [zoom, setZoomState] = useState(() => {
    const saved = Number(localStorage.getItem("zoom"));
    return saved > 0 ? clampZoom(saved) : 1;
  });
  const [theme, setThemeState] = useState<Theme>(getTheme);
  // Tab held at the close confirm (Save / Discard / Cancel), null when none.
  const [closeAsk, setCloseAsk] = useState<string | null>(null);

  const editorRef = useRef<EditorHandle>(null);
  const contentRef = useRef("");
  const openRef = useRef<OpenNote | null>(null);
  openRef.current = open;
  const tabsRef = useRef<OpenNote[]>([]);
  tabsRef.current = tabs;
  const notesRef = useRef<api.FileInfo[]>([]);
  notesRef.current = notes;
  const draftsRef = useRef<api.FileInfo[]>([]);
  draftsRef.current = drafts;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const projectPathsRef = useRef<Record<string, string>>({});
  projectPathsRef.current = projectPaths;
  // Resolution reads live mounts only, longest mount point first — the same
  // order `mount_of` takes in notes.rs, and a conflicted mount is inert there
  // too, because the real folder of that name wins.
  const mountsRef = useRef<api.MountInfo[]>([]);
  mountsRef.current = mounts.filter((m) => !m.conflicted).sort((a, b) => b.at.length - a.at.length);
  const rootPathRef = useRef("");
  rootPathRef.current = rootPath;
  const noteDirRef = useRef("");
  const autosaveTimer = useRef<number | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  // Disk mtime of the open note when its content was loaded (null while
  // untitled/unknown) — the reference point for external-change detection.
  const openMtimeRef = useRef<number | null>(null);

  /** Remember the open note's on-disk mtime; a stale async result (another
   * track started meanwhile) is dropped via the token. */
  const mtimeTokenRef = useRef(0);
  const trackMtime = useCallback((name: string | null) => {
    const token = ++mtimeTokenRef.current;
    openMtimeRef.current = null;
    if (!name) return;
    void api
      .noteMtime(name)
      .then((m) => {
        if (mtimeTokenRef.current === token) openMtimeRef.current = m;
      })
      .catch(() => {});
  }, []);

  // Appearance lives in settings.json; localStorage stays its boot mirror,
  // because theme and zoom are read before the first paint and summon latency
  // outranks config purity. False until the file has been read, so the values
  // that mirror produced are never written back over it.
  const appearanceSyncedRef = useRef(false);
  // Last reported settings-file problem, so a broken file doesn't toast on
  // every focus — only when the message changes.
  const settingsErrorRef = useRef<string | null>(null);
  // Same rule for the per-project `.asapnotes.json` files: toast a parse
  // problem once, not on every focus it persists through.
  const configErrorsRef = useRef<string[]>([]);
  const appearanceRef = useRef<api.Appearance>({});
  appearanceRef.current = {
    theme,
    zoom,
    explorer: { width: explorerWidth, pinned: explorerPinned },
  };

  /** Write appearance to settings.json. `patch` carries the value the caller
   * just changed — its state hasn't landed in `appearanceRef` yet. */
  const persistAppearance = useCallback(
    (patch: api.Appearance) => {
      if (!appearanceSyncedRef.current) return;
      void api
        .setAppearance({ ...appearanceRef.current, ...patch })
        .catch((err: unknown) => toast(`Couldn't save that setting — ${errText(err)}`));
    },
    [toast],
  );

  /** Zoom the webview and mirror the factor for the next boot. */
  const applyZoom = useCallback((z: number) => {
    const next = clampZoom(z);
    setZoomState(next);
    localStorage.setItem("zoom", String(next));
    void getCurrentWebview().setZoom(next);
    return next;
  }, []);

  const setZoom = useCallback(
    (z: number) => persistAppearance({ zoom: applyZoom(z) }),
    [applyZoom, persistAppearance],
  );

  const setExplorerPinned = (pinned: boolean) => {
    setExplorerPinnedState(pinned);
    localStorage.setItem("explorerPinned", pinned ? "1" : "0");
    persistAppearance({ explorer: { width: explorerWidth, pinned } });
  };

  // Editor status flows straight to the StatusBar through this ref — routing
  // it through App state would re-render the whole tree on every keystroke.
  const statusCb = useRef<((s: EditorStatus) => void) | null>(null);
  const registerStatus = useCallback((cb: ((s: EditorStatus) => void) | null) => {
    statusCb.current = cb;
  }, []);
  const handleStatus = useCallback((s: EditorStatus) => statusCb.current?.(s), []);

  const upsertDraft = (id: string) =>
    setDrafts((d) => [{ name: id, modified_ms: Date.now() }, ...d.filter((x) => x.name !== id)]);

  const cancelAutosave = () => {
    if (autosaveTimer.current !== null) {
      window.clearTimeout(autosaveTimer.current);
      autosaveTimer.current = null;
      return true;
    }
    return false;
  };

  /** Write a pending (debounced) draft immediately — called before switching away. */
  const flushDraft = useCallback(async () => {
    if (!cancelAutosave()) return;
    const cur = openRef.current;
    if (cur) {
      await api.writeDraft(cur.id, contentRef.current);
      upsertDraft(cur.id);
    }
  }, []);

  const hideWindow = useCallback(() => {
    void flushDraft();
    void getCurrentWindow().hide();
  }, [flushDraft]);

  const handleChange = useCallback((doc: string) => {
    contentRef.current = doc;
    setDirty(true);
    cancelAutosave();
    autosaveTimer.current = window.setTimeout(() => {
      autosaveTimer.current = null;
      const cur = openRef.current;
      if (cur) {
        void api.writeDraft(cur.id, doc);
        upsertDraft(cur.id);
      }
    }, AUTOSAVE_MS);
  }, []);

  const showDoc = useCallback(
    (note: OpenNote, content: string, isDirty: boolean) => {
      contentRef.current = content;
      setOpen(note);
      setTabs((ts) =>
        ts.some((t) => t.id === note.id)
          ? ts.map((t) => (t.id === note.id ? note : t))
          : [...ts, note],
      );
      setInitialDoc(content);
      setDocKey(note.id);
      setDirty(isDirty);
      setMode("edit");
      setPaletteOpen(null);
      trackMtime(note.name);
    },
    [trackMtime],
  );

  /** Point the open note (and its tab) at a new identity — save/rename/move. */
  const retagOpen = useCallback((oldId: string, note: OpenNote) => {
    setOpen(note);
    setTabs((ts) => ts.map((t) => (t.id === oldId ? note : t)));
  }, []);

  const newNote = useCallback(
    async (project?: string | null) => {
      await flushDraft();
      const prefix = project ? `${project}/` : "";
      showDoc({ id: `${prefix}untitled-${Date.now()}.md`, name: null }, "", false);
    },
    [flushDraft, showDoc],
  );

  const openItem = useCallback(
    async (item: { id: string; isNote: boolean }, draftIds: Set<string>) => {
      await flushDraft();
      const hasDraft = draftIds.has(item.id);
      // No draft and no saved file (an untouched untitled tab) — nothing on disk to read.
      const content = hasDraft
        ? await api.readDraft(item.id)
        : item.isNote
          ? await api.readNote(item.id)
          : "";
      showDoc({ id: item.id, name: item.isNote ? item.id : draftName(item.id) }, content, hasDraft);
      editorRef.current?.focus();
    },
    [flushDraft, showDoc],
  );

  /** Location of a project: its registered folder, else a notes-root subfolder. */
  const projectDirOf = useCallback(
    (project: string | null) =>
      project
        ? (projectPathsRef.current[project] ?? `${rootPathRef.current}/${project}`)
        : rootPathRef.current,
    [],
  );

  /** The mount owning a project-relative path, longest mount point first. */
  const mountFor = useCallback(
    (project: string, rel: string) =>
      mountsRef.current.find(
        (m) => m.project === project && (rel === m.at || rel.startsWith(`${m.at}/`)),
      ) ?? null,
    [],
  );

  /** Base directory of a note id, and what is left of the id below it — the
   * frontend half of the backend's `base_of` in notes.rs. The paths below and
   * `noteIdOf` all read this one table, in this one order, because a forward
   * and an inverse that disagree give a file two ids, and two ids mean two
   * shadow drafts and two tabs that overwrite each other. */
  const baseOf = useCallback(
    (id: string): { dir: string; rest: string } => {
      const [project, ...tail] = id.split("/");
      // A single segment is a note in the notes root, whatever else claims that
      // name as a project — the backend resolves it the same way.
      if (tail.length === 0) return { dir: rootPathRef.current, rest: id };
      const rel = tail.join("/");
      const mount = mountFor(project, rel);
      if (mount) return { dir: mount.path, rest: rel.slice(mount.at.length + 1) };
      return { dir: projectDirOf(project), rest: rel };
    },
    [mountFor, projectDirOf],
  );

  /** Directory holding a note id (forward slashes). */
  const noteDirOf = useCallback(
    (id: string) => {
      const { dir, rest } = baseOf(id);
      const sub = rest.split("/").slice(0, -1).join("/");
      return sub ? `${dir}/${sub}` : dir;
    },
    [baseOf],
  );

  /** Absolute filesystem path of a note id (Windows separators). */
  const absPathOf = useCallback(
    (id: string) => winPath(`${noteDirOf(id)}/${fileOf(id)}`),
    [noteDirOf],
  );

  /** Absolute path of a folder id ("" = notes root, else project[/sub…]).
   * A folder id names a directory, so its first segment is always a project —
   * unlike a note id, where one segment is a note in the notes root. */
  const absDirOf = useCallback(
    (dir: string) => {
      if (!dir) return winPath(rootPathRef.current);
      const [project, ...tail] = dir.split("/");
      const rel = tail.join("/");
      const mount = mountFor(project, rel);
      if (mount) return winPath(`${mount.path}${rel.slice(mount.at.length)}`);
      return winPath([projectDirOf(project), ...tail].join("/"));
    },
    [mountFor, projectDirOf],
  );

  /** Note id for an absolute path inside the notes root, a registered project
   * or a mount, null when the path lives outside all of them. The inverse of
   * the backend's resolution, and it has to agree with it: bases are tried
   * longest-first, so a folder sitting inside another can't give one file two
   * ids. */
  const noteIdOf = useCallback((abs: string): string | null => {
    const relTo = (base: string) => {
      const rel = base ? relativePath(base, abs) : null;
      return rel && !rel.startsWith("../") ? rel : null;
    };
    const inRoot = relTo(rootPathRef.current);
    // Directly in the root: the loose id, matching the backend, which resolves
    // a single-segment id against the root whatever else claims that folder.
    if (inRoot && !projectOf(inRoot)) return inRoot;
    const bases: [string, string][] = [
      ...Object.entries(projectPathsRef.current).map(
        ([name, dir]) => [`${name}/`, dir] as [string, string],
      ),
      ...mountsRef.current.map((m) => [`${m.project}/${m.at}/`, m.path] as [string, string]),
    ].sort(([, a], [, b]) => b.length - a.length);
    for (const [prefix, dir] of bases) {
      const rel = relTo(dir);
      if (rel) return `${prefix}${rel}`;
    }
    return inRoot;
  }, []);

  /** Follow a Ctrl+Clicked editor target: URLs → browser; paths resolving to
   * a note → open in-app; other paths → OS default (relative ones resolve
   * against the open note's directory, like images do). */
  const openLink = useCallback(
    (target: string) => {
      void (async () => {
        try {
          if (/^(https?:\/\/|mailto:)/i.test(target)) {
            await api.openExternal(target);
            return;
          }
          const abs = /^[a-z]:[\\/]/i.test(target)
            ? target.replace(/\\/g, "/")
            : resolvePath(noteDirRef.current, target);
          const id = noteIdOf(abs);
          if (id && isNoteFile(id)) {
            await openItem({ id, isNote: true }, new Set(draftsRef.current.map((d) => d.name)));
          } else {
            await api.openExternal(winPath(abs));
          }
        } catch (err) {
          console.error("open link failed:", err);
        }
      })();
    },
    [noteIdOf, openItem],
  );

  const openSearchView = useCallback(() => {
    setExplorerOpen(true);
    setExplorerView("search");
    setSearchFocus((n) => n + 1);
  }, []);

  /** Line to jump to once the note a search hit belongs to has loaded. */
  const pendingLine = useRef<number | null>(null);

  // The editor is rebuilt when docKey changes and child effects run before
  // parent ones, so the new view exists by the time this fires. Line numbers
  // come from the file on disk — a note with an unsaved draft opens from the
  // draft, so the jump can land a few lines off until it's saved.
  useEffect(() => {
    const line = pendingLine.current;
    if (line === null) return;
    pendingLine.current = null;
    editorRef.current?.revealLine(line);
  }, [docKey]);

  const save = useCallback(
    async (asName?: string) => {
      const cur = openRef.current;
      if (!cur) return null;
      cancelAutosave();
      const doc = contentRef.current;
      if (!cur.name && !asName && doc.trim() === "") return null;
      let name = cur.name ?? asName ?? null;
      if (!name) {
        const project = projectOf(cur.id);
        const taken = new Set(notesRef.current.map((n) => n.name.toLowerCase()));
        name = deriveName(doc, project ? `${project}/` : "", taken);
      }
      // External-change guard: the file is shared with other tools by design —
      // if it changed on disk since this buffer loaded, never overwrite silently.
      if (cur.name && openMtimeRef.current !== null) {
        const now = await api.noteMtime(cur.name).catch(() => null);
        if (now !== null && now !== openMtimeRef.current) {
          const ok = await confirmDialog(
            `"${fileOf(cur.name)}" changed on disk since you opened it. Overwrite those changes?`,
            { title: "Note changed on disk", kind: "warning" },
          );
          if (!ok) return null;
        }
      }
      await api.saveNote(name, doc);
      mtimeTokenRef.current++; // invalidate any in-flight track
      openMtimeRef.current = (await api.noteMtime(name).catch(() => null)) ?? null;
      await api.deleteDraft(cur.id);
      setDrafts((d) => d.filter((x) => x.name !== cur.id));
      retagOpen(cur.id, { id: name, name });
      setDirty(false);
      setNotes(await api.listNotes());
      // The id the note now lives under — callers that close after saving
      // need it, since an untitled tab changed identity on the way.
      return name;
    },
    [retagOpen],
  );

  /** Move the open note (or retarget the open untitled draft) to a project. */
  const changeProject = useCallback(
    async (target: string | null) => {
      const cur = openRef.current;
      if (!cur || target === projectOf(cur.id)) return;
      const newId = (target ? `${target}/` : "") + fileOf(cur.id);
      if (cur.name) {
        try {
          await api.moveNote(cur.name, newId);
        } catch (err) {
          toast(`Couldn't move that note — ${errText(err)}`);
          return;
        }
        retagOpen(cur.id, { id: newId, name: newId });
        trackMtime(newId);
        setNotes(await api.listNotes());
        setDrafts(await api.listDrafts());
      } else {
        cancelAutosave();
        await api.deleteDraft(cur.id);
        retagOpen(cur.id, { id: newId, name: null });
        if (contentRef.current.trim() !== "") await api.writeDraft(newId, contentRef.current);
        setDrafts(await api.listDrafts());
      }
      if (target) setProjects((ps) => (ps.includes(target) ? ps : [...ps, target].sort()));
      editorRef.current?.focus();
    },
    [retagOpen, trackMtime, toast],
  );

  const togglePreview = useCallback(() => {
    if (!openRef.current || !hasFeature(openRef.current.id, "preview")) return;
    if (modeRef.current === "edit") {
      setInitialDoc(contentRef.current);
      setMode("preview");
    } else {
      setMode("edit");
    }
  }, []);

  /** Resolve a relative image src against the open note's directory (for live preview). */
  const resolveImage = useCallback(
    (src: string) =>
      /^[a-z][a-z0-9+.-]*:/i.test(src) ? src : convertFileSrc(resolvePath(noteDirRef.current, src)),
    [],
  );

  /** Note-relative link to a saved asset path (`assets/x.png`). A folder
   * outside the notes root — a linked project's, or a mount's — keeps its own
   * `assets/`, so the link starts from wherever the note actually resolved;
   * everything under the root shares the root's. Same rule as
   * `assets_dir_for` in notes.rs, which is what chose the folder. */
  const assetLink = useCallback(
    (rel: string) => {
      const cur = openRef.current;
      if (!cur) return rel;
      const root = rootPathRef.current;
      const { dir } = baseOf(cur.id);
      const below = relativePath(root, dir);
      const owner = below !== null && !below.startsWith("../") ? root : dir;
      return relativePath(noteDirOf(cur.id), `${owner}/${rel}`) ?? rel;
    },
    [baseOf, noteDirOf],
  );

  /** Markdown link for an `@`-mentioned note: relative to the open note's
   * directory, falling back to the app's root-relative id when no relative
   * path exists (target on another drive). */
  const mentionLink = useCallback(
    (id: string) => {
      const label = fileOf(id).replace(/\.md$/, "");
      const target = relativePath(noteDirRef.current, `${noteDirOf(id)}/${fileOf(id)}`) ?? id;
      // CommonMark: destinations with spaces (or parens) need <> wrapping.
      return /[\s()]/.test(target) ? `[${label}](<${target}>)` : `[${label}](${target})`;
    },
    [noteDirOf],
  );

  /** Persist a pasted image and hand back the note-relative link path. */
  const pasteImage = useCallback(
    async (file: File): Promise<string | null> => {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let ext = file.type.split("/")[1] ?? "png";
        if (ext === "jpeg") ext = "jpg";
        if (ext === "svg+xml") ext = "svg";
        const cur = openRef.current;
        const rel = await api.saveAsset(bytes, ext, cur?.id ?? null);
        return assetLink(rel);
      } catch (err) {
        toast(`Couldn't save the pasted image — ${errText(err)}`);
        return null;
      }
    },
    [assetLink, toast],
  );

  /** Adopt a settings document: the note-type registry, project locations, and
   * appearance — the file is the source of truth, so it wins over the boot
   * mirror the first paint read. */
  const applySettings = useCallback(
    ({ settings, error }: api.SettingsRead) => {
      if (error && error !== settingsErrorRef.current) toast(error);
      settingsErrorRef.current = error;
      setNoteTypes(settings.noteTypes);
      setProjectPaths(
        Object.fromEntries(
          Object.entries(settings.projects).flatMap(([name, p]) =>
            p.path ? [[name, p.path]] : [],
          ),
        ),
      );
      const { theme: saved, zoom: savedZoom, explorer } = settings.appearance;
      if ((saved === "light" || saved === "dark" || saved === "system") && saved !== getTheme()) {
        setTheme(saved);
        setThemeState(saved);
      }
      if (typeof savedZoom === "number" && clampZoom(savedZoom) !== zoomRef.current) {
        applyZoom(savedZoom);
      }
      if (typeof explorer?.width === "number") {
        const width = clampExplorerWidth(explorer.width);
        setExplorerWidth(width);
        localStorage.setItem("explorerWidth", String(width)); // mirror only
      }
      if (typeof explorer?.pinned === "boolean") {
        setExplorerPinnedState(explorer.pinned);
        localStorage.setItem("explorerPinned", explorer.pinned ? "1" : "0"); // mirror only
      }
      // From here on an appearance change is the user's, and gets written back.
      appearanceSyncedRef.current = true;
    },
    [applyZoom, toast],
  );

  // Startup: recover the most recent draft; else open the most recent note;
  // else start on a blank capture.
  useEffect(() => {
    void (async () => {
      const [ns, ds, ps, ms, cfg, root] = await Promise.all([
        api.listNotes(false),
        api.listDrafts(),
        api.listProjects(),
        api.listMounts(),
        api.getSettings(),
        api.notesRootPath(),
      ]);
      setNotes(ns);
      setDrafts(ds);
      setProjects(ps);
      setMounts(ms);
      applySettings(cfg);
      setRootPath(root);
      // Projects living outside the notes root can be big — walk them after
      // the first paint.
      void api.listNotes().then(setNotes);
      // Restored tabs win: reopen the last active one (content loads here, the
      // rest stay lazy). A tab whose note vanished is dropped and we fall back.
      const restored = tabsRef.current;
      if (restored.length > 0) {
        const activeId = localStorage.getItem("activeTab");
        const target = restored.find((t) => t.id === activeId) ?? restored[0];
        try {
          const hasDraft = ds.some((d) => d.name === target.id);
          const content = hasDraft ? await api.readDraft(target.id) : await api.readNote(target.id);
          showDoc(
            { id: target.id, name: hasDraft ? draftName(target.id) : target.id },
            content,
            hasDraft,
          );
          return;
        } catch {
          setTabs((ts) => ts.filter((t) => t.id !== target.id));
        }
      }
      if (ds.length > 0) {
        const draft = ds[0];
        const content = await api.readDraft(draft.name);
        showDoc({ id: draft.name, name: draftName(draft.name) }, content, true);
      } else if (ns.length > 0) {
        const content = await api.readNote(ns[0].name);
        showDoc({ id: ns[0].name, name: ns[0].name }, content, false);
      } else {
        showDoc({ id: `untitled-${Date.now()}.md`, name: null }, "", false);
      }
    })();
  }, [showDoc, applySettings]);

  // Tabs (and which one is active) survive restarts.
  useEffect(() => {
    localStorage.setItem("tabs", JSON.stringify(tabs));
  }, [tabs]);
  useEffect(() => {
    if (open) localStorage.setItem("activeTab", open.id);
  }, [open]);

  // Tabs shrink to fit rather than scroll; when even minimum widths overflow,
  // the strip pans with a hidden scrollbar — keep the active tab revealed.
  const tabbarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    tabbarRef.current
      ?.querySelector(".tab.active")
      ?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [open]);

  // Dropped image files are intercepted by Tauri (we get paths, not File
  // objects): copy them into assets/ and insert the link at the cursor. Only
  // for a note whose type takes images — an image link in a .log is noise.
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent(async (event) => {
      if (event.payload.type !== "drop" || modeRef.current !== "edit") return;
      const cur = openRef.current;
      if (!cur || !hasFeature(cur.id, "images")) return;
      for (const path of event.payload.paths) {
        if (!IMAGE_FILE.test(path)) continue;
        try {
          const rel = await api.importAsset(path, cur.id);
          editorRef.current?.insertText(`![](${assetLink(rel)})\n`);
        } catch (err) {
          toast(`Couldn't import that image — ${errText(err)}`);
        }
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [assetLink, toast]);

  // File → Scan folder for projects: pick a folder, find README-marked
  // subfolders, confirm in a sheet, link them in place as external projects.
  const refreshProjects = useCallback(async () => {
    const [ns, ps, ms, cfg] = await Promise.all([
      api.listNotes(),
      api.listProjects(),
      api.listMounts(),
      api.getSettings(),
    ]);
    setNotes(ns);
    setProjects(ps);
    setMounts(ms);
    applySettings(cfg);
  }, [applySettings]);

  const scanForProjects = useCallback(async () => {
    const dir = await openFolderDialog({ directory: true, title: "Scan a folder for projects" });
    if (typeof dir !== "string") return;
    try {
      setScanResults(await api.scanProjects(dir));
    } catch (err) {
      toast(`Couldn't scan that folder — ${errText(err)}`);
    }
  }, [toast]);

  const addScannedProjects = useCallback(
    async (chosen: { name: string; path: string }[]) => {
      // Scanned repos root at their docs folder — notes, not the whole tree.
      await api.linkProjects(chosen.map((c) => ({ ...c, useDocs: true })));
      setScanResults(null);
      await refreshProjects();
    },
    [refreshProjects],
  );

  /** Create a project wherever the sheet says it lives. Deliberately does not
   * touch the open note — filing one into a project is "Move to project". */
  const createProject = useCallback(
    async (project: api.NewProject) => {
      await api.createProject(project);
      setCreatingProject(false);
      await refreshProjects();
      editorRef.current?.focus();
    },
    [refreshProjects],
  );

  const unlinkProject = useCallback(
    async (name: string) => {
      await api.unlinkProject(name);
      await refreshProjects();
    },
    [refreshProjects],
  );

  /** Settings → Projects: repoint a linked project at a different folder. */
  const changeProjectPath = useCallback(
    async (name: string) => {
      const dir = await openFolderDialog({ directory: true, title: `Folder for ${name}` });
      if (typeof dir !== "string") return;
      try {
        await api.setProjectPath(name, dir);
        await refreshProjects();
      } catch (err) {
        toast(`Couldn't change that project's folder — ${errText(err)}`);
      }
    },
    [refreshProjects, toast],
  );

  // App-level shortcuts. Kept in a ref so the window listener registers once
  // but always sees fresh state.
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandlerRef.current = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === "s") {
      e.preventDefault();
      void save();
    } else if (mod && (key === "n" || key === "t")) {
      e.preventDefault();
      void newNote();
    } else if (mod && key === "w") {
      e.preventDefault();
      if (openRef.current) requestCloseTab(openRef.current.id);
    } else if (e.ctrlKey && e.key === "Tab") {
      e.preventDefault();
      cycleTab(e.shiftKey);
    } else if (mod && key === "k") {
      e.preventDefault();
      setPaletteOpen((o) => (o === "commands" ? null : "commands"));
      if (paletteOpen === "commands") editorRef.current?.focus();
    } else if (mod && key === "p") {
      e.preventDefault();
      setPaletteOpen((o) => (o === "notes" ? null : "notes"));
      if (paletteOpen === "notes") editorRef.current?.focus();
    } else if (mod && e.shiftKey && key === "e") {
      e.preventDefault();
      setExplorerOpen((o) => !o);
    } else if (mod && e.shiftKey && key === "f") {
      e.preventDefault();
      openSearchView();
    } else if (mod && key === "e") {
      e.preventDefault();
      togglePreview();
    } else if (mod && (key === "=" || key === "+")) {
      e.preventDefault();
      setZoom(zoomRef.current + 0.1);
    } else if (mod && key === "-") {
      e.preventDefault();
      setZoom(zoomRef.current - 0.1);
    } else if (mod && key === "0") {
      e.preventDefault();
      setZoom(1);
    } else if (e.key === "Escape") {
      if (document.querySelector(".menu-drop")) {
        // An open menubar dropdown or context menu owns Esc.
      } else if (renaming) {
        setRenaming(false);
        editorRef.current?.focus();
      } else if (scanResults) {
        setScanResults(null);
        editorRef.current?.focus();
      } else if (settingsOpen) {
        setSettingsOpen(false);
        editorRef.current?.focus();
      } else if (creatingProject) {
        setCreatingProject(false);
        editorRef.current?.focus();
      } else if (paletteOpen) {
        setPaletteOpen(null);
        editorRef.current?.focus();
      } else if (explorerOpen && !explorerDocked) {
        // Only when floating — docked, the explorer is furniture and Esc
        // keeps meaning "hide the window".
        setExplorerOpen(false);
        editorRef.current?.focus();
      } else if (!document.querySelector(".editor .cm-panel")) {
        // With the search panel open, Escape falls through to CodeMirror,
        // which closes the panel instead of hiding the window.
        hideWindow();
      }
    }
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => keyHandlerRef.current(e);
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, []);

  // Returning from preview: the editor was hidden, not remounted — refocus it.
  useEffect(() => {
    if (mode === "edit") editorRef.current?.focus();
  }, [mode]);

  // A floating (unpinned) explorer closes on any click outside it; the rail is
  // excluded so its own click can toggle instead of fighting this.
  useEffect(() => {
    if (!explorerOpen || explorerDocked) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element;
      if (!t.closest(".explorer") && !t.closest(".rail")) setExplorerOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [explorerOpen, explorerDocked]);

  // Zoom: persisted factor is re-applied at startup; Ctrl+scroll adjusts it
  // (Ctrl+± / Ctrl+0 live in the app keydown handler).
  useEffect(() => {
    if (zoomRef.current !== 1) void getCurrentWebview().setZoom(zoomRef.current);
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom(zoomRef.current + (e.deltaY < 0 ? 0.1 : -0.1));
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, [setZoom]);

  // External-change detection (files are shared with other tools by design):
  // whenever the window regains focus — a summon included — re-list notes and
  // drafts, and re-sync the open note against its file. The rule: a
  // clean buffer reloads silently (in place, cursor kept); a dirty one keeps
  // editing and the stale mtime makes Ctrl+S raise the overwrite confirm.
  // Settings are re-read on the same signal: hand-editing settings.json while
  // the app runs works, with no watcher and no idle cost.
  useEffect(() => {
    const onFocus = () => {
      void api.listNotes().then(setNotes);
      void api.listDrafts().then(setDrafts);
      // Mounts come back from the backend rather than from the settings
      // document, because whether one is conflicted is a filesystem question.
      void api.listMounts().then(setMounts);
      void api
        .getSettings(true)
        .then(applySettings)
        .catch((err: unknown) => toast(`Couldn't read settings — ${errText(err)}`));
      // A broken .asapnotes.json falls back to default rules in the walks;
      // this is where it becomes visible instead of reading as missing notes.
      void api.projectConfigErrors().then((errs) => {
        for (const e of errs) if (!configErrorsRef.current.includes(e)) toast(e);
        configErrorsRef.current = errs;
      });
      const name = openRef.current?.name;
      if (!name) return;
      void (async () => {
        const mtime = await api.noteMtime(name).catch(() => null);
        if (mtime === null || openRef.current?.name !== name) return;
        if (openMtimeRef.current === null) {
          openMtimeRef.current = mtime; // adopt — no reference point yet
        } else if (mtime !== openMtimeRef.current && !dirtyRef.current) {
          const content = await api.readNote(name);
          if (openRef.current?.name !== name) return;
          contentRef.current = content;
          setInitialDoc(content);
          editorRef.current?.setDoc(content);
          openMtimeRef.current = mtime;
        }
        // Dirty + changed: leave the stale mtime so the save guard fires.
      })();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [applySettings, toast]);

  // `summoned` carries the hotkey-press epoch ms from Rust; the next animation
  // frame approximates when the shown window actually painted.
  useEffect(() => {
    const unlisten = listen<number>("summoned", (event) => {
      editorRef.current?.focus();
      requestAnimationFrame(() => {
        const ms = Date.now() - event.payload;
        setSummonMs(ms);
        console.log(`summon → paint: ${ms}ms`);
      });
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const draftIds = new Set(drafts.map((d) => d.name));
  const noteNames = new Set(notes.map((n) => n.name));
  // `@`-mention candidates: saved notes, minus the one being edited.
  const mentionItems = notes
    .filter((n) => n.name !== open?.name)
    .map((n) => ({ id: n.name, label: n.name.replace(/\.md$/, "") }));
  const noteEntries: NoteEntry[] = [
    ...notes.map((n) => ({
      kind: "note" as const,
      id: n.name,
      label: n.name.replace(/\.md$/, ""),
      detail: draftIds.has(n.name) ? "unsaved edits" : undefined,
      isNote: true,
    })),
    ...drafts
      .filter((d) => !noteNames.has(d.name))
      .map((d) => ({
        kind: "note" as const,
        id: d.name,
        label: d.name.replace(/\.md$/, ""),
        detail: "draft",
        isNote: false,
      })),
  ];

  // Affordances the open note's type declares; with nothing open the chrome
  // shows, since a new note is markdown.
  const canPreview = open ? hasFeature(open.id, "preview") : true;
  const canFormat = open ? hasFeature(open.id, "format") : true;
  // The open note's real directory (for resolving relative image links).
  const currentProject = open ? projectOf(open.id) : null;
  const noteDir = open ? noteDirOf(open.id) : rootPath;
  noteDirRef.current = noteDir;

  const startRename = () => {
    if (!open) return;
    setRenameValue(open.name ? fileOf(open.name).replace(/\.md$/, "") : "");
    setRenaming(true);
  };

  /** Rename the open note; naming an untitled draft saves it under that name. */
  const submitRename = () => {
    setRenaming(false);
    editorRef.current?.focus();
    const cur = openRef.current;
    const base = renameValue.trim();
    if (!cur || !validFileName(base)) return;
    const project = projectOf(cur.id);
    // A typed extension the registry claims is kept (renaming todo.txt keeps
    // .txt); anything else gets the default .md.
    const newId = (project ? `${project}/` : "") + (isNoteFile(base) ? base : `${base}.md`);
    if (newId === cur.name) return;
    if (notesRef.current.some((n) => n.name.toLowerCase() === newId.toLowerCase())) {
      toast(`A note named "${fileOf(newId)}" already exists here`);
      return;
    }
    void (async () => {
      if (cur.name) {
        try {
          await api.moveNote(cur.name, newId);
        } catch (err) {
          toast(`Couldn't rename that note — ${errText(err)}`);
          return;
        }
        retagOpen(cur.id, { id: newId, name: newId });
        trackMtime(newId);
        setNotes(await api.listNotes());
        setDrafts(await api.listDrafts());
      } else {
        await save(newId);
      }
      // A rename that lands on a different note type (x.md → x.txt) must
      // rebuild the editor — its extensions were chosen at mount.
      if (noteTypeOf(cur.id)?.id !== noteTypeOf(newId)?.id) {
        setInitialDoc(contentRef.current);
        setDocKey(newId);
      }
    })();
  };

  // Saved name of the open note (null while untitled) — const so closures
  // below keep the narrowed string type.
  const openName = open?.name ?? null;

  // Ctrl+K: command palette — commands first (New note on top), recent
  // notes below; typing fuzzy-searches across both.
  const commands: CommandEntry[] = [
    {
      kind: "command",
      id: "cmd:new",
      label: "New note",
      detail: "Ctrl+N",
      run: () => void newNote(),
    },
    {
      kind: "command",
      id: "cmd:save",
      label: "Save note",
      detail: "Ctrl+S",
      run: () => void save(),
    },
    { kind: "command", id: "cmd:rename", label: "Rename note", run: startRename },
    {
      kind: "command",
      id: "cmd:search",
      label: "Search in notes",
      detail: "Ctrl+Shift+F",
      run: openSearchView,
    },
    ...(openName
      ? [
          {
            kind: "command" as const,
            id: "cmd:delete",
            label: "Delete note",
            run: () => void deleteNote(openName),
          },
        ]
      : []),
    ...(canPreview
      ? [
          {
            kind: "command" as const,
            id: "cmd:preview",
            label: mode === "edit" ? "Open preview" : "Back to editor",
            detail: "Ctrl+E",
            run: togglePreview,
          },
        ]
      : []),
    ...projects
      .filter((p) => p !== currentProject)
      .map((p) => ({
        kind: "command" as const,
        id: `cmd:move:${p}`,
        label: `Move to project: ${p}`,
        run: () => void changeProject(p),
      })),
    ...(currentProject
      ? [
          {
            kind: "command" as const,
            id: "cmd:move:none",
            label: "Remove from project",
            run: () => void changeProject(null),
          },
        ]
      : []),
    {
      kind: "command",
      id: "cmd:new-project",
      label: "New project…",
      run: () => setCreatingProject(true),
    },
    {
      kind: "command",
      id: "cmd:scan-projects",
      label: "Scan folder for projects…",
      run: () => void scanForProjects(),
    },
    ...(canFormat ? FORMAT_GROUPS.flat() : []).map((f) => ({
      kind: "command" as const,
      id: `cmd:format:${f.kind}`,
      label: `Format: ${f.title.replace(/ \(.+\)$/, "")}`,
      detail: f.title.match(/\((.+)\)/)?.[1],
      run: () => editorRef.current?.applyFormat(f.kind),
    })),
    {
      kind: "command",
      id: "cmd:keybinds",
      label: "Keyboard shortcuts",
      run: () => setSettingsOpen(true),
    },
    {
      kind: "command",
      id: "cmd:settings",
      label: "Settings",
      run: () => setSettingsOpen(true),
    },
    {
      kind: "command",
      id: "cmd:hide",
      label: "Hide window",
      detail: "Esc",
      run: hideWindow,
    },
  ];

  // Menubar (custom title bar) — thin discoverability layer over the same
  // actions the palette exposes. Edit doubles as the editor's context menu.
  const editEntries: MenuEntry[] = [
    { label: "Undo", detail: "Ctrl+Z", run: () => editorRef.current?.exec("undo") },
    { label: "Redo", detail: "Ctrl+Y", run: () => editorRef.current?.exec("redo") },
    "sep",
    { label: "Cut", detail: "Ctrl+X", run: () => editorRef.current?.exec("cut") },
    { label: "Copy", detail: "Ctrl+C", run: () => editorRef.current?.exec("copy") },
    { label: "Paste", detail: "Ctrl+V", run: () => editorRef.current?.exec("paste") },
    { label: "Select all", detail: "Ctrl+A", run: () => editorRef.current?.exec("selectAll") },
    "sep",
    { label: "Find", detail: "Ctrl+F", run: () => editorRef.current?.exec("find") },
    { label: "Replace", detail: "Ctrl+H", run: () => editorRef.current?.exec("replace") },
    { label: "Go to line", detail: "Ctrl+G", run: () => editorRef.current?.exec("gotoLine") },
  ];
  const formatMenuItems: MenuEntry[] = FORMAT_GROUPS.flatMap((group, i) => [
    ...(i > 0 ? ["sep" as const] : []),
    ...group.map((f) => ({
      label: f.title.replace(/ \(.+\)$/, ""),
      detail: f.title.match(/\((.+)\)/)?.[1],
      run: () => editorRef.current?.applyFormat(f.kind),
    })),
  ]);
  const menus: MenuDef[] = [
    {
      label: "File",
      items: [
        { label: "New note", detail: "Ctrl+N", run: () => void newNote() },
        { label: "Save note", detail: "Ctrl+S", run: () => void save() },
        { label: "Rename note", run: startRename },
        ...(openName ? [{ label: "Delete note", run: () => void deleteNote(openName) }] : []),
        "sep",
        { label: "New project…", run: () => setCreatingProject(true) },
        { label: "Scan folder for projects…", run: () => void scanForProjects() },
        "sep",
        { label: "Settings", run: () => setSettingsOpen(true) },
        "sep",
        { label: "Hide window", detail: "Esc", run: hideWindow },
        { label: "Quit", run: () => void api.quit() },
      ],
    },
    { label: "Edit", items: editEntries },
    // "O" mnemonic (the classic Windows Format-menu convention) — "F" belongs to File.
    ...(canFormat ? [{ label: "Format", mnemonic: "o", items: formatMenuItems }] : []),
    {
      label: "View",
      items: [
        ...(canPreview
          ? [
              {
                label: mode === "edit" ? "Open preview" : "Back to editor",
                detail: "Ctrl+E",
                run: togglePreview,
              },
            ]
          : []),
        {
          label: explorerOpen ? "Hide explorer" : "Show explorer",
          detail: "Ctrl+Shift+E",
          run: () => setExplorerOpen((o) => !o),
        },
        {
          label: "Search in notes",
          detail: "Ctrl+Shift+F",
          run: openSearchView,
        },
        "sep",
        { label: "Command palette", detail: "Ctrl+K", run: () => setPaletteOpen("commands") },
        { label: "Switch note", detail: "Ctrl+P", run: () => setPaletteOpen("notes") },
        "sep",
        { label: "Zoom in", detail: "Ctrl+=", run: () => setZoom(zoomRef.current + 0.1) },
        { label: "Zoom out", detail: "Ctrl+-", run: () => setZoom(zoomRef.current - 0.1) },
        { label: "Reset zoom", detail: "Ctrl+0", run: () => setZoom(1) },
      ],
    },
    {
      label: "Help",
      items: [
        { label: "Keyboard shortcuts", run: () => setSettingsOpen(true) },
        { label: "About asapnotes", run: () => setSettingsOpen(true) },
      ],
    },
  ];

  const commandEntries: Entry[] = [
    ...commands.map((c) => ({ ...c, section: "Commands" })),
    ...noteEntries.map((n) => ({ ...n, section: "Notes" })),
  ];

  const openFromExplorer = (id: string, isNote: boolean) => {
    void openItem({ id, isNote }, draftIds);
    if (!explorerDocked) setExplorerOpen(false);
  };

  /** Open the note a search hit belongs to and jump to its line. Unlike the
   * file tree, a floating panel stays open — clicking through several results
   * in a row is the whole point of the view. */
  const openHit = (note: string, line: number) => {
    if (openRef.current?.id === note) {
      editorRef.current?.revealLine(line);
      return;
    }
    pendingLine.current = line;
    void openItem({ id: note, isNote: true }, draftIds);
  };

  /** Activate a tab — reload from draft/file so its name self-corrects. */
  const openTabItem = (id: string) => openItem({ id, isNote: noteNames.has(id) }, draftIds);

  /** Drop tabs; when the active one goes, activate its neighbor (or a fresh
   * note when it was the last). Unsaved edits stay behind as a draft — the
   * asking flavor is requestCloseTab. Takes a list so a just-saved tab can be
   * closed under both its identities (untitled id and saved name), whichever
   * the pending retag has reached; reads tabsRef rather than the render
   * closure so callers that awaited in between stay correct. */
  const closeTabs = (ids: string[]) => {
    const cur = tabsRef.current;
    const idx = cur.findIndex((t) => ids.includes(t.id));
    if (idx < 0) return;
    const rest = cur.filter((t) => !ids.includes(t.id));
    setTabs(rest);
    if (openRef.current && ids.includes(openRef.current.id)) {
      if (rest.length > 0) void openTabItem(rest[Math.min(idx, rest.length - 1)].id);
      else void newNote();
    }
  };
  const closeTab = (id: string) => closeTabs([id]);

  /** Close a tab, stopping to ask when its content would otherwise live on
   * only as a shadow draft: Save / Discard / Cancel. Dirty buffer means ask
   * when the tab is active; a draft means ask when it's in the background.
   * A never-typed untitled tab closes silently and its empty draft goes too. */
  const requestCloseTab = (id: string) => {
    if (openRef.current?.id === id) {
      if (openRef.current.name === null && contentRef.current.trim() === "") {
        cancelAutosave();
        void api.deleteDraft(id);
        setDrafts((d) => d.filter((x) => x.name !== id));
        closeTab(id);
      } else if (dirtyRef.current) {
        setCloseAsk(id);
      } else {
        closeTab(id);
      }
      return;
    }
    if (draftIds.has(id)) setCloseAsk(id);
    else closeTab(id);
  };

  /** "Save" on the close confirm. A background tab activates first so the one
   * save path runs, name derivation and the changed-on-disk guard included; a
   * save that didn't happen (guard declined, error) keeps the tab open. */
  const closeAskSave = async (id: string) => {
    setCloseAsk(null);
    try {
      if (openRef.current?.id !== id) await openTabItem(id);
      const saved = await save();
      if (saved) closeTabs([id, saved]);
    } catch (err) {
      toast(`Couldn't save that note — ${errText(err)}`);
    }
  };

  /** "Discard" on the close confirm: flush the buffer into the draft first so
   * the recycle bin holds exactly what was discarded, then trash it. */
  const closeAskDiscard = async (id: string) => {
    setCloseAsk(null);
    try {
      if (openRef.current?.id === id) {
        cancelAutosave();
        await api.writeDraft(id, contentRef.current);
      }
      await api.discardDraft(id);
    } catch (err) {
      toast(`Couldn't discard that draft — ${errText(err)}`);
      return;
    }
    setDrafts((d) => d.filter((x) => x.name !== id));
    closeTab(id);
  };

  const cycleTab = (backwards: boolean) => {
    const cur = openRef.current;
    if (!cur || tabs.length < 2) return;
    const i = tabs.findIndex((t) => t.id === cur.id);
    const next = tabs[(i + (backwards ? tabs.length - 1 : 1)) % tabs.length];
    void openTabItem(next.id);
  };

  const closeOtherTabs = (id: string) => {
    setTabs((ts) => ts.filter((t) => t.id === id));
    if (openRef.current?.id !== id) void openTabItem(id);
  };

  const closeAllTabs = () => {
    setTabs([]);
    void newNote();
  };

  /** Close every tab whose content is safe on disk (saved, no pending draft). */
  const closeSavedTabs = () => {
    const cur = openRef.current;
    const keep = tabs.filter((t) => draftIds.has(t.id) || (cur?.id === t.id && dirty));
    setTabs(keep);
    if (cur && !keep.some((t) => t.id === cur.id)) {
      if (keep.length > 0) void openTabItem(keep[0].id);
      else void newNote();
    }
  };

  /** Recycle-bin delete (after a native confirm); the note's draft and open
   * tab go with it. Never a hard delete — notes are user-owned files. */
  const deleteNote = async (id: string) => {
    const ok = await confirmDialog(`Move "${fileOf(id)}" to the Recycle Bin?`, {
      title: "Delete note",
      kind: "warning",
    });
    if (!ok) return;
    if (openRef.current?.id === id) cancelAutosave();
    try {
      await api.deleteNote(id);
    } catch (err) {
      toast(`Couldn't delete that note — ${errText(err)}`);
      return;
    }
    closeTab(id);
    setNotes(await api.listNotes());
    setDrafts(await api.listDrafts());
  };

  /** Throw away an unsaved untitled draft — unlike deleteNote, this content
   * exists nowhere else, hence its own sterner confirm (and the recycle bin
   * underneath it, like every other deletion). */
  const discardDraft = async (id: string) => {
    const ok = await confirmDialog(
      `Discard draft "${fileOf(id).replace(/\.md$/, "")}"? Its content is not saved anywhere.`,
      { title: "Discard draft", kind: "warning" },
    );
    if (!ok) return;
    if (openRef.current?.id === id) cancelAutosave();
    await api.discardDraft(id);
    setDrafts((d) => d.filter((x) => x.name !== id));
    closeTab(id);
  };

  /** Close every tab under a deleted subtree and re-list what's on disk — the
   * folder counterpart of the tab/draft cleanup deleteNote does for one note. */
  const closeDeletedSubtree = async (dir: string) => {
    const inside = (id: string) => id.startsWith(`${dir}/`);
    const cur = openRef.current;
    if (cur && inside(cur.id)) cancelAutosave();
    const keep = tabs.filter((t) => !inside(t.id));
    setTabs(keep);
    if (cur && inside(cur.id)) {
      if (keep.length > 0) void openTabItem(keep[0].id);
      else void newNote();
    }
    setNewFolders((ds) => ds.filter((d) => d !== dir && !inside(d)));
    setNotes(await api.listNotes());
    setDrafts(await api.listDrafts());
  };

  /** Recycle-bin delete of a folder and everything in it, after a confirm that
   * talks plainly about deletion — recoverability is the safety net, not the
   * pitch. */
  const deleteFolder = async (dir: string) => {
    const ok = await confirmDialog(`Delete "${fileOf(dir)}" and everything inside it?`, {
      title: "Delete folder",
      kind: "warning",
    });
    if (!ok) return;
    try {
      await api.deleteFolder(dir);
    } catch (err) {
      toast(`Couldn't delete that folder — ${errText(err)}`);
      return;
    }
    await closeDeletedSubtree(dir);
  };

  const openContextMenu = (e: React.MouseEvent, entries: MenuEntry[]) => {
    e.preventDefault();
    // Targets nest (row inside folder inside panel body) — innermost menu wins.
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, entries });
  };

  /** File operations shared by the tab-strip and explorer context menus. */
  const noteOps = (id: string): MenuEntry[] => [
    { label: "Copy path", run: () => void writeText(absPathOf(id)) },
    {
      label: "Reveal in File Explorer",
      run: () =>
        void api
          .revealNote(id)
          .catch((err: unknown) => toast(`Couldn't reveal that file — ${errText(err)}`)),
    },
    "sep",
    { label: "Delete note", run: () => void deleteNote(id) },
  ];

  const tabContextMenu = (e: React.MouseEvent, t: OpenNote) =>
    openContextMenu(e, [
      { label: "Close", detail: "Ctrl+W", run: () => requestCloseTab(t.id) },
      { label: "Close others", run: () => closeOtherTabs(t.id) },
      { label: "Close saved", run: closeSavedTabs },
      { label: "Close all", run: closeAllTabs },
      ...(t.name ? ["sep" as const, ...noteOps(t.name)] : []),
    ]);

  /** Rename from the explorer: open the note, then edit its name in the tab. */
  const renameFromExplorer = async (id: string) => {
    await openItem({ id, isNote: true }, draftIds);
    setRenameValue(fileOf(id).replace(/\.md$/, ""));
    setRenaming(true);
  };

  const startExplorerCreate = (dir: string, kind: "note" | "folder" | "virtual" = "note") => {
    setExplorerOpen(true);
    setExplorerView("files");
    setExplorerCreateKind(kind);
    setExplorerCreate(dir);
  };

  /** Inline name-first creation: write the (empty) file immediately, open it as
   * a saved note. A typed extension the registry claims sticks, else `.md`. */
  const createNamedNote = async (dir: string, name: string) => {
    setExplorerCreate(null);
    const trimmed = name.trim().replace(/^\/+|\/+$/g, "");
    if (!trimmed) return;
    const file = isNoteFile(trimmed) ? trimmed : `${trimmed}.md`;
    const id = dir ? `${dir}/${file}` : file;
    if (id.split("/").some((s) => !s || s.startsWith(".") || s.includes("\\"))) {
      toast(`"${name}" isn't a valid note name`);
      return;
    }
    const lower = id.toLowerCase();
    if (
      notes.some((n) => n.name.toLowerCase() === lower) ||
      drafts.some((d) => d.name.toLowerCase() === lower)
    ) {
      toast(`"${fileOf(id)}" already exists here`);
      return;
    }
    try {
      await api.saveNote(id, "");
    } catch (err) {
      toast(`Couldn't create that note — ${errText(err)}`);
      return;
    }
    setNotes(await api.listNotes());
    openFromExplorer(id, true);
  };

  /** Inline creation of a real folder under the clicked heading. */
  const createNamedFolder = async (dir: string, name: string) => {
    setExplorerCreate(null);
    const trimmed = name.trim();
    if (!trimmed) return;
    if (!validFileName(trimmed)) {
      toast(`"${name}" isn't a valid folder name`);
      return;
    }
    const id = `${dir}/${trimmed}`;
    try {
      await api.createFolder(id);
    } catch (err) {
      toast(`Couldn't create that folder — ${errText(err)}`);
      return;
    }
    setNewFolders((ds) => [...ds, id]);
  };

  /** Inline creation of a brand-new virtual folder: the backend makes its
   * backing directory in the virtual-folders home and attaches it here. */
  const createNamedVirtualFolder = async (dir: string, name: string) => {
    setExplorerCreate(null);
    const trimmed = name.trim();
    if (!trimmed) return;
    if (!validFileName(trimmed)) {
      toast(`"${name}" isn't a valid folder name`);
      return;
    }
    const [project, ...rest] = dir.split("/");
    try {
      await api.createVirtualFolder(project, [...rest, trimmed].join("/"));
    } catch (err) {
      toast(`Couldn't create that virtual folder — ${errText(err)}`);
      return;
    }
    await refreshProjects();
  };

  const explorerContextMenu = (e: React.MouseEvent, id: string, isNote: boolean) =>
    openContextMenu(e, [
      { label: "Open", run: () => openFromExplorer(id, isNote) },
      {
        label: "New note here",
        run: () => startExplorerCreate(id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : ""),
      },
      ...(isNote
        ? [
            { label: "Rename", run: () => void renameFromExplorer(id) },
            "sep" as const,
            ...noteOps(id),
          ]
        : ["sep" as const, { label: "Discard draft", run: () => void discardDraft(id) }]),
    ]);

  /** Attach an existing folder into a project ("associate virtual folder"):
   * pick it, and it lands under the clicked heading under its own name. A
   * brand-new one is "New virtual folder" instead. */
  const associateVirtualFolder = async (dir: string) => {
    const picked = await openFolderDialog({ directory: true, title: "Folder to attach" });
    if (typeof picked !== "string") return;
    const [project, ...rest] = dir.split("/");
    const name = picked.split(/[\\/]/).filter(Boolean).pop() ?? "";
    try {
      await api.addMount(project, [...rest, name].join("/"), picked);
    } catch (err) {
      toast(`Couldn't attach that folder — ${errText(err)}`);
      return;
    }
    await refreshProjects();
  };

  const detachVirtualFolder = async (mount: api.MountInfo) => {
    try {
      await api.removeMount(mount.project, mount.at);
    } catch (err) {
      toast(`Couldn't detach that folder — ${errText(err)}`);
      return;
    }
    await refreshProjects();
  };

  /** Delete a virtual folder outright — detach it *and* recycle-bin its
   * backing folder ("Detach" stays as the keep-the-files option). When that
   * folder is one the user owns elsewhere, the confirm says where it is. */
  const deleteVirtualFolder = async (mount: api.MountInfo) => {
    const name = mount.at.split("/").pop() ?? mount.at;
    const where = mount.external
      ? `\n\nIts files live in ${mount.path} — that folder is what gets deleted.`
      : "";
    const ok = await confirmDialog(`Delete "${name}" and everything inside it?${where}`, {
      title: "Delete virtual folder",
      kind: "warning",
    });
    if (!ok) return;
    try {
      await api.deleteMount(mount.project, mount.at);
    } catch (err) {
      toast(`Couldn't delete that folder — ${errText(err)}`);
      return;
    }
    await closeDeletedSubtree(`${mount.project}/${mount.at}`);
    await refreshProjects();
  };

  /** Right-click on a project or folder heading. Folders open in File Explorer
   * rather than being selected in their parent — their contents are the point. */
  const explorerDirMenu = (e: React.MouseEvent, dir: string) => {
    const [project, ...rest] = dir.split("/");
    const mount = mounts.find((m) => m.project === project && m.at === rest.join("/"));
    openContextMenu(e, [
      { label: "New note here", run: () => startExplorerCreate(dir) },
      // All three need a project to land in, which the notes-root heading ("")
      // isn't — a top-level folder is a project, created by "New project…".
      // "New folder" makes a real directory right here; "New virtual folder"
      // creates one in the virtual-folders home and attaches it; "Associate"
      // attaches a folder that already exists somewhere.
      ...(dir
        ? [
            { label: "New folder", run: () => startExplorerCreate(dir, "folder") },
            { label: "New virtual folder", run: () => startExplorerCreate(dir, "virtual") },
            { label: "Associate virtual folder…", run: () => void associateVirtualFolder(dir) },
          ]
        : []),
      // Detach keeps the files where they are; Delete recycle-bins them. On a
      // conflicted mount the real folder is what's visible, so plain folder
      // deletion is what its Delete does.
      ...(mount
        ? [
            { label: "Detach virtual folder", run: () => void detachVirtualFolder(mount) },
            mount.conflicted
              ? { label: "Delete folder", run: () => void deleteFolder(dir) }
              : { label: "Delete virtual folder", run: () => void deleteVirtualFolder(mount) },
          ]
        : rest.length > 0
          ? [{ label: "Delete folder", run: () => void deleteFolder(dir) }]
          : []),
      "sep" as const,
      { label: "Copy path", run: () => void writeText(absDirOf(dir)) },
      {
        label: "Open in File Explorer",
        run: () =>
          void api
            .openExternal(absDirOf(dir))
            .catch((err: unknown) => toast(`Couldn't open that folder — ${errText(err)}`)),
      },
    ]);
  };

  /** Right-click on the explorer's empty space. */
  const explorerBodyMenu = (e: React.MouseEvent) =>
    openContextMenu(e, [
      { label: "New note", run: () => startExplorerCreate("") },
      { label: "New project…", run: () => setCreatingProject(true) },
      "sep",
      { label: "Scan folder for projects…", run: () => void scanForProjects() },
    ]);

  const runEntry = (entry: Entry) => {
    setPaletteOpen(null);
    if (entry.kind === "command") {
      entry.run();
      // Inputs opened by a command (rename, new project) autofocus afterwards
      // and win over this.
      editorRef.current?.focus();
    } else {
      void openItem(entry, draftIds);
    }
  };

  // The tab the close confirm is about; a tab that vanished by other means
  // (deleted elsewhere) takes the dialog with it.
  const closeAskTab = closeAsk ? tabs.find((t) => t.id === closeAsk) : undefined;

  return (
    <div className="app">
      <MenuBar
        menus={menus}
        searchLabel={
          open ? (open.name ? fileOf(open.name).replace(/\.md$/, "") : "Untitled") : "Search"
        }
        onSearch={() => setPaletteOpen("commands")}
        onHide={hideWindow}
      />
      <div className="app-body">
        {/* Collapsed sidebar slat — the whole strip is the expand button. It
            stays as the anchor while the unpinned explorer floats over it. */}
        {(!explorerOpen || !explorerDocked) && (
          <button
            className="rail"
            title={explorerOpen ? "Close explorer (Ctrl+Shift+E)" : "Open explorer (Ctrl+Shift+E)"}
            onClick={() => setExplorerOpen((o) => !o)}
          >
            {explorerOpen ? "«" : "»"}
          </button>
        )}
        {explorerOpen && (
          <Explorer
            notes={notes}
            drafts={drafts}
            projects={projects}
            mounts={mounts}
            currentProject={currentProject}
            openId={open?.id ?? null}
            onSelect={openFromExplorer}
            onContext={explorerContextMenu}
            onDirContext={explorerDirMenu}
            onBodyContext={explorerBodyMenu}
            onStartCreate={startExplorerCreate}
            creatingIn={explorerCreate}
            creatingKind={explorerCreateKind}
            onCreate={(dir, name) =>
              void (explorerCreateKind === "folder"
                ? createNamedFolder(dir, name)
                : explorerCreateKind === "virtual"
                  ? createNamedVirtualFolder(dir, name)
                  : createNamedNote(dir, name))
            }
            onCreateCancel={() => setExplorerCreate(null)}
            newFolders={newFolders}
            view={explorerView}
            onViewChange={setExplorerView}
            searchSlot={
              <SearchView
                focusToken={searchFocus}
                onOpenHit={openHit}
                onError={(msg) => toast(`Search failed — ${msg}`)}
              />
            }
            pinned={explorerDocked}
            onTogglePin={() => setExplorerPinned(!explorerPinned)}
            onCollapse={() => setExplorerOpen(false)}
            width={explorerWidth}
            // The drag ranges up to the dock limit (docked) or nearly the whole
            // window (floating) — it can never cross the auto-collapse
            // threshold, so only a window shrink ever collapses the panel.
            onResize={(w) =>
              setExplorerWidth(
                Math.max(EXPLORER_MIN_W, Math.min(w, explorerDocked ? dockLimit : winWidth - 48)),
              )
            }
            // Persisted on release, not per pointer move.
            onResizeEnd={() => {
              localStorage.setItem("explorerWidth", String(explorerWidth));
              persistAppearance({ explorer: { width: explorerWidth, pinned: explorerPinned } });
            }}
          />
        )}
        <div className="main">
          <div className="top-panel">
            <div className="tabbar" ref={tabbarRef}>
              {tabs.map((t) => {
                const active = open?.id === t.id;
                return (
                  <div
                    key={t.id}
                    className={active ? "tab active" : "tab"}
                    title={t.name ?? "Unsaved note — double-click to name"}
                    onClick={() => {
                      if (!active) void openTabItem(t.id);
                    }}
                    onDoubleClick={() => {
                      if (active) startRename();
                    }}
                    onAuxClick={(e) => {
                      if (e.button === 1) requestCloseTab(t.id);
                    }}
                    onContextMenu={(e) => tabContextMenu(e, t)}
                  >
                    {renaming && active ? (
                      <input
                        className="title-input"
                        autoFocus
                        value={renameValue}
                        placeholder="note name…"
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") submitRename();
                        }}
                        onBlur={() => setRenaming(false)}
                      />
                    ) : (
                      <span className="tab-label">
                        {t.name ? fileOf(t.name).replace(/\.md$/, "") : "Untitled"}
                      </span>
                    )}
                    {(active ? dirty : draftIds.has(t.id)) && (
                      <span className="dirty" title="Unsaved — autosaved as draft. Ctrl+S to save.">
                        ●
                      </span>
                    )}
                    <button
                      className="tab-close"
                      title="Close tab (Ctrl+W)"
                      onClick={(e) => {
                        e.stopPropagation();
                        requestCloseTab(t.id);
                      }}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
              <button className="tab-new" title="New note (Ctrl+T)" onClick={() => void newNote()}>
                +
              </button>
            </div>
            <header className="titlebar">
              {canPreview && (
                <button
                  className={mode === "preview" ? "tool-btn open" : "tool-btn"}
                  data-tip={
                    mode === "edit" ? "Open reading preview (Ctrl+E)" : "Back to editor (Ctrl+E)"
                  }
                  aria-label={
                    mode === "edit" ? "Open reading preview (Ctrl+E)" : "Back to editor (Ctrl+E)"
                  }
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={togglePreview}
                >
                  {mode === "edit" ? "👁" : "✎"}
                </button>
              )}
              {mode === "edit" && canFormat && (
                <div className="fmt-inline">
                  {FORMAT_GROUPS.map((group, i) => (
                    <div className="toolbar-group" key={i}>
                      {group.map((f) => (
                        <button
                          key={f.kind}
                          className={`fmt-${f.kind}`}
                          data-tip={f.title}
                          aria-label={f.title}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => editorRef.current?.applyFormat(f.kind)}
                        >
                          {f.glyph}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </header>
          </div>
          <div
            className="content-panel"
            onContextMenu={(e) => {
              if (mode === "edit") openContextMenu(e, editEntries);
            }}
          >
            {open && (
              <Editor
                ref={editorRef}
                docKey={docKey}
                initialDoc={initialDoc}
                onChange={handleChange}
                onPasteImage={pasteImage}
                resolveImage={resolveImage}
                mentionItems={mentionItems}
                mentionLink={mentionLink}
                onOpenLink={openLink}
                onStatus={handleStatus}
                hidden={mode === "preview"}
                view={viewOf(open.id)}
                features={featuresOf(open.id)}
              />
            )}
            {open && mode === "preview" && <Preview doc={initialDoc} noteDir={noteDir} />}
          </div>
        </div>
      </div>
      {paletteOpen && (
        <Palette
          items={paletteOpen === "notes" ? noteEntries : commandEntries}
          placeholder={paletteOpen === "notes" ? "Switch to note…" : "Type a command or note…"}
          emptyText={paletteOpen === "notes" ? "No matching notes" : "No matches"}
          onSelect={runEntry}
          onClose={() => setPaletteOpen(null)}
        />
      )}
      {scanResults && (
        <ScanProjects
          candidates={scanResults}
          existing={projects}
          onAdd={addScannedProjects}
          onClose={() => {
            setScanResults(null);
            editorRef.current?.focus();
          }}
        />
      )}
      {creatingProject && (
        <NewProject
          rootPath={rootPath}
          existing={projects}
          onCreate={createProject}
          onClose={() => {
            setCreatingProject(false);
            editorRef.current?.focus();
          }}
        />
      )}
      {settingsOpen && (
        <Settings
          rootPath={rootPath}
          projects={projects.map((name) => ({ name, path: projectPaths[name] ?? null }))}
          onUnlinkProject={(name) => void unlinkProject(name)}
          onChangeProjectPath={(name) => void changeProjectPath(name)}
          theme={theme}
          onThemeChange={(next) => {
            setTheme(next);
            setThemeState(next);
            persistAppearance({ theme: next });
          }}
          onClose={() => {
            setSettingsOpen(false);
            editorRef.current?.focus();
          }}
        />
      )}
      {closeAskTab && (
        <CloseConfirm
          label={closeAskTab.name ? fileOf(closeAskTab.name).replace(/\.md$/, "") : "Untitled note"}
          untitled={closeAskTab.name === null}
          onSave={() => void closeAskSave(closeAskTab.id)}
          onDiscard={() => void closeAskDiscard(closeAskTab.id)}
          onCancel={() => {
            setCloseAsk(null);
            editorRef.current?.focus();
          }}
        />
      )}
      {ctxMenu && <ContextMenu menu={ctxMenu} onClose={() => setCtxMenu(null)} />}
      <StatusBar register={registerStatus} summonMs={summonMs} zoom={zoom} />
      <ToastStack toasts={toasts} onDismiss={dismiss} />
      <Tooltip />
    </div>
  );
}

export default App;
