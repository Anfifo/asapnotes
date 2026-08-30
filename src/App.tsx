import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { convertFileSrc } from "@tauri-apps/api/core";
import { confirm as confirmDialog, open as openFolderDialog } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { ChangesView } from "./Changes";
import { changedNotes, SeenTarget } from "./changesLedger";
import { DiffLens } from "./DiffLens";
import { CloseConfirm } from "./CloseConfirm";
import { ContextMenu, ContextMenuState } from "./ContextMenu";
import Editor, { EditorHandle, EditorStatus, FormatKind } from "./Editor";
import { Explorer } from "./Explorer";
import { MenuBar, MenuDef, MenuEntry } from "./MenuBar";
import { NewProject } from "./NewProject";
import {
  dirOf,
  fileOf,
  IMAGE_FILE,
  projectOf,
  relativePath,
  resolvePath,
  validFileName,
  winPath,
} from "./paths";
import { AppActionId, bindingTable, chordFor, chordOfEvent, DEFAULT_SUMMON } from "./keybinds";
import { About } from "./About";
import type { MapGraph, MapNode } from "./map/graph";
import type { Camera } from "./map/MapView";
import { DEFAULT_VIEW, isViewKind, VIEW_KINDS, VIEW_LABELS, type ViewKind } from "./map/viewKinds";
import { FileIcon } from "./fileIcons";
import {
  colorOf,
  extOfType,
  featuresOf,
  hasFeature,
  iconOf,
  isNoteFile,
  noteTypeOf,
  setNoteTypes,
  viewOf,
} from "./noteTypes";
import { Preview } from "./Preview";
import { Palette, PaletteItem } from "./Palette";
import { ScanProjects } from "./ScanProjects";
import { SearchView } from "./Search";
import { Settings } from "./Settings";
import { getTheme, setTheme, type Theme } from "./theme";
import { StatusBar } from "./StatusBar";
import { ToastStack } from "./Toast";
import { Tooltip } from "./Tooltip";
import { WelcomePanel, type WelcomeRecent } from "./WelcomePanel";
import { errText, useToasts } from "./toasts";
import * as api from "./notes";
import "./App.css";

interface OpenNote {
  /** Root-relative draft path; equals `name` once the note has been saved. */
  id: string;
  /** Saved note path, null while untitled. */
  name: string | null;
}

// Loaded on demand, never at startup: summon latency is the product, and the
// map module is only fetched when the first map actually renders.
const MapView = lazy(() => import("./map/MapView"));

const AUTOSAVE_MS = 500;

// A lens is a read-only tab over something computed rather than edited. All
// three below share one idiom: never persisted or drafted, at most one tab of
// that kind, retargeted rather than stacked by the next open, and a `<kind>:`
// id prefix that cannot collide with a note id because ':' is not a legal
// filename character here. Each comment below records only what its lens
// differs in.
//
// Changes: one note read with its external edits marked.
const DIFF_PREFIX = "changes:";
const isDiffTab = (id: string) => id.startsWith(DIFF_PREFIX);
/** The note a lens tab reads. */
const diffNoteOf = (id: string) => id.slice(DIFF_PREFIX.length);

// Map: the project's notes and the references between them, computed on every
// open and laid out by the map view.
const MAP_PREFIX = "map:";
const isMapTab = (id: string) => id.startsWith(MAP_PREFIX);
/** The project a map tab shows. */
const mapProjectOf = (id: string) => id.slice(MAP_PREFIX.length);

// File: any real file the map points at, shown as plain text — inside the
// corpus or out. Closes silently, since there is nothing to lose.
const FILE_PREFIX = "file:";
const isFileTab = (id: string) => id.startsWith(FILE_PREFIX);
/** The absolute path (forward slashes) a file tab shows. */
const filePathOf = (id: string) => id.slice(FILE_PREFIX.length);

const EXPLORER_DEFAULT_W = 224;
const EXPLORER_MIN_W = 168;
// Editor space a docked explorer must leave — the drag stops there, and only a
// window shrinking past it auto-collapses the panel.
const EDITOR_MIN_W = 280;

const clampZoom = (z: number) => Math.min(3, Math.max(0.5, Math.round(z * 10) / 10));

// Popup text size steps, as percentages of the default `--popup-font-size`.
const POPUP_SCALES = [85, 100, 115];

/** A stored (or hand-edited) explorer width, held to what this window can show.
 * The resize drag has its own limits — this is the boot/settings clamp. */
const clampExplorerWidth = (w: number) =>
  Math.min(Math.max(EXPLORER_MIN_W, w), Math.max(EXPLORER_MIN_W, window.innerWidth - EDITOR_MIN_W));

// Stroke-path icons for the symbolic buttons — text glyphs like ``` and ❝ read
// poorly at toolbar size, and emoji render in color that ignores the theme.
// Letters (H1–H3, B, I) stay letters.
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

/** The network mark the map surfaces share — the explorer chip and the map
 * tab wear the same glyph, so the tab reads as what the chip opened. */
const MAP_GLYPH = icon(
  <>
    <rect x="16" y="16" width="6" height="6" rx="1" />
    <rect x="2" y="16" width="6" height="6" rx="1" />
    <rect x="9" y="2" width="6" height="6" rx="1" />
    <path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" />
    <path d="M12 12V8" />
  </>,
);

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

/** The name a draft id carries: null only for app-generated `untitled-<ts>` ids,
 * whatever extension the new note was created with. A named draft keeps its name
 * even when the backing file is gone (deleted externally) — the titlebar stays
 * honest and Ctrl+S recreates the file. */
const draftName = (id: string) => (/^untitled-\d+\.[a-z0-9]+$/i.test(fileOf(id)) ? null : id);

/** `<base>.<ext>`, numbered until the name is free. */
function uniqueName(base: string, ext: string, taken: Set<string>): string {
  let name = `${base}.${ext}`;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}.${ext}`;
  return name;
}

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
  return uniqueName(`${prefix}${base}`, "md", taken);
}

function App() {
  const { toasts, toast, dismiss } = useToasts();
  const [notes, setNotes] = useState<api.FileInfo[]>([]);
  const [drafts, setDrafts] = useState<api.FileInfo[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  // Registered projects whose folder is gone from disk. The walks list
  // nothing there, so without this an unplugged or deleted root reads as an
  // empty project — the explorer marks the heading instead.
  const [missingProjects, setMissingProjects] = useState<string[]>([]);
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
      // Lens tabs (diff, map, file) are session-temporary and never restored.
      return Array.isArray(stored)
        ? stored.filter(
            (t) =>
              t &&
              typeof t.id === "string" &&
              !isDiffTab(t.id) &&
              !isMapTab(t.id) &&
              !isFileTab(t.id),
          )
        : [];
    } catch {
      return [];
    }
  });
  const [docKey, setDocKey] = useState("");
  const [initialDoc, setInitialDoc] = useState("");
  // The open map tab's computed graph; null while the notes are being read.
  // Its own state, not `initialDoc` — the map is a lens, and the note plumbing
  // (drafts, saves, baselines) must never see it.
  const [mapGraph, setMapGraph] = useState<{ key: string; graph: MapGraph } | null>(null);
  // What the open file lens shows: the text, or the reason it can't be shown
  // (binary, huge, gone). Keyed by tab id so a stale read is dropped.
  const [fileDoc, setFileDoc] = useState<{
    id: string;
    text: string | null;
    error: string | null;
  } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [paletteOpen, setPaletteOpen] = useState<"notes" | "commands" | null>(null);
  // Pinned = docked beside the editor; survives restarts (default on). Unpinned
  // the panel floats over the editor and closes on select / Esc / click-away.
  const [explorerPinned, setExplorerPinnedState] = useState(
    () => localStorage.getItem("explorerPinned") !== "0",
  );
  const [explorerOpen, setExplorerOpen] = useState(explorerPinned);
  // The explorer panel hosts three views; search and changes are deliberately
  // not persisted — reopening the app should land on the file tree.
  const [explorerView, setExplorerView] = useState<"files" | "search" | "changes">("files");
  // External edits in the changes window: App owns them because the view
  // button's count shows even while the view itself is closed.
  const [changes, setChanges] = useState<api.ChangeSummary[]>([]);
  // Bumped on every Ctrl+Shift+F so a repeat press refocuses and selects the
  // query box even when the search view is already showing.
  const [searchFocus, setSearchFocus] = useState(0);
  const [explorerWidth, setExplorerWidth] = useState(() => {
    const saved = Number(localStorage.getItem("explorerWidth"));
    return saved > 0 ? clampExplorerWidth(saved) : EXPLORER_DEFAULT_W;
  });
  // Current-project panel height; null sizes it to content. The drag inside
  // Explorer clamps against the live column, so no boot clamp is needed here.
  const [explorerPane, setExplorerPane] = useState<number | null>(() => {
    const saved = Number(localStorage.getItem("explorerPane"));
    return saved > 0 ? saved : null;
  });
  // Panels closed from their header ×; the View menu reopens them.
  const [hideRecent, setHideRecentState] = useState(
    () => localStorage.getItem("explorerHideRecent") === "1",
  );
  const [hideNotes, setHideNotesState] = useState(
    () => localStorage.getItem("explorerHideNotes") === "1",
  );
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
  // Which Settings section to land on — null = closed, "top" = the overlay as-is.
  const [settingsOpen, setSettingsOpen] = useState<null | "top" | "shortcuts">(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  // App-shortcut overrides (action id → chord) and the global summon hotkey.
  // No boot mirror: until settings load, the shipped defaults handle keys.
  const [keybinds, setKeybindsState] = useState<Record<string, string>>({});
  const keybindsRef = useRef(keybinds);
  keybindsRef.current = keybinds;
  const bindingsRef = useRef(bindingTable({}));
  useEffect(() => {
    bindingsRef.current = bindingTable(keybinds);
  }, [keybinds]);
  const [summonHotkey, setSummonHotkeyState] = useState(DEFAULT_SUMMON);
  // Which format "New note" creates. Null until settings load, which is
  // markdown — the shipped behavior.
  const [defaultNoteType, setDefaultNoteTypeState] = useState<string | null>(null);
  // Which layout the project map opens in — one preference for every map.
  const [mapView, setMapViewState] = useState<ViewKind>(DEFAULT_VIEW);
  // Double-clicking a non-markdown file on the map: false opens the in-app
  // read-only view, true hands it to the system default app.
  const [openFilesExternally, setOpenFilesExternallyState] = useState(false);
  const defaultExtRef = useRef("md");
  defaultExtRef.current = (defaultNoteType && extOfType(defaultNoteType)) || "md";
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [summonMs, setSummonMs] = useState<number | null>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [zoom, setZoomState] = useState(() => {
    const saved = Number(localStorage.getItem("zoom"));
    return saved > 0 ? clampZoom(saved) : 1;
  });
  const [theme, setThemeState] = useState<Theme>(getTheme);
  // Where a note type's color lands on explorer rows; settings-file only (no
  // boot mirror — rows paint after the first data round trip anyway).
  const [explorerTint, setExplorerTint] = useState<"full" | "icon">("full");
  // Popup text size step; mirrored in localStorage like theme/zoom so no
  // popup ever opens at the wrong size while the settings file loads.
  const [popupScale, setPopupScaleState] = useState(() => {
    const saved = Number(localStorage.getItem("popupScale"));
    return POPUP_SCALES.includes(saved) ? saved : 100;
  });
  // Tab held at the close confirm (Save / Discard / Cancel), null when none.
  const [closeAsk, setCloseAsk] = useState<string | null>(null);
  // The deliberate zero-tab state (welcome panel). Distinct from `open` being
  // null, which is also the pre-startup instant — the panel only ever follows
  // closing the last tab, never startup and never a summon.
  const [welcome, setWelcome] = useState(false);

  const editorRef = useRef<EditorHandle>(null);
  /** Where each project's map was last left, keyed by tab id and view: the
   * map recomputes on every activation, which would otherwise reset the camera
   * to the fitted view on every tab switch, and each layout has a camera of
   * its own. */
  const mapCamRef = useRef(new Map<string, Camera>());
  const contentRef = useRef("");
  const openRef = useRef<OpenNote | null>(null);
  openRef.current = open;
  const welcomeRef = useRef(welcome);
  welcomeRef.current = welcome;
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
  // The open buffer's last known on-disk content (null when unknown — loaded
  // from a draft, or the file vanished). A close finding the buffer equal to
  // this has nothing to protect, whatever the dirty flag says.
  const baselineRef = useRef<string | null>("");

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
    explorer: {
      width: explorerWidth,
      pinned: explorerPinned,
      pane: explorerPane,
      hideRecent,
      hideNotes,
    },
    explorerTint,
    popupScale,
  };

  // Stamp the popup size token; the popup surfaces and their em paddings all
  // follow it, so this one property is the whole mechanism.
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--popup-font-size",
      `${(popupScale * 8) / 1000}rem`,
    );
  }, [popupScale]);

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
    persistAppearance({ explorer: { ...appearanceRef.current.explorer, pinned } });
  };

  const setHideRecent = (hide: boolean) => {
    setHideRecentState(hide);
    localStorage.setItem("explorerHideRecent", hide ? "1" : "0");
    persistAppearance({ explorer: { ...appearanceRef.current.explorer, hideRecent: hide } });
  };

  const setHideNotes = (hide: boolean) => {
    setHideNotesState(hide);
    localStorage.setItem("explorerHideNotes", hide ? "1" : "0");
    persistAppearance({ explorer: { ...appearanceRef.current.explorer, hideNotes: hide } });
  };

  const setPopupScale = (scale: number) => {
    setPopupScaleState(scale);
    localStorage.setItem("popupScale", String(scale));
    persistAppearance({ popupScale: scale });
  };

  // Editor status flows straight to the StatusBar through this ref — routing
  // it through App state would re-render the whole tree on every keystroke.
  const statusCb = useRef<((s: EditorStatus | null) => void) | null>(null);
  const registerStatus = useCallback((cb: ((s: EditorStatus | null) => void) | null) => {
    statusCb.current = cb;
  }, []);
  const handleStatus = useCallback((s: EditorStatus | null) => statusCb.current?.(s), []);

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

  /** Write a pending (debounced) change immediately — called before switching
   * away, hiding, or closing, so nothing is left sitting in a timer. */
  const flushDraft = useCallback(async () => {
    if (!cancelAutosave()) return;
    const cur = openRef.current;
    if (!cur) return;
    await api.writeDraft(cur.id, contentRef.current);
    upsertDraft(cur.id);
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
      if (!cur) return;
      void api.writeDraft(cur.id, doc);
      upsertDraft(cur.id);
    }, AUTOSAVE_MS);
  }, []);

  const showDoc = useCallback(
    (note: OpenNote, content: string, isDirty: boolean) => {
      contentRef.current = content;
      // Dirty on arrival means the content came from a draft, not the file —
      // no baseline to compare a close against.
      baselineRef.current = isDirty ? null : content;
      setOpen(note);
      setWelcome(false);
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

  /** Open a fresh untitled note of some extension. */
  const newDoc = useCallback(
    async (project: string | null | undefined, ext: string) => {
      await flushDraft();
      const prefix = project ? `${project}/` : "";
      showDoc({ id: `${prefix}untitled-${Date.now()}.${ext}`, name: null }, "", false);
    },
    [flushDraft, showDoc],
  );

  /** Capture: the blank note a summon, a startup with nothing to restore, or a
   * closed last tab lands in. Always markdown — capture means "type now",
   * whatever the default-format setting says. The deliberate verbs go through
   * `newNote`. */
  const newCapture = useCallback((project?: string | null) => newDoc(project, "md"), [newDoc]);

  /** The "New note" verb: the extension comes from the default note type, the
   * same from the File menu, the palette and the explorer alike. */
  const newNote = useCallback(
    (project?: string | null) => newDoc(project, defaultExtRef.current),
    [newDoc],
  );

  /** Open a note (or draft) into the editor; false when its file could not be
   * read. Every activation path funnels through here, so the vanished-file
   * case fails loud in one place: toast, drop the tab, leave the current doc
   * standing — never a silently dead row that outlives its file. */
  const openItem = useCallback(
    async (item: { id: string; isNote: boolean }, draftIds: Set<string>): Promise<boolean> => {
      await flushDraft();
      const hasDraft = draftIds.has(item.id);
      let content: string;
      try {
        // No draft and no saved file (an untouched untitled tab) — nothing on disk to read.
        content = hasDraft
          ? await api.readDraft(item.id)
          : item.isNote
            ? await api.readNote(item.id)
            : "";
      } catch {
        toast(`Couldn't open "${fileOf(item.id)}" — its file is gone`);
        setTabs((ts) => ts.filter((t) => t.id !== item.id));
        return false;
      }
      showDoc({ id: item.id, name: item.isNote ? item.id : draftName(item.id) }, content, hasDraft);
      editorRef.current?.focus();
      return true;
    },
    [flushDraft, showDoc, toast],
  );

  /** Open the read-only lens tab for one note's recent changes. Not a note:
   * nothing to load or autosave — it renders straight from the history store.
   * There is only ever one lens tab: opening another note's changes retargets
   * the one that's up, so the strip never fills with them. */
  const openDiffTab = useCallback(
    async (note: string) => {
      await flushDraft();
      const id = `${DIFF_PREFIX}${note}`;
      const tab = { id, name: null };
      contentRef.current = "";
      setOpen(tab);
      setWelcome(false);
      setTabs((ts) => {
        const at = ts.findIndex((t) => isDiffTab(t.id));
        if (at < 0) return [...ts, tab];
        return ts[at].id === id ? ts : ts.map((t, i) => (i === at ? tab : t));
      });
      setDirty(false);
      setMode("edit");
      setPaletteOpen(null);
      trackMtime(null);
    },
    [flushDraft, trackMtime],
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

  /** Open a project's map: its markdown notes read and laid out fresh, so the
   * view can never be stale. The tab appears at once and the graph lands when
   * the notes have been read; a stale compute (another tab took over
   * meanwhile) is dropped. The compute module loads on demand, like the map
   * view itself — a summon never pays for it. */
  const openMapTab = useCallback(
    async (project: string) => {
      await flushDraft();
      const id = `${MAP_PREFIX}${project}`;
      const tab = { id, name: null };
      contentRef.current = "";
      setOpen(tab);
      setWelcome(false);
      setTabs((ts) => {
        const at = ts.findIndex((t) => isMapTab(t.id));
        if (at < 0) return [...ts, tab];
        return ts[at].id === id ? ts : ts.map((t, i) => (i === at ? tab : t));
      });
      setDirty(false);
      setMode("edit");
      setPaletteOpen(null);
      trackMtime(null);
      setMapGraph(null);
      const { computeGraph } = await import("./map/graph");
      // Listed fresh from disk, not from state: a recompute can follow a
      // deletion by less than a render, and a computed view must trust the
      // disk over a ref that hasn't caught up.
      const listed = await api.listNotes();
      const names = new Set(listed.map((n) => n.name));
      const noteIds = listed
        .map((n) => n.name)
        .filter((name) => projectOf(name) === project && viewOf(name) === "markdown");
      const graph = await computeGraph(project, {
        projectDir: projectDirOf(project),
        noteIds,
        readNote: api.readNote,
        noteDirOf,
        noteIdOf,
        hasNote: (name) => names.has(name),
      });
      if (openRef.current?.id === id) setMapGraph({ key: `${id}@${Date.now()}`, graph });
    },
    [flushDraft, trackMtime, projectDirOf, noteDirOf, noteIdOf],
  );

  /** Open a referenced file read-only: any real file the map points at,
   * corpus or not. The tab appears at once; the text lands when the read does
   * — or the reason it can't be shown, with "Open externally" still on offer. */
  const openFileTab = useCallback(
    async (abs: string) => {
      await flushDraft();
      const id = `${FILE_PREFIX}${abs}`;
      const tab = { id, name: null };
      contentRef.current = "";
      setOpen(tab);
      setWelcome(false);
      setTabs((ts) => {
        const at = ts.findIndex((t) => isFileTab(t.id));
        if (at < 0) return [...ts, tab];
        return ts[at].id === id ? ts : ts.map((t, i) => (i === at ? tab : t));
      });
      setDirty(false);
      setMode("edit");
      setPaletteOpen(null);
      trackMtime(null);
      setFileDoc(null);
      try {
        const text = await api.readFileText(winPath(abs));
        if (openRef.current?.id === id) setFileDoc({ id, text, error: null });
      } catch (err) {
        if (openRef.current?.id === id) setFileDoc({ id, text: null, error: errText(err) });
      }
    },
    [flushDraft, trackMtime],
  );

  /** Follow a Ctrl+Clicked editor target: URLs → browser; paths resolving to
   * a note → open in-app; other paths → OS default. Relative ones resolve
   * against `from` — the open note's directory, except in the changes lens,
   * which reads a note that isn't the open one. */
  const openLink = useCallback(
    (target: string, from?: string) => {
      void (async () => {
        try {
          if (/^(https?:\/\/|mailto:)/i.test(target)) {
            await api.openExternal(target);
            return;
          }
          const abs = /^[a-z]:[\\/]/i.test(target)
            ? target.replace(/\\/g, "/")
            : resolvePath(from ?? noteDirRef.current, target);
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
      if (!cur || isDiffTab(cur.id)) return null;
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
      baselineRef.current = doc;
      mtimeTokenRef.current++; // invalidate any in-flight track
      openMtimeRef.current = (await api.noteMtime(name).catch(() => null)) ?? null;
      if (draftsRef.current.some((d) => d.name === cur.id)) {
        await api.deleteDraft(cur.id);
        setDrafts((d) => d.filter((x) => x.name !== cur.id));
      }
      if (cur.id !== name) retagOpen(cur.id, { id: name, name });
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
      if (!cur || isDiffTab(cur.id) || isMapTab(cur.id) || isFileTab(cur.id)) return;
      if (target === projectOf(cur.id)) return;
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
    const cur = openRef.current;
    if (!cur || isDiffTab(cur.id) || !hasFeature(cur.id, "preview")) return;
    if (modeRef.current === "edit") {
      setInitialDoc(contentRef.current);
      setMode("preview");
    } else {
      setMode("edit");
    }
  }, []);

  /** Resolve a relative image src against a note directory (for live preview). */
  const imageIn = useCallback((dir: string, src: string) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return src;
    const abs = resolvePath(dir, src);
    return convertFileSrc(abs);
  }, []);

  /** The open note's own images — what the editor and the preview render. */
  const resolveImage = useCallback((src: string) => imageIn(noteDirRef.current, src), [imageIn]);

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
      // Link text is prose, not chrome — the default extension stays out of
      // it even though the app's surfaces show it.
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
      if (typeof explorer?.pane === "number" && explorer.pane > 0) {
        setExplorerPane(explorer.pane);
        localStorage.setItem("explorerPane", String(explorer.pane)); // mirror only
      }
      if (typeof explorer?.hideRecent === "boolean") {
        setHideRecentState(explorer.hideRecent);
        localStorage.setItem("explorerHideRecent", explorer.hideRecent ? "1" : "0"); // mirror only
      }
      if (typeof explorer?.hideNotes === "boolean") {
        setHideNotesState(explorer.hideNotes);
        localStorage.setItem("explorerHideNotes", explorer.hideNotes ? "1" : "0"); // mirror only
      }
      const tint = settings.appearance.explorerTint;
      if (tint === "full" || tint === "icon") setExplorerTint(tint);
      const scale = settings.appearance.popupScale;
      if (typeof scale === "number" && POPUP_SCALES.includes(scale)) {
        setPopupScaleState(scale);
        localStorage.setItem("popupScale", String(scale)); // mirror only
      }
      setKeybindsState(settings.keybinds ?? {});
      setSummonHotkeyState(settings.summonHotkey ?? DEFAULT_SUMMON);
      setDefaultNoteTypeState(settings.defaultNoteType ?? null);
      setMapViewState(isViewKind(settings.mapView) ? settings.mapView : DEFAULT_VIEW);
      setOpenFilesExternallyState(settings.openFilesExternally ?? false);
      // From here on an appearance change is the user's, and gets written back.
      appearanceSyncedRef.current = true;
    },
    [applyZoom, toast],
  );

  /** Which layout the project map opens in. The view switches at once; the
   * setting follows, and a failed write says so without switching back. */
  const setMapView = useCallback(
    (view: ViewKind) => {
      setMapViewState(view);
      void api
        .setMapView(view)
        .catch((err: unknown) => toast(`Couldn't save that setting — ${errText(err)}`));
    },
    [toast],
  );

  /** Which format "New note" creates. */
  const setDefaultNoteType = useCallback(
    (id: string | null) => {
      setDefaultNoteTypeState(id);
      void api.setDefaultNoteType(id).catch((err: unknown) => {
        setDefaultNoteTypeState(defaultNoteType);
        toast(`Couldn't save that setting — ${errText(err)}`);
      });
    },
    [defaultNoteType, toast],
  );

  /** How a referenced non-markdown file opens from the map: the in-app
   * read-only view, or the system default app. */
  const setOpenFilesExternally = useCallback(
    (on: boolean) => {
      setOpenFilesExternallyState(on);
      void api.setOpenFilesExternally(on).catch((err: unknown) => {
        setOpenFilesExternallyState(!on);
        toast(`Couldn't save that setting — ${errText(err)}`);
      });
    },
    [toast],
  );

  /** Override one app shortcut (chord null = back to the defaults). The whole
   * override map is persisted; the file never holds shipped defaults. */
  const setKeybind = useCallback(
    (action: string, chord: string | null) => {
      const next = { ...keybindsRef.current };
      if (chord) next[action] = chord;
      else delete next[action];
      setKeybindsState(next);
      void api
        .setKeybinds(next)
        .catch((err: unknown) => toast(`Couldn't save the shortcut — ${errText(err)}`));
    },
    [toast],
  );

  /** Rebind the global summon hotkey — registration happens on the backend,
   * so a chord another app holds is refused there and reported here. */
  const changeSummonHotkey = useCallback(
    async (chord: string) => {
      try {
        await api.setSummonHotkey(chord);
        setSummonHotkeyState(chord);
      } catch (err) {
        toast(`Couldn't set the summon hotkey — ${errText(err)}`);
      }
    },
    [toast],
  );

  /** Adopt a project listing: names for every consumer, plus which registered
   * roots are gone from disk — the explorer says so on their headings. */
  const applyProjects = useCallback((ps: api.ProjectInfo[]) => {
    setProjects(ps.map((p) => p.name));
    setMissingProjects(ps.filter((p) => p.missing).map((p) => p.name));
  }, []);

  // A notes root on an unreachable drive fails every refresh call on every
  // focus — report once per distinct message (the settings read has the same
  // rule); a successful re-list clears it so a recurrence surfaces again.
  const refreshErrorRef = useRef<string | null>(null);
  const reportRefreshError = useCallback(
    (err: unknown) => {
      const msg = errText(err);
      if (msg !== refreshErrorRef.current) toast(`Couldn't read your notes — ${msg}`);
      refreshErrorRef.current = msg;
    },
    [toast],
  );

  // Snapshot what changed on disk behind the app's back, then re-read the
  // ledger — the scan is what makes the count honest, and the window slides,
  // so both run together. Best-effort by design: a failing history store
  // must not toast on every focus, it just reads as "no changes".
  const refreshChanges = useCallback(() => {
    void api
      .scanChanges()
      .then(() => api.recentChanges())
      .then(setChanges)
      .catch(() => {});
  }, []);

  // Seen marks: applied optimistically to the summaries (the ledger dims and
  // the badge drops at once), persisted to the backend's seen ledger, and
  // journaled so Ctrl+Z can walk marks back one action at a time.
  const seenUndoRef = useRef<{ items: SeenTarget[]; seen: boolean }[]>([]);
  const seenRedoRef = useRef<{ items: SeenTarget[]; seen: boolean }[]>([]);

  const applySeen = useCallback(
    (items: SeenTarget[], seen: boolean) => {
      const keys = new Set(items.map((i) => `${i.atMs}:${i.note}`));
      setChanges((cs) => cs.map((c) => (keys.has(`${c.atMs}:${c.note}`) ? { ...c, seen } : c)));
      void api
        .setChangesSeen(items, seen)
        .catch((err: unknown) => toast(`Couldn't save the seen mark — ${errText(err)}`));
    },
    [toast],
  );

  const markSeen = useCallback(
    (items: SeenTarget[], seen: boolean) => {
      if (items.length === 0) return;
      seenUndoRef.current.push({ items, seen });
      seenRedoRef.current = [];
      applySeen(items, seen);
    },
    [applySeen],
  );

  /** Walk the last seen-mark back (or forward again); false when the stack is
   * empty, so the caller can leave the key event alone. */
  const undoSeen = useCallback(
    (redo: boolean) => {
      const from = redo ? seenRedoRef.current : seenUndoRef.current;
      const to = redo ? seenUndoRef.current : seenRedoRef.current;
      const batch = from.pop();
      if (!batch) return false;
      to.push(batch);
      applySeen(batch.items, redo ? batch.seen : !batch.seen);
      return true;
    },
    [applySeen],
  );

  // Startup: recover the most recent draft; else open the most recent note;
  // else start on a blank capture.
  useEffect(() => {
    void (async () => {
      try {
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
        applyProjects(ps);
        setMounts(ms);
        applySettings(cfg);
        setRootPath(root);
        // Projects living outside the notes root can be big — walk them after
        // the first paint. A failure here already failed the shallow list.
        void api
          .listNotes()
          .then(setNotes)
          .catch(() => {});
        // Same reasoning for the changes scan: it reads only what changed, but
        // the first paint shouldn't wait for even that.
        refreshChanges();
        // Restored tabs win: reopen the last active one (content loads here, the
        // rest stay lazy). A tab whose note vanished is dropped and we fall back.
        const restored = tabsRef.current;
        if (restored.length > 0) {
          const activeId = localStorage.getItem("activeTab");
          const target = restored.find((t) => t.id === activeId) ?? restored[0];
          try {
            const hasDraft = ds.some((d) => d.name === target.id);
            const content = hasDraft
              ? await api.readDraft(target.id)
              : await api.readNote(target.id);
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
      } catch (err) {
        // A notes root on an unreachable drive fails the first listing: name
        // the problem and land on a blank capture — never a forever-blank
        // window. Nothing here needs the root until the first save.
        toast(`Couldn't load your notes — ${errText(err)}`);
        showDoc({ id: `untitled-${Date.now()}.md`, name: null }, "", false);
      }
    })();
  }, [showDoc, applySettings, applyProjects, refreshChanges, toast]);

  // Tabs (and which one is active) survive restarts — diff tabs excepted,
  // they show a window that will have moved on by the next boot.
  useEffect(() => {
    localStorage.setItem(
      "tabs",
      JSON.stringify(tabs.filter((t) => !isDiffTab(t.id) && !isMapTab(t.id) && !isFileTab(t.id))),
    );
  }, [tabs]);
  useEffect(() => {
    if (open && !isDiffTab(open.id) && !isMapTab(open.id) && !isFileTab(open.id))
      localStorage.setItem("activeTab", open.id);
  }, [open]);

  // Tabs shrink to fit rather than scroll; when even minimum widths overflow,
  // the strip pans with a hidden scrollbar — keep the active tab revealed.
  const tabbarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    tabbarRef.current
      ?.querySelector(".tab.active")
      ?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [open]);

  // Dropped image files are intercepted by Tauri, which hands over paths rather
  // than File objects: copy them into assets/ and insert the link at the cursor.
  // Only for a note whose type takes images — an image link in a .log is noise.
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent(async (event) => {
      if (event.payload.type !== "drop" || modeRef.current !== "edit") return;
      const cur = openRef.current;
      if (!cur || !hasFeature(cur.id, "images")) return;
      const images = event.payload.paths.filter((p) => IMAGE_FILE.test(p));
      if (images.length === 0) return;
      for (const path of images) {
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
    applyProjects(ps);
    setMounts(ms);
    applySettings(cfg);
  }, [applySettings, applyProjects]);

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

  /** Run one rebindable app action — the chord table's targets. */
  const runAction = (action: AppActionId) => {
    switch (action) {
      case "save":
        return void save();
      case "new-note":
        return void newNote();
      case "close-tab":
        if (openRef.current) requestCloseTab(openRef.current.id);
        return;
      case "next-tab":
        return cycleTab(false);
      case "command-palette":
        setPaletteOpen((o) => (o === "commands" ? null : "commands"));
        if (paletteOpen === "commands") editorRef.current?.focus();
        return;
      case "switch-note":
        setPaletteOpen((o) => (o === "notes" ? null : "notes"));
        if (paletteOpen === "notes") editorRef.current?.focus();
        return;
      case "explorer":
        return setExplorerOpen((o) => !o);
      case "search":
        return openSearchView();
      case "preview":
        return togglePreview();
      case "zoom-in":
        return setZoom(zoomRef.current + 0.1);
      case "zoom-out":
        return setZoom(zoomRef.current - 0.1);
      case "zoom-reset":
        return setZoom(1);
    }
  };

  // App-level shortcuts. Kept in a ref so the window listener registers once
  // but always sees fresh state. The rebindable chords live in a table
  // (keybinds.ts defaults + settings.json overrides); Ctrl+Z/Y and Escape
  // stay special-cased below because both dispatch on focus, not on chord.
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandlerRef.current = (e: KeyboardEvent) => {
    const t = e.target as Element;
    // A shortcut recorder in Settings owns every key while it records.
    if (t.closest?.(".chord-recording")) return;
    const chord = chordOfEvent(e);
    if (chord) {
      const action = bindingsRef.current.get(chord);
      if (action) {
        e.preventDefault();
        runAction(action);
        return;
      }
      // Shift over the next-tab chord cycles backwards.
      if (
        chord.includes("Shift+") &&
        bindingsRef.current.get(chord.replace("Shift+", "")) === "next-tab"
      ) {
        e.preventDefault();
        cycleTab(true);
        return;
      }
    }
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && (key === "z" || key === "y")) {
      // Seen-mark undo/redo — only when text editing doesn't own the key
      // (CodeMirror and inputs keep their own history, the board its own
      // move/resize journal), and only while there is a mark to walk.
      // Otherwise the key falls through untouched.
      const t = e.target as Element;
      if (!t.closest(".cm-editor") && !t.closest("input, textarea") && !t.closest(".board")) {
        if (undoSeen(key === "y" || e.shiftKey)) e.preventDefault();
      }
    } else if (e.key === "Escape") {
      if (document.querySelector(".menu-drop")) {
        // An open menubar dropdown or context menu owns Esc — Esc there means
        // "leave this", not "hide the window".
      } else if (renaming) {
        setRenaming(false);
        editorRef.current?.focus();
      } else if (scanResults) {
        setScanResults(null);
        editorRef.current?.focus();
      } else if (settingsOpen) {
        setSettingsOpen(null);
        editorRef.current?.focus();
      } else if (aboutOpen) {
        setAboutOpen(false);
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
      void api
        .listNotes()
        .then((ns) => {
          refreshErrorRef.current = null;
          setNotes(ns);
        })
        .catch(reportRefreshError);
      void api.listDrafts().then(setDrafts).catch(reportRefreshError);
      // Projects and mounts come back from the backend rather than from the
      // settings document, because whether one is conflicted or missing is a
      // filesystem question.
      void api.listProjects().then(applyProjects).catch(reportRefreshError);
      void api.listMounts().then(setMounts).catch(reportRefreshError);
      // The same signal catches what other tools wrote to the notes while the
      // app wasn't looking — this is what fills the recent-changes view.
      refreshChanges();
      void api
        .getSettings(true)
        .then(applySettings)
        .catch((err: unknown) => toast(`Couldn't read settings — ${errText(err)}`));
      // A broken .asapnotes.json falls back to default rules in the walks;
      // this is where it becomes visible instead of reading as missing notes.
      void api
        .projectConfigErrors()
        .then((errs) => {
          for (const e of errs) if (!configErrorsRef.current.includes(e)) toast(e);
          configErrorsRef.current = errs;
        })
        .catch(reportRefreshError);
      const name = openRef.current?.name;
      if (!name) return;
      void (async () => {
        const mtime = await api.noteMtime(name).catch(() => null);
        const cur = openRef.current;
        if (!cur || cur.name !== name) return;
        if (mtime === null) {
          // No reference mtime means no file was ever seen — a lazily-created
          // tab (a project board before its first save), not a vanished file.
          if (openMtimeRef.current === null) return;
          // The file vanished from disk, and a clean buffer has no draft —
          // the buffer is the only copy left. Dirty + draft re-arm the
          // close-confirm and draft safety nets; Ctrl+S recreates the file,
          // since the save guard reads a missing file as no conflict.
          if (!dirtyRef.current) {
            setDirty(true);
            // The draft is the only copy now — a close must keep asking.
            baselineRef.current = null;
            await api.writeDraft(cur.id, contentRef.current);
            upsertDraft(cur.id);
          }
          return;
        }
        if (openMtimeRef.current === null) {
          openMtimeRef.current = mtime; // adopt — no reference point yet
        } else if (mtime !== openMtimeRef.current && !dirtyRef.current) {
          const content = await api.readNote(name);
          if (openRef.current?.name !== name) return;
          contentRef.current = content;
          baselineRef.current = content;
          setInitialDoc(content);
          editorRef.current?.setDoc(content);
          openMtimeRef.current = mtime;
        }
        // Dirty + changed: leave the stale mtime so the save guard fires.
      })().catch((err: unknown) => toast(`Couldn't re-check the open note — ${errText(err)}`));
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [applySettings, applyProjects, reportRefreshError, toast, refreshChanges]);

  // `summoned` carries the hotkey-press epoch ms from Rust; the next animation
  // frame approximates when the shown window actually painted.
  useEffect(() => {
    const unlisten = listen<number>("summoned", (event) => {
      // Summon lands in a ready-to-type note even past the welcome panel —
      // the panel is a parked state, and summoning means "capture, now".
      if (welcomeRef.current) void newCapture();
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
  }, [newCapture]);

  const draftIds = new Set(drafts.map((d) => d.name));
  const noteNames = new Set(notes.map((n) => n.name));
  // `@`-mention candidates: saved notes, minus the one being edited.
  const mentionItems = notes
    .filter((n) => n.name !== open?.name)
    .map((n) => ({ id: n.name, label: n.name }));
  const noteEntries: NoteEntry[] = [
    ...notes.map((n) => ({
      kind: "note" as const,
      id: n.name,
      label: n.name,
      detail: draftIds.has(n.name) ? "unsaved edits" : undefined,
      isNote: true,
    })),
    ...drafts
      .filter((d) => !noteNames.has(d.name))
      .map((d) => ({
        kind: "note" as const,
        id: d.name,
        label: d.name,
        detail: "draft",
        isNote: false,
      })),
  ];

  // Affordances the open note's type declares. Nothing open is two states:
  // the pre-startup instant keeps the chrome (something markdown is about to
  // open, and hiding it would flash), the welcome panel drops it.
  const diffOpen = open !== null && isDiffTab(open.id);
  // The open tab is the computed project map.
  const mapOpen = open !== null && isMapTab(open.id);
  // The open tab is the read-only file view of a referenced file.
  const fileOpen = open !== null && isFileTab(open.id);
  const lensOpen = diffOpen || mapOpen || fileOpen;
  const canPreview = open ? !lensOpen && hasFeature(open.id, "preview") : !welcome;
  const canFormat = open ? !lensOpen && hasFeature(open.id, "format") : !welcome;
  // The open note's real directory (for resolving relative image links).
  // A map tab claims its project: opening a project's map is what "opening a
  // project" means now, so the pane, title bar and creation targets follow.
  const currentProject =
    open && !lensOpen ? projectOf(open.id) : mapOpen && open ? mapProjectOf(open.id) : null;
  // Publish the current project for the MCP sidecar. Only the write pin consumes
  // the project (`mcp.writeScope: "current"`), where it is what keeps an agent's
  // edits inside whatever the user is actually working on — but it is sent on
  // every change regardless, so turning the pin on doesn't need a tab switch
  // before it means anything.
  useEffect(() => {
    void api.setMcpCurrentProject(currentProject).catch(() => {});
  }, [currentProject]);

  // A projectless open note hoists the loose files as the explorer's top pane.
  const looseCurrent = open !== null && !lensOpen && !currentProject;
  const noteDir = open && !lensOpen ? noteDirOf(open.id) : rootPath;
  noteDirRef.current = noteDir;

  /** Opening a file on the map that isn't a note: markdown always opens in
   * the in-app read-only view; images are never text, so always the system
   * viewer; everything else follows the setting. */
  const openMapFile = (abs: string) => {
    if (IMAGE_FILE.test(abs) || (openFilesExternally && !/\.md$/i.test(abs))) {
      void api
        .openExternal(winPath(abs))
        .catch((err: unknown) => toast(`Couldn't open that file — ${errText(err)}`));
      return;
    }
    void openFileTab(abs);
  };

  const startRename = () => {
    if (!open || isDiffTab(open.id) || isMapTab(open.id) || isFileTab(open.id)) return;
    setRenameValue(open.name ? fileOf(open.name) : "");
    setRenaming(true);
  };

  /** Rename the open note; naming an untitled draft saves it under that name. */
  const submitRename = () => {
    setRenaming(false);
    editorRef.current?.focus();
    const cur = openRef.current;
    const base = renameValue.trim();
    if (!cur || !validFileName(base)) return;
    // The whole containing folder, not just the project: a rename leaves the
    // note where it is, and a note inside a folder — real or virtual — has
    // segments in between that dropping would move the file to the project.
    const dir = dirOf(cur.id);
    // A typed extension the registry claims is kept (renaming todo.txt keeps
    // .txt); anything else gets the default .md.
    const newId = (dir ? `${dir}/` : "") + (isNoteFile(base) ? base : `${base}.md`);
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

  // The open note's containing folder, as an id — the target the File menu's
  // folder verbs act on. Null when there's no folder to act on: nothing open,
  // a diff tab, or a loose note (the notes root can't hold folders — a
  // top-level folder is a project).
  const openDir = open && !diffOpen ? dirOf(open.id) || null : null;

  // Menu and tooltip chord readouts follow the effective bindings, so a
  // rebound shortcut is what the chrome advertises.
  const kb = (id: AppActionId) => chordFor(id, keybinds);

  // Ctrl+K: command palette — commands first (New note on top), recent
  // notes below; typing fuzzy-searches across both.
  const commands: CommandEntry[] = [
    {
      kind: "command",
      id: "cmd:new",
      label: "New note",
      detail: kb("new-note"),
      run: () => void newNote(),
    },
    {
      kind: "command",
      id: "cmd:save",
      label: "Save note",
      detail: kb("save"),
      run: () => void save(),
    },
    { kind: "command", id: "cmd:rename", label: "Rename note", run: startRename },
    // The map's layouts, offered while a map is what's open — the same switch
    // the map's own bar carries.
    ...(mapOpen
      ? VIEW_KINDS.filter((k) => k !== mapView).map((k) => ({
          kind: "command" as const,
          id: `cmd:map-view:${k}`,
          label: `Map view: ${VIEW_LABELS[k]}`,
          run: () => setMapView(k),
        }))
      : []),
    {
      kind: "command",
      id: "cmd:search",
      label: "Search in notes",
      detail: kb("search"),
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
            detail: kb("preview"),
            run: togglePreview,
          },
        ]
      : []),
    // Moving is for the open note — a lens tab has nothing to move, even
    // though a map tab now names a current project.
    ...(open && !lensOpen
      ? projects
          .filter((p) => p !== currentProject)
          .map((p) => ({
            kind: "command" as const,
            id: `cmd:move:${p}`,
            label: `Move to project: ${p}`,
            run: () => void changeProject(p),
          }))
      : []),
    ...(open && !lensOpen && currentProject
      ? [
          {
            kind: "command" as const,
            id: "cmd:move:none",
            label: "Remove from project",
            run: () => void changeProject(null),
          },
        ]
      : []),
    ...(currentProject
      ? [
          {
            kind: "command" as const,
            id: "cmd:map",
            label: `Open project map: ${currentProject}`,
            run: () => void openMapTab(currentProject),
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
      run: () => setSettingsOpen("shortcuts"),
    },
    {
      kind: "command",
      id: "cmd:settings",
      label: "Settings",
      run: () => setSettingsOpen("top"),
    },
    {
      kind: "command",
      id: "cmd:about",
      label: "About asapnotes",
      run: () => setAboutOpen(true),
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
        { label: "New note", detail: kb("new-note"), run: () => void newNote() },
        { label: "Save note", detail: kb("save"), run: () => void save() },
        { label: "Rename note", run: startRename },
        ...(openName ? [{ label: "Delete note", run: () => void deleteNote(openName) }] : []),
        "sep",
        { label: "New project…", run: () => setCreatingProject(true) },
        { label: "Scan folder for projects…", run: () => void scanForProjects() },
        // The folder verbs need a target a menubar entry doesn't have, so they
        // act on the open note's folder, named in the label. Detach/Delete stay
        // right-click-only: destructive verbs against an implicit target invite
        // deleting the wrong folder.
        ...(openDir
          ? [
              "sep" as const,
              {
                label: `New folder in "${fileOf(openDir)}"`,
                run: () => startExplorerCreate(openDir, "folder"),
              },
              {
                label: `New virtual folder in "${fileOf(openDir)}"`,
                run: () => startExplorerCreate(openDir, "virtual"),
              },
              {
                label: `Associate virtual folder into "${fileOf(openDir)}"…`,
                run: () => void associateVirtualFolder(openDir),
              },
            ]
          : []),
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
                detail: kb("preview"),
                run: togglePreview,
              },
            ]
          : []),
        {
          label: explorerOpen ? "Hide explorer" : "Show explorer",
          detail: kb("explorer"),
          run: () => setExplorerOpen((o) => !o),
        },
        {
          label: hideRecent ? "Show Recent panel" : "Hide Recent panel",
          run: () => setHideRecent(!hideRecent),
        },
        {
          label: hideNotes ? "Show Notes panel" : "Hide Notes panel",
          run: () => setHideNotes(!hideNotes),
        },
        {
          label: "Search in notes",
          detail: kb("search"),
          run: openSearchView,
        },
        "sep",
        {
          label: "Command palette",
          detail: kb("command-palette"),
          run: () => setPaletteOpen("commands"),
        },
        { label: "Switch note", detail: kb("switch-note"), run: () => setPaletteOpen("notes") },
        "sep",
        { label: "Zoom in", detail: kb("zoom-in"), run: () => setZoom(zoomRef.current + 0.1) },
        { label: "Zoom out", detail: kb("zoom-out"), run: () => setZoom(zoomRef.current - 0.1) },
        { label: "Reset zoom", detail: kb("zoom-reset"), run: () => setZoom(1) },
      ],
    },
    // Settings at the top level, with Help's items folded in; About is its
    // own small overlay rather than a Settings section.
    {
      label: "Settings",
      items: [
        { label: "Settings…", run: () => setSettingsOpen("top") },
        { label: "Keyboard shortcuts", run: () => setSettingsOpen("shortcuts") },
        "sep",
        { label: "About asapnotes", run: () => setAboutOpen(true) },
      ],
    },
  ];

  const commandOnly: Entry[] = commands.map((c) => ({ ...c, section: "Commands" }));
  const commandEntries: Entry[] = [
    ...commandOnly,
    ...noteEntries.map((n) => ({ ...n, section: "Notes" })),
  ];
  // Ctrl+P lists notes, Ctrl+K lists both — and in either, a leading ">"
  // means commands alone.
  const paletteItems: Entry[] = paletteOpen === "notes" ? noteEntries : commandEntries;

  const openFromExplorer = (id: string, isNote: boolean) => {
    void openItem({ id, isNote }, draftIds);
    if (!explorerDocked) setExplorerOpen(false);
  };

  /** The changed notes as the ledger orders them — the lens steps through
   * this sequence when one note's changes run out. */
  const changedOrder = changedNotes(changes);

  /** Ledger row → that note's lens; "Read through" (null) starts at the top of
   * the ledger. Same floating-panel etiquette as opening a file: a floating
   * explorer closes behind it. */
  const openChangesLens = (note: string | null) => {
    const target = note ?? changedOrder[0];
    if (!target) return;
    void openDiffTab(target);
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

  /** Activate a tab — reload from draft/file so its name self-corrects.
   * False when the tab's file is gone (openItem toasted and dropped it). */
  const openTabItem = (id: string): Promise<boolean> =>
    isDiffTab(id)
      ? openDiffTab(diffNoteOf(id)).then(() => true)
      : isMapTab(id)
        ? // Activating the map recomputes it — "recomputed on open" is what
          // makes a computed view trustworthy.
          openMapTab(mapProjectOf(id)).then(() => true)
        : isFileTab(id)
          ? // Re-read on activation; a file that vanished shows the reason,
            // with "Open externally" still on the header.
            openFileTab(filePathOf(id)).then(() => true)
          : openItem({ id, isNote: noteNames.has(id) }, draftIds);

  /** Enter the zero-tab state: flush any pending draft, drop the editor
   * surface, show the welcome panel. Reached only by closes that empty the
   * tab strip — startup always opens something. */
  const showWelcome = () => {
    void flushDraft();
    contentRef.current = "";
    setOpen(null);
    setWelcome(true);
    setInitialDoc("");
    setDirty(false);
    setMode("edit");
    trackMtime(null);
  };

  /** Activate the survivor nearest `idx`, walking on when a tab's file is
   * gone (openTabItem toasts and drops it), down to the welcome panel when
   * none can open — the strip must never show a closed tab as active with no
   * way to Ctrl+W out of it. */
  const handOff = async (rest: OpenNote[], idx: number) => {
    const left = [...rest];
    while (left.length > 0) {
      const i = Math.min(idx, left.length - 1);
      if (await openTabItem(left[i].id)) return;
      left.splice(i, 1);
    }
    showWelcome();
  };

  /** Drop tabs; when the active one goes, activate its neighbor (or the
   * welcome panel when it was the last). Unsaved edits stay behind as a draft
   * — the asking flavor is requestCloseTab. Takes a list so a just-saved tab
   * can be closed under both its identities (untitled id and saved name),
   * whichever the pending retag has reached; reads tabsRef rather than the
   * render closure so callers that awaited in between stay correct. */
  const closeTabs = (ids: string[]) => {
    const cur = tabsRef.current;
    const idx = cur.findIndex((t) => ids.includes(t.id));
    if (idx < 0) return;
    const rest = cur.filter((t) => !ids.includes(t.id));
    setTabs(rest);
    if (openRef.current && ids.includes(openRef.current.id)) {
      void handOff(rest, idx);
    }
  };
  const closeTab = (id: string) => closeTabs([id]);

  /** The lens belongs to the changes flow, not to the tab strip: it goes when
   * that flow is left — the explorer switching views, Esc, or the lens handing
   * over to the real note. */
  const closeLens = () => {
    const ids = tabsRef.current.filter((t) => isDiffTab(t.id)).map((t) => t.id);
    if (ids.length > 0) closeTabs(ids);
  };

  const changeExplorerView = (view: "files" | "search" | "changes") => {
    setExplorerView(view);
    if (view !== "changes") closeLens();
  };

  /** The lens hands over to the note it was reading: open it (at the change on
   * screen), then drop the lens tab — by then it is a background tab, so this
   * can't run the close-and-hand-off dance. */
  const openNoteFromLens = (note: string, line?: number) => {
    if (line !== undefined) pendingLine.current = line;
    void openItem({ id: note, isNote: true }, draftIds).then(closeLens);
  };

  /** Close a tab, stopping to ask when its content would otherwise live on
   * only as a shadow draft: Save / Discard / Cancel. Dirty buffer means ask
   * when the tab is active; a draft means ask when it's in the background.
   * A never-typed untitled tab closes silently and its empty draft goes too. */
  const requestCloseTab = (id: string) => {
    // A lens tab holds no content of its own — nothing to save or discard.
    if (isDiffTab(id) || isMapTab(id) || isFileTab(id)) {
      closeTab(id);
      return;
    }
    if (openRef.current?.id === id) {
      if (openRef.current.name === null && contentRef.current.trim() === "") {
        cancelAutosave();
        void api.deleteDraft(id);
        setDrafts((d) => d.filter((x) => x.name !== id));
        closeTab(id);
      } else if (dirtyRef.current && contentRef.current !== baselineRef.current) {
        setCloseAsk(id);
      } else {
        // Clean, or edited back to exactly what the file holds — nothing a
        // Save/Discard prompt would protect. Any shadow draft written along
        // the way is redundant now and would re-dirty the next open.
        cancelAutosave();
        if (dirtyRef.current) {
          void api.deleteDraft(id);
          setDrafts((d) => d.filter((x) => x.name !== id));
        }
        closeTab(id);
      }
      return;
    }
    if (draftIds.has(id)) {
      // A background tab's draft may match its file exactly (edits undone,
      // then flushed on switch-away) — check before bothering the user.
      void (async () => {
        try {
          const [draft, file] = await Promise.all([api.readDraft(id), api.readNote(id)]);
          if (draft === file) {
            await api.deleteDraft(id);
            setDrafts((d) => d.filter((x) => x.name !== id));
            closeTab(id);
            return;
          }
        } catch {
          // No file to compare against (untitled draft) — the draft is the
          // only copy, so ask.
        }
        setCloseAsk(id);
      })();
    } else closeTab(id);
  };

  /** "Save" on the close confirm. A background tab activates first so the one
   * save path runs, name derivation and the changed-on-disk guard included; a
   * save that didn't happen (guard declined, error) keeps the tab open. */
  const closeAskSave = async (id: string) => {
    setCloseAsk(null);
    try {
      // A background tab that failed to activate (file and draft gone) was
      // dropped by openTabItem — saving now would save the wrong note.
      if (openRef.current?.id !== id && !(await openTabItem(id))) return;
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
    const keep = tabsRef.current.filter((t) => t.id === id);
    setTabs(keep);
    if (openRef.current?.id !== id) void handOff(keep, 0);
  };

  const closeAllTabs = () => {
    setTabs([]);
    showWelcome();
  };

  /** Close every tab whose content is safe on disk (saved, no pending draft). */
  const closeSavedTabs = () => {
    const cur = openRef.current;
    const keep = tabs.filter((t) => draftIds.has(t.id) || (cur?.id === t.id && dirty));
    setTabs(keep);
    if (cur && !keep.some((t) => t.id === cur.id)) void handOff(keep, 0);
  };

  /** Recycle-bin delete (after a native confirm); the note's draft and open
   * tab go with it. Never a hard delete — notes are user-owned files. */
  /** Resolves true only when the note was actually deleted — a caller with
   * follow-up work (the map recomputes) must not run it on a cancel. */
  const deleteNote = async (id: string): Promise<boolean> => {
    const ok = await confirmDialog(`Move "${fileOf(id)}" to the Recycle Bin?`, {
      title: "Delete note",
      kind: "warning",
    });
    if (!ok) return false;
    if (openRef.current?.id === id) cancelAutosave();
    try {
      await api.deleteNote(id);
    } catch (err) {
      toast(`Couldn't delete that note — ${errText(err)}`);
      return false;
    }
    closeTab(id);
    setNotes(await api.listNotes());
    setDrafts(await api.listDrafts());
    return true;
  };

  /** Throw away an unsaved untitled draft — unlike deleteNote, this content
   * exists nowhere else, hence its own sterner confirm (and the recycle bin
   * underneath it, like every other deletion). */
  const discardDraft = async (id: string) => {
    const ok = await confirmDialog(
      `Discard draft "${fileOf(id)}"? Its content is not saved anywhere.`,
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
    if (cur && inside(cur.id)) void handOff(keep, 0);
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

  /** File operations shared by the tab-strip, explorer and map-card context
   * menus. `afterDelete` runs only when the note really went — the map uses
   * it to recompute, or the dead card would linger. */
  const noteOps = (id: string, afterDelete?: () => void): MenuEntry[] => [
    { label: "Copy path", run: () => void writeText(absPathOf(id)) },
    {
      label: "Reveal in File Explorer",
      run: () =>
        void api
          .revealNote(id)
          .catch((err: unknown) => toast(`Couldn't reveal that file — ${errText(err)}`)),
    },
    "sep",
    {
      label: "Delete note",
      run: () =>
        void deleteNote(id).then((deleted) => {
          if (deleted) afterDelete?.();
        }),
    },
  ];

  /** The map's file verbs for a node: a note speaks the explorer row's own
   * menu; a referenced file the corpus doesn't own only reveals — the map
   * must not delete files it merely points at. A dead link offers nothing
   * (there is no file to reveal or delete). */
  const mapFileVerbs = (node: MapNode): MenuEntry[] => {
    if (node.noteId)
      return noteOps(node.noteId, () => {
        const cur = openRef.current;
        if (cur && isMapTab(cur.id)) void openMapTab(mapProjectOf(cur.id));
      });
    if (node.kind === "image" || node.kind === "file") {
      return [
        {
          label: "Reveal in File Explorer",
          run: () =>
            void api
              .revealPath(winPath(node.abs))
              .catch((err: unknown) => toast(`Couldn't reveal that file — ${errText(err)}`)),
        },
      ];
    }
    return [];
  };

  const tabContextMenu = (e: React.MouseEvent, t: OpenNote) =>
    openContextMenu(e, [
      { label: "Close", detail: kb("close-tab"), run: () => requestCloseTab(t.id) },
      { label: "Close others", run: () => closeOtherTabs(t.id) },
      { label: "Close saved", run: closeSavedTabs },
      { label: "Close all", run: closeAllTabs },
      ...(t.name ? ["sep" as const, ...noteOps(t.name)] : []),
    ]);

  /** Rename from the explorer: open the note, then edit its name in the tab. */
  const renameFromExplorer = async (id: string) => {
    if (!(await openItem({ id, isNote: true }, draftIds))) return;
    setRenameValue(fileOf(id));
    setRenaming(true);
  };

  const startExplorerCreate = (dir: string, kind: "note" | "folder" | "virtual" = "note") => {
    setExplorerOpen(true);
    setExplorerView("files");
    // Creation targeting the Notes panel reopens it, the way creation into a
    // collapsed project expands it — the input has to be visible to be used.
    // Root creation while the loose pane is hoisted lands there instead, so
    // the Notes panel can stay closed.
    if (hideNotes && !(dir === "" && looseCurrent) && dir.split("/")[0] !== currentProject) {
      setHideNotes(false);
    }
    setExplorerCreateKind(kind);
    setExplorerCreate(dir);
  };

  /** Inline name-first creation: write the (empty) file immediately, open it as
   * a saved note. A typed extension the registry claims sticks, else `.md`. */
  const createNamedNote = async (dir: string, name: string, ext = "md") => {
    setExplorerCreate(null);
    const trimmed = name.trim().replace(/^\/+|\/+$/g, "");
    if (!trimmed) return;
    const file = isNoteFile(trimmed) ? trimmed : `${trimmed}.${ext}`;
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
      { label: "New note here", run: () => startExplorerCreate(dirOf(id)) },
      ...(isNote
        ? [
            { label: "Rename", run: () => void renameFromExplorer(id) },
            // Reachable from a file too, not only the folder's own row — the
            // label names the folder, since the target is implicit here.
            ...convertFolderEntries(dirOf(id), true),
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

  /** Convert a virtual folder into a real one: its files move into the project
   * under the same name. The name is what every contained note's id is built
   * from, so nothing here has to touch tabs, drafts or history — the tree just
   * redraws. When the backing folder is one the user owns elsewhere, the
   * confirm names it, because that folder is what moves. */
  const makeFolderReal = async (mount: api.MountInfo) => {
    const name = fileOf(mount.at);
    if (mount.external) {
      const ok = await confirmDialog(
        `Make "${name}" a real folder inside ${mount.project}?\n\nIts files live in ${mount.path} — that folder is what gets moved.`,
        { title: "Convert to a real folder", kind: "warning" },
      );
      if (!ok) return;
    }
    try {
      await api.folderToReal(mount.project, mount.at);
    } catch (err) {
      toast(`Couldn't convert that folder — ${errText(err)}`);
      return;
    }
    await refreshProjects();
  };

  /** The inverse: the folder's files move to the virtual-folders home and a
   * mount takes over its name. The destination isn't one the user picked, so
   * the command answers with it and the toast says where the files went. */
  const makeFolderVirtual = async (dir: string) => {
    const [project, ...rest] = dir.split("/");
    let path: string;
    try {
      path = await api.folderToVirtual(project, rest.join("/"));
    } catch (err) {
      toast(`Couldn't convert that folder — ${errText(err)}`);
      return;
    }
    await refreshProjects();
    toast(`"${fileOf(dir)}" is virtual now — its files live in ${path}`);
  };

  /** The conversion entry for a folder id, for both menus that offer it: the
   * folder's own row and a note's row inside it. Nothing to offer for the
   * notes root or a project heading (a top-level folder is a project), for a
   * mount whose name a real folder has taken over, or for one whose files are
   * gone. `named` puts the folder in the label, for a menu whose target is
   * implicit. */
  const convertFolderEntries = (dir: string, named: boolean) => {
    const [project, ...rest] = dir.split("/");
    if (!project || rest.length === 0) return [];
    const rel = rest.join("/");
    const mount = mounts.find((m) => m.project === project && m.at === rel);
    // A folder *inside* a virtual folder has no directory of its own in the
    // project, so neither conversion means anything there.
    if (!mount && mounts.some((m) => m.project === project && rel.startsWith(`${m.at}/`)))
      return [];
    const what = named ? ` "${fileOf(dir)}"` : "";
    if (!mount)
      return [
        { label: `Convert${what} to a virtual folder`, run: () => void makeFolderVirtual(dir) },
      ];
    return mount.conflicted || mount.missing
      ? []
      : [{ label: `Convert${what} to a real folder`, run: () => void makeFolderReal(mount) }];
  };

  /** Right-click on a project or folder heading. Folders open in File Explorer
   * rather than being selected in their parent — their contents are the point. */
  const explorerDirMenu = (e: React.MouseEvent, dir: string) => {
    const [project, ...rest] = dir.split("/");
    const mount = mounts.find((m) => m.project === project && m.at === rest.join("/"));
    openContextMenu(e, [
      // The map is per project, so only the project heading offers it — not
      // subfolders or mounts.
      ...(dir && rest.length === 0
        ? [{ label: "Open project map", run: () => void openMapTab(dir) }, "sep" as const]
        : []),
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
      // Either direction of the virtual/real conversion, whichever this folder
      // is. It keeps the folder's name, so no note in it changes id.
      ...convertFolderEntries(dir, false),
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

  // Welcome panel content: the target-less main actions, and the freshest
  // notes and drafts (computed only while it shows) merged to one entry per
  // name at the newest timestamp — the explorer's Recent rule, shortened.
  const welcomeActions = [
    { label: "New note", detail: kb("new-note"), run: () => void newNote() },
    { label: "New project…", run: () => setCreatingProject(true) },
    { label: "Scan folder for projects…", run: () => void scanForProjects() },
    { label: "Settings", run: () => setSettingsOpen("top") },
  ];
  let welcomeRecent: WelcomeRecent[] = [];
  if (welcome) {
    const latest = new Map<string, number>();
    for (const f of [...notes, ...drafts]) {
      latest.set(f.name, Math.max(latest.get(f.name) ?? 0, f.modified_ms));
    }
    welcomeRecent = [...latest.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id]) => ({
        id,
        label: fileOf(id),
        detail: projectOf(id) ?? (noteNames.has(id) ? undefined : "draft"),
        isNote: noteNames.has(id),
      }));
  }

  return (
    <div className="app">
      <MenuBar
        menus={menus}
        searchLabel={
          open
            ? diffOpen
              ? `± ${fileOf(diffNoteOf(open.id))}`
              : open.name
                ? fileOf(open.name)
                : "Untitled"
            : "Search"
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
            aria-label={explorerOpen ? "Close explorer" : "Open explorer"}
            data-tip={
              explorerOpen
                ? `Close explorer (${kb("explorer")})`
                : `Open explorer (${kb("explorer")})`
            }
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
            missingProjects={missingProjects}
            mounts={mounts}
            currentProject={currentProject}
            looseCurrent={looseCurrent}
            openId={open?.id ?? null}
            onSelect={openFromExplorer}
            onContext={explorerContextMenu}
            onDirContext={explorerDirMenu}
            onBodyContext={explorerBodyMenu}
            onStartCreate={startExplorerCreate}
            onOpenMap={(p) => void openMapTab(p)}
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
            onViewChange={changeExplorerView}
            searchSlot={
              <SearchView
                focusToken={searchFocus}
                onOpenHit={openHit}
                onError={(msg) => toast(`Search failed — ${msg}`)}
              />
            }
            changesSlot={
              <ChangesView
                summaries={changes}
                onOpenLens={openChangesLens}
                onOpenNote={(note) => openFromExplorer(note, true)}
                onMarkSeen={markSeen}
                onMenu={openContextMenu}
              />
            }
            changesCount={new Set(changes.filter((c) => !c.seen).map((c) => c.note)).size}
            pinned={explorerDocked}
            onTogglePin={() => setExplorerPinned(!explorerPinned)}
            onCollapse={() => setExplorerOpen(false)}
            tint={explorerTint}
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
              persistAppearance({ explorer: { ...appearanceRef.current.explorer } });
            }}
            paneHeight={explorerPane}
            onPaneResize={setExplorerPane}
            onPaneResizeEnd={() => {
              if (explorerPane === null) return;
              localStorage.setItem("explorerPane", String(explorerPane));
              persistAppearance({ explorer: { ...appearanceRef.current.explorer } });
            }}
            onPaneReset={() => {
              setExplorerPane(null);
              localStorage.removeItem("explorerPane");
              persistAppearance({ explorer: { ...appearanceRef.current.explorer, pane: null } });
            }}
            hideRecent={hideRecent}
            hideNotes={hideNotes}
            onHideRecent={() => setHideRecent(true)}
            onHideNotes={() => setHideNotes(true)}
          />
        )}
        <div className="main">
          <div className="top-panel">
            <div className="tabbar" ref={tabbarRef}>
              {tabs.map((t) => {
                const active = open?.id === t.id;
                const diffNote = isDiffTab(t.id) ? diffNoteOf(t.id) : null;
                const mapProject = isMapTab(t.id) ? mapProjectOf(t.id) : null;
                const lensFile = isFileTab(t.id) ? filePathOf(t.id) : null;
                return (
                  <div
                    key={t.id}
                    className={active ? "tab active" : "tab"}
                    data-tip={
                      isDiffTab(t.id)
                        ? `Recent changes — ${diffNote}`
                        : mapProject
                          ? `Project map — ${mapProject}`
                          : lensFile
                            ? `Read-only — ${lensFile}`
                            : (t.name ?? "Unsaved note — double-click to name")
                    }
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
                        {isDiffTab(t.id) ? (
                          <>
                            <span className="tab-diff">±</span>
                            {diffNote && fileOf(diffNote)}
                          </>
                        ) : mapProject ? (
                          <>
                            <span className="tab-map">{MAP_GLYPH}</span>
                            {mapProject}
                          </>
                        ) : lensFile ? (
                          <>
                            <span className="tab-file">
                              <FileIcon icon={iconOf(lensFile)} color={colorOf(lensFile)} />
                            </span>
                            {fileOf(lensFile)}
                          </>
                        ) : t.name ? (
                          fileOf(t.name)
                        ) : (
                          "Untitled"
                        )}
                      </span>
                    )}
                    {(active ? dirty : draftIds.has(t.id)) && (
                      <span
                        className="dirty"
                        data-tip={`Unsaved — autosaved as draft. ${kb("save")} to save.`}
                      >
                        ●
                      </span>
                    )}
                    <button
                      className="tab-close"
                      aria-label="Close tab"
                      data-tip={`Close tab (${kb("close-tab")})`}
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
              <button
                className="tab-new"
                aria-label="New note"
                data-tip={`New note (${kb("new-note")})`}
                onClick={() => void newNote()}
              >
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
              // The Edit menu talks to the editor, which a lens tab doesn't
              // have (the map raises its own menus).
              if (lensOpen) return;
              if (mode === "edit") openContextMenu(e, editEntries);
            }}
          >
            {open && diffOpen && (
              <DiffLens
                note={diffNoteOf(open.id)}
                order={changedOrder}
                events={changes
                  .filter((c) => c.note === diffNoteOf(open.id))
                  .map(({ note, atMs }) => ({ note, atMs }))}
                seen={changes.filter((c) => c.note === diffNoteOf(open.id)).every((c) => c.seen)}
                resolveImage={(src) => imageIn(noteDirOf(diffNoteOf(open.id)), src)}
                onOpenLens={(note) => void openDiffTab(note)}
                onOpenNote={openNoteFromLens}
                onOpenLink={(target) => openLink(target, noteDirOf(diffNoteOf(open.id)))}
                onMarkSeen={markSeen}
                onClose={closeLens}
                onError={(msg) => toast(`Recent changes — ${msg}`)}
              />
            )}
            {mapOpen && open && (
              <Suspense fallback={null}>
                <MapView
                  key={open.id}
                  graph={mapGraph?.graph ?? null}
                  view={mapView}
                  onView={setMapView}
                  camera={mapCamRef.current.get(`${open.id}|${mapView}`) ?? null}
                  onCamera={(cam) => mapCamRef.current.set(`${open.id}|${mapView}`, cam)}
                  onOpenNote={(id) => void openItem({ id, isNote: true }, draftIds)}
                  onOpenFile={openMapFile}
                  imageUrl={convertFileSrc}
                  onMenu={openContextMenu}
                  fileVerbs={mapFileVerbs}
                  emptyHint="This project has no notes to map yet."
                />
              </Suspense>
            )}
            {fileOpen && open && (
              <div className="file-lens">
                <div className="file-lens-head">
                  <span className="file-lens-path">{filePathOf(open.id)}</span>
                  <span className="file-lens-badge">read-only</span>
                  <button
                    className="file-lens-open"
                    data-tip="Open with the system default app"
                    onClick={() =>
                      void api
                        .openExternal(winPath(filePathOf(open.id)))
                        .catch((err: unknown) => toast(`Couldn't open that file — ${errText(err)}`))
                    }
                  >
                    Open externally
                  </button>
                </div>
                {fileDoc?.id === open.id && fileDoc.error !== null && (
                  <div className="file-lens-error">
                    This file can’t be shown here — {fileDoc.error}
                  </div>
                )}
                {fileDoc?.id === open.id && fileDoc.text !== null && (
                  <pre className="file-lens-text">{fileDoc.text}</pre>
                )}
              </div>
            )}
            {open && !lensOpen && (
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
            {!open && welcome && (
              <WelcomePanel
                actions={welcomeActions}
                recent={welcomeRecent}
                shortcuts={[
                  [summonHotkey, "Summon / hide from anywhere"],
                  [kb("new-note"), "New note"],
                  [kb("switch-note"), "Switch note"],
                  [kb("command-palette"), "Command palette"],
                  [kb("search"), "Search in notes"],
                  ["Esc", "Hide window"],
                ]}
                onOpenRecent={(id, isNote) => void openItem({ id, isNote }, draftIds)}
              />
            )}
          </div>
        </div>
      </div>
      {paletteOpen && (
        <Palette
          items={paletteItems}
          placeholder={paletteOpen === "notes" ? "Switch to note…" : "Type a command or note…"}
          emptyText={paletteOpen === "notes" ? "No matching notes" : "No matches"}
          prefix={{
            char: ">",
            label: "commands",
            items: commandOnly,
            placeholder: "Type a command…",
            emptyText: "No matching commands",
          }}
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
          explorerTint={explorerTint}
          onExplorerTintChange={(next) => {
            setExplorerTint(next);
            persistAppearance({ explorerTint: next });
          }}
          popupScale={popupScale}
          onPopupScaleChange={setPopupScale}
          keybinds={keybinds}
          onSetKeybind={setKeybind}
          summonHotkey={summonHotkey}
          onChangeSummonHotkey={(chord) => void changeSummonHotkey(chord)}
          defaultNoteType={defaultNoteType}
          onDefaultNoteTypeChange={setDefaultNoteType}
          openFilesExternally={openFilesExternally}
          onOpenFilesExternallyChange={setOpenFilesExternally}
          section={settingsOpen}
          onClose={() => {
            setSettingsOpen(null);
            editorRef.current?.focus();
          }}
        />
      )}
      {aboutOpen && (
        <About
          onClose={() => {
            setAboutOpen(false);
            editorRef.current?.focus();
          }}
        />
      )}
      {closeAskTab && (
        <CloseConfirm
          label={closeAskTab.name ? fileOf(closeAskTab.name) : "Untitled note"}
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
