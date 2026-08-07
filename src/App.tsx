import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { convertFileSrc } from "@tauri-apps/api/core";
import Editor, { EditorHandle, FormatKind } from "./Editor";
import { resolvePath } from "./paths";
import { Preview } from "./Preview";
import { Palette, PaletteItem } from "./Palette";
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

const fileOf = (path: string) => path.split("/").pop() ?? path;
const projectOf = (path: string) => (path.includes("/") ? path.split("/")[0] : null);

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
  const [rootPath, setRootPath] = useState("");
  const [open, setOpen] = useState<OpenNote | null>(null);
  const [docKey, setDocKey] = useState("");
  const [initialDoc, setInitialDoc] = useState("");
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [toolbarOpen, setToolbarOpen] = useState(false);
  const [hintsOpen, setHintsOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [summonMs, setSummonMs] = useState<number | null>(null);

  const editorRef = useRef<EditorHandle>(null);
  const hintsRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef("");
  const openRef = useRef<OpenNote | null>(null);
  openRef.current = open;
  const notesRef = useRef<api.FileInfo[]>([]);
  notesRef.current = notes;
  const modeRef = useRef(mode);
  modeRef.current = mode;
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
    setPaletteOpen(false);
  }, []);

  const newNote = useCallback(async () => {
    await flushDraft();
    showDoc({ id: `untitled-${Date.now()}.md`, name: null }, "", false);
  }, [flushDraft, showDoc]);

  const openItem = useCallback(
    async (item: PaletteItem, draftIds: Set<string>) => {
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

  /** Resolve a relative image src against the open note's directory (for live preview). */
  const resolveImage = useCallback(
    (src: string) =>
      /^[a-z][a-z0-9+.-]*:/i.test(src) ? src : convertFileSrc(resolvePath(noteDirRef.current, src)),
    [],
  );

  /** Persist a pasted image and hand back the note-relative link path. */
  const pasteImage = useCallback(async (file: File): Promise<string | null> => {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let ext = file.type.split("/")[1] ?? "png";
      if (ext === "jpeg") ext = "jpg";
      if (ext === "svg+xml") ext = "svg";
      const rel = await api.saveAsset(bytes, ext);
      const cur = openRef.current;
      return cur && projectOf(cur.id) ? `../${rel}` : rel;
    } catch (err) {
      console.error("image paste failed:", err);
      return null;
    }
  }, []);

  // Startup: recover the most recent draft; else open the most recent note;
  // else start on a blank capture.
  useEffect(() => {
    void (async () => {
      const [ns, ds, ps, root] = await Promise.all([
        api.listNotes(),
        api.listDrafts(),
        api.listProjects(),
        api.notesRootPath(),
      ]);
      setNotes(ns);
      setDrafts(ds);
      setProjects(ps);
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
          const rel = await api.importAsset(path);
          const cur = openRef.current;
          const link = cur && projectOf(cur.id) ? `../${rel}` : rel;
          editorRef.current?.insertText(`![](${link})\n`);
        } catch (err) {
          console.error("image drop failed:", err);
        }
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

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
      setPaletteOpen((o) => !o);
      if (paletteOpen) editorRef.current?.focus();
    } else if (mod && key === "e") {
      e.preventDefault();
      if (!open) return;
      if (mode === "edit") {
        setInitialDoc(contentRef.current);
        setMode("preview");
      } else {
        setMode("edit");
      }
    } else if (e.key === "Escape") {
      if (renaming) {
        setRenaming(false);
        editorRef.current?.focus();
      } else if (hintsOpen) {
        setHintsOpen(false);
        editorRef.current?.focus();
      } else if (creatingProject) {
        setCreatingProject(false);
        editorRef.current?.focus();
      } else if (paletteOpen) {
        setPaletteOpen(false);
        editorRef.current?.focus();
      } else if (!document.querySelector(".editor .cm-panel")) {
        // With the search panel open, Escape falls through to CodeMirror,
        // which closes the panel instead of hiding the window.
        void flushDraft();
        void getCurrentWindow().hide();
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

  // Shortcuts popover closes on any click outside it.
  useEffect(() => {
    if (!hintsOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!hintsRef.current?.contains(e.target as Node)) setHintsOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [hintsOpen]);

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
  const paletteItems: PaletteItem[] = [
    ...notes.map((n) => ({
      id: n.name,
      label: n.name.replace(/\.md$/, ""),
      detail: draftIds.has(n.name) ? "unsaved edits" : undefined,
      isNote: true,
    })),
    ...drafts
      .filter((d) => !noteNames.has(d.name))
      .map((d) => ({
        id: d.name,
        label: d.name.replace(/\.md$/, ""),
        detail: "draft",
        isNote: false,
      })),
  ];

  const currentProject = open ? projectOf(open.id) : null;
  const noteDir = currentProject ? `${rootPath}/${currentProject}` : rootPath;
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

  return (
    <div className="app">
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
        </div>
        <div className="hints" ref={hintsRef}>
          <button
            className={hintsOpen ? "tool-btn open" : "tool-btn"}
            title="Keyboard shortcuts"
            onClick={() => setHintsOpen((o) => !o)}
          >
            ?
          </button>
          {hintsOpen && (
            <div className="hints-panel">
              <kbd>Ctrl+E</kbd>
              <span>Preview ⇄ edit</span>
              <kbd>Ctrl+K</kbd>
              <span>Switch note</span>
              <kbd>Ctrl+N</kbd>
              <span>New note</span>
              <kbd>Ctrl+S</kbd>
              <span>Save</span>
              <kbd>Ctrl+B</kbd>
              <span>Bold</span>
              <kbd>Ctrl+I</kbd>
              <span>Italic</span>
              <kbd>Ctrl+Z / Y</kbd>
              <span>Undo / redo</span>
              <kbd>Ctrl+F</kbd>
              <span>Find</span>
              <kbd>Esc</kbd>
              <span>Hide window</span>
              {summonMs !== null && <span className="latency">summon → paint {summonMs} ms</span>}
            </div>
          )}
        </div>
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
      {paletteOpen && (
        <Palette
          items={paletteItems}
          onSelect={(item) => void openItem(item, draftIds)}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </div>
  );
}

export default App;
