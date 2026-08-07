import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open as openFolderDialog } from "@tauri-apps/plugin-dialog";
import Editor, { EditorHandle, FormatKind } from "./Editor";
import { Explorer } from "./Explorer";
import { MenuBar, MenuDef, MenuEntry } from "./MenuBar";
import { fileOf, projectOf, resolvePath, subdirOf } from "./paths";
import { Preview } from "./Preview";
import { Palette, PaletteItem } from "./Palette";
import { ScanProjects } from "./ScanProjects";
import { Settings } from "./Settings";
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

const FORMAT_GROUPS: { kind: FormatKind; glyph: string; title: string }[][] = [
  [
    { kind: "h1", glyph: "H1", title: "Heading 1" },
    { kind: "h2", glyph: "H2", title: "Heading 2" },
    { kind: "h3", glyph: "H3", title: "Heading 3" },
  ],
  [
    { kind: "bold", glyph: "B", title: "Bold (Ctrl+B)" },
    { kind: "italic", glyph: "I", title: "Italic (Ctrl+I)" },
  ],
  [
    { kind: "code", glyph: "<>", title: "Inline code" },
    { kind: "codeblock", glyph: "```", title: "Code block" },
  ],
  [
    { kind: "bullet", glyph: "•", title: "Bullet list" },
    { kind: "numbered", glyph: "1.", title: "Numbered list" },
    { kind: "quote", glyph: "❝", title: "Quote" },
  ],
  [{ kind: "link", glyph: "🔗", title: "Link" }],
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

const validFileName = (name: string) =>
  name.length > 0 && !name.startsWith(".") && !/[<>:"/\\|?*]/.test(name);

const validProjectName = (name: string) => validFileName(name) && name !== "assets";

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
  const [notes, setNotes] = useState<api.FileInfo[]>([]);
  const [drafts, setDrafts] = useState<api.FileInfo[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  // External projects: name → absolute folder path, linked in place.
  const [externals, setExternals] = useState<Record<string, string>>({});
  const [scanResults, setScanResults] = useState<api.ProjectCandidate[] | null>(null);
  const [rootPath, setRootPath] = useState("");
  const [open, setOpen] = useState<OpenNote | null>(null);
  const [docKey, setDocKey] = useState("");
  const [initialDoc, setInitialDoc] = useState("");
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [paletteOpen, setPaletteOpen] = useState<"notes" | "commands" | null>(null);
  // Pinned = docked beside the editor; survives restarts. Unpinned the panel
  // floats over the editor and closes on select / Esc / click-away.
  const [explorerPinned, setExplorerPinnedState] = useState(
    () => localStorage.getItem("explorerPinned") === "1",
  );
  const [explorerOpen, setExplorerOpen] = useState(explorerPinned);
  const setExplorerPinned = (pinned: boolean) => {
    setExplorerPinnedState(pinned);
    localStorage.setItem("explorerPinned", pinned ? "1" : "0");
  };
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [toolbarOpen, setToolbarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [summonMs, setSummonMs] = useState<number | null>(null);

  const editorRef = useRef<EditorHandle>(null);
  const contentRef = useRef("");
  const openRef = useRef<OpenNote | null>(null);
  openRef.current = open;
  const notesRef = useRef<api.FileInfo[]>([]);
  notesRef.current = notes;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const externalsRef = useRef<Record<string, string>>({});
  externalsRef.current = externals;
  const noteDirRef = useRef("");
  const autosaveTimer = useRef<number | null>(null);

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

  const showDoc = useCallback((note: OpenNote, content: string, isDirty: boolean) => {
    contentRef.current = content;
    setOpen(note);
    setInitialDoc(content);
    setDocKey(note.id);
    setDirty(isDirty);
    setMode("edit");
    setPaletteOpen(null);
  }, []);

  const newNote = useCallback(async () => {
    await flushDraft();
    showDoc({ id: `untitled-${Date.now()}.md`, name: null }, "", false);
  }, [flushDraft, showDoc]);

  const openItem = useCallback(
    async (item: { id: string; isNote: boolean }, draftIds: Set<string>) => {
      await flushDraft();
      const hasDraft = draftIds.has(item.id);
      const content = hasDraft ? await api.readDraft(item.id) : await api.readNote(item.id);
      showDoc({ id: item.id, name: item.isNote ? item.id : null }, content, hasDraft);
      editorRef.current?.focus();
    },
    [flushDraft, showDoc],
  );

  const save = useCallback(async (asName?: string) => {
    const cur = openRef.current;
    if (!cur) return;
    cancelAutosave();
    const doc = contentRef.current;
    if (!cur.name && !asName && doc.trim() === "") return;
    let name = cur.name ?? asName ?? null;
    if (!name) {
      const project = projectOf(cur.id);
      const taken = new Set(notesRef.current.map((n) => n.name.toLowerCase()));
      name = deriveName(doc, project ? `${project}/` : "", taken);
    }
    await api.saveNote(name, doc);
    await api.deleteDraft(cur.id);
    setDrafts((d) => d.filter((x) => x.name !== cur.id));
    setOpen({ id: name, name });
    setDirty(false);
    setNotes(await api.listNotes());
  }, []);

  /** Move the open note (or retarget the open untitled draft) to a project. */
  const changeProject = useCallback(async (target: string | null) => {
    const cur = openRef.current;
    if (!cur || target === projectOf(cur.id)) return;
    const newId = (target ? `${target}/` : "") + fileOf(cur.id);
    if (cur.name) {
      try {
        await api.moveNote(cur.name, newId);
      } catch (err) {
        console.error("move failed:", err);
        return;
      }
      setOpen({ id: newId, name: newId });
      setNotes(await api.listNotes());
      setDrafts(await api.listDrafts());
    } else {
      cancelAutosave();
      await api.deleteDraft(cur.id);
      setOpen({ id: newId, name: null });
      if (contentRef.current.trim() !== "") await api.writeDraft(newId, contentRef.current);
      setDrafts(await api.listDrafts());
    }
    if (target) setProjects((ps) => (ps.includes(target) ? ps : [...ps, target].sort()));
    editorRef.current?.focus();
  }, []);

  const togglePreview = useCallback(() => {
    if (!openRef.current) return;
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

  /** Note-relative link to a saved asset path (`assets/x.png`). External
   * projects keep assets in their own folder, so only the note's depth below
   * the project root matters; root-project notes climb one level to the
   * shared root `assets/`. */
  const assetLink = useCallback((rel: string) => {
    const cur = openRef.current;
    if (!cur) return rel;
    const segments = cur.id.split("/");
    if (segments.length === 1) return rel;
    const ups = externalsRef.current[segments[0]] ? segments.length - 2 : 1;
    return "../".repeat(ups) + rel;
  }, []);

  /** Persist a pasted image and hand back the note-relative link path. */
  const pasteImage = useCallback(
    async (file: File): Promise<string | null> => {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let ext = file.type.split("/")[1] ?? "png";
        if (ext === "jpeg") ext = "jpg";
        if (ext === "svg+xml") ext = "svg";
        const cur = openRef.current;
        const rel = await api.saveAsset(bytes, ext, cur ? projectOf(cur.id) : null);
        return assetLink(rel);
      } catch (err) {
        console.error("image paste failed:", err);
        return null;
      }
    },
    [assetLink],
  );

  // Startup: recover the most recent draft; else open the most recent note;
  // else start on a blank capture.
  useEffect(() => {
    void (async () => {
      const [ns, ds, ps, ext, root] = await Promise.all([
        api.listNotes(),
        api.listDrafts(),
        api.listProjects(),
        api.listExternalProjects(),
        api.notesRootPath(),
      ]);
      setNotes(ns);
      setDrafts(ds);
      setProjects(ps);
      setExternals(ext);
      setRootPath(root);
      if (ds.length > 0) {
        const draft = ds[0];
        const isNamed = ns.some((n) => n.name === draft.name);
        const content = await api.readDraft(draft.name);
        showDoc({ id: draft.name, name: isNamed ? draft.name : null }, content, true);
      } else if (ns.length > 0) {
        const content = await api.readNote(ns[0].name);
        showDoc({ id: ns[0].name, name: ns[0].name }, content, false);
      } else {
        showDoc({ id: `untitled-${Date.now()}.md`, name: null }, "", false);
      }
    })();
  }, [showDoc]);

  // Dropped image files are intercepted by Tauri (we get paths, not File
  // objects): copy them into assets/ and insert the link at the cursor.
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent(async (event) => {
      if (event.payload.type !== "drop" || modeRef.current !== "edit") return;
      for (const path of event.payload.paths) {
        if (!IMAGE_FILE.test(path)) continue;
        try {
          const cur = openRef.current;
          const rel = await api.importAsset(path, cur ? projectOf(cur.id) : null);
          editorRef.current?.insertText(`![](${assetLink(rel)})\n`);
        } catch (err) {
          console.error("image drop failed:", err);
        }
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [assetLink]);

  // File → Scan folder for projects: pick a folder, find README-marked
  // subfolders, confirm in a sheet, link them in place as external projects.
  const refreshProjects = useCallback(async () => {
    const [ns, ps, ext] = await Promise.all([
      api.listNotes(),
      api.listProjects(),
      api.listExternalProjects(),
    ]);
    setNotes(ns);
    setProjects(ps);
    setExternals(ext);
  }, []);

  const scanForProjects = useCallback(async () => {
    const dir = await openFolderDialog({ directory: true, title: "Scan a folder for projects" });
    if (typeof dir !== "string") return;
    try {
      setScanResults(await api.scanProjects(dir));
    } catch (err) {
      console.error("scan failed:", err);
    }
  }, []);

  const addScannedProjects = useCallback(
    async (chosen: { name: string; path: string }[]) => {
      await api.addExternalProjects(chosen);
      setScanResults(null);
      await refreshProjects();
    },
    [refreshProjects],
  );

  const removeExternalProject = useCallback(
    async (name: string) => {
      await api.removeExternalProject(name);
      await refreshProjects();
    },
    [refreshProjects],
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
    } else if (mod && key === "n") {
      e.preventDefault();
      void newNote();
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
    } else if (mod && key === "e") {
      e.preventDefault();
      togglePreview();
    } else if (e.key === "Escape") {
      if (document.querySelector(".menu-drop")) {
        // An open menubar dropdown owns Esc (MenuBar closes it).
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
      } else if (explorerOpen && !explorerPinned) {
        // Only when floating — pinned, the explorer is furniture and Esc
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
    if (!explorerOpen || explorerPinned) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element;
      if (!t.closest(".explorer") && !t.closest(".rail")) setExplorerOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [explorerOpen, explorerPinned]);

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

  // The open note's real directory (for resolving relative image links) — an
  // external project's base is its mapped folder, and deep notes add subdirs.
  const currentProject = open ? projectOf(open.id) : null;
  const projectBase = currentProject
    ? (externals[currentProject] ?? `${rootPath}/${currentProject}`)
    : rootPath;
  const noteSubdir = open ? subdirOf(open.id) : "";
  const noteDir = noteSubdir ? `${projectBase}/${noteSubdir}` : projectBase;
  noteDirRef.current = noteDir;

  const submitNewProject = () => {
    const name = newProjectName.trim();
    setCreatingProject(false);
    setNewProjectName("");
    if (validProjectName(name)) void changeProject(name);
  };

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
    const newId = (project ? `${project}/` : "") + `${base}.md`;
    if (newId === cur.name) return;
    if (notesRef.current.some((n) => n.name.toLowerCase() === newId.toLowerCase())) {
      console.error(`rename failed: ${newId} already exists`);
      return;
    }
    void (async () => {
      if (cur.name) {
        try {
          await api.moveNote(cur.name, newId);
        } catch (err) {
          console.error("rename failed:", err);
          return;
        }
        setOpen({ id: newId, name: newId });
        setNotes(await api.listNotes());
        setDrafts(await api.listDrafts());
      } else {
        await save(newId);
      }
    })();
  };

  // Ctrl+K: Claude-style palette — commands first (New note on top), recent
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
      id: "cmd:preview",
      label: mode === "edit" ? "Open preview" : "Back to editor",
      detail: "Ctrl+E",
      run: togglePreview,
    },
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
    ...FORMAT_GROUPS.flat().map((f) => ({
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
  // actions the palette exposes.
  const editMenuItems: MenuEntry[] = FORMAT_GROUPS.flatMap((group, i) => [
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
    { label: "Edit", items: editMenuItems },
    {
      label: "View",
      items: [
        {
          label: mode === "edit" ? "Open preview" : "Back to editor",
          detail: "Ctrl+E",
          run: togglePreview,
        },
        {
          label: explorerOpen ? "Hide explorer" : "Show explorer",
          detail: "Ctrl+Shift+E",
          run: () => setExplorerOpen((o) => !o),
        },
        {
          label: toolbarOpen ? "Hide formatting toolbar" : "Show formatting toolbar",
          run: () => setToolbarOpen((o) => !o),
        },
        "sep",
        { label: "Command palette", detail: "Ctrl+K", run: () => setPaletteOpen("commands") },
        { label: "Switch note", detail: "Ctrl+P", run: () => setPaletteOpen("notes") },
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
    if (!explorerPinned) setExplorerOpen(false);
  };

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

  return (
    <div className="app">
      <MenuBar menus={menus} onHide={hideWindow} />
      <div className="app-body">
        <button
          className="rail"
          title={explorerOpen ? "Close explorer (Ctrl+Shift+E)" : "Open explorer (Ctrl+Shift+E)"}
          onClick={() => setExplorerOpen((o) => !o)}
        >
          {explorerOpen ? "‹" : "›"}
        </button>
        {explorerOpen && (
          <Explorer
            notes={notes}
            drafts={drafts}
            projects={projects}
            openId={open?.id ?? null}
            onSelect={openFromExplorer}
            pinned={explorerPinned}
            onTogglePin={() => setExplorerPinned(!explorerPinned)}
          />
        )}
        <div className="main">
          <header className="titlebar">
            <div className="title-line">
              {renaming ? (
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
                <span className="title" title="Click to rename" onClick={startRename}>
                  {open?.name ? fileOf(open.name).replace(/\.md$/, "") : "Untitled"}
                </span>
              )}
              {dirty && (
                <span className="dirty" title="Unsaved — autosaved as draft. Ctrl+S to save.">
                  ●
                </span>
              )}
            </div>
            {creatingProject ? (
              <input
                className="project-input"
                autoFocus
                value={newProjectName}
                placeholder="project name…"
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitNewProject();
                }}
                onBlur={() => setCreatingProject(false)}
              />
            ) : (
              <select
                className="project-select"
                value={currentProject ?? ""}
                onChange={(e) => {
                  if (e.target.value === "__new") setCreatingProject(true);
                  else void changeProject(e.target.value === "" ? null : e.target.value);
                }}
              >
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
                <option value="__new">+ New project…</option>
              </select>
            )}
            {mode === "edit" && (
              <button
                className={toolbarOpen ? "tool-btn open" : "tool-btn"}
                title="Formatting"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setToolbarOpen((o) => !o)}
              >
                Aa
              </button>
            )}
          </header>
          {mode === "edit" && toolbarOpen && (
            <div className="toolbar">
              {FORMAT_GROUPS.map((group, i) => (
                <div className="toolbar-group" key={i}>
                  {group.map((f) => (
                    <button
                      key={f.kind}
                      className={`fmt-${f.kind}`}
                      title={f.title}
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
          {open && (
            <Editor
              ref={editorRef}
              docKey={docKey}
              initialDoc={initialDoc}
              onChange={handleChange}
              onPasteImage={pasteImage}
              resolveImage={resolveImage}
              hidden={mode === "preview"}
            />
          )}
          {open && mode === "preview" && <Preview doc={initialDoc} noteDir={noteDir} />}
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
      {settingsOpen && (
        <Settings
          rootPath={rootPath}
          externalProjects={externals}
          onRemoveProject={(name) => void removeExternalProject(name)}
          onClose={() => {
            setSettingsOpen(false);
            editorRef.current?.focus();
          }}
        />
      )}
      {summonMs !== null && (
        <span className="latency" title="summon → paint">
          {summonMs} ms
        </span>
      )}
    </div>
  );
}

export default App;
