import { ReactNode, useEffect, useRef, useState } from "react";
import { searchNotes, SearchHit, SEARCH_LIMIT } from "./notes";
import { errText } from "./toasts";
import { fileOf, projectOf } from "./paths";

/** Debounce: long enough that typing a word is one scan, short enough to feel live. */
const DEBOUNCE_MS = 180;
/** Below this, results are noise — "a" matches everything. */
const MIN_QUERY = 2;

interface Group {
  note: string;
  hits: SearchHit[];
}

/** Group consecutive hits by note; the backend already emits them note by note. */
function groupByNote(hits: SearchHit[]): Group[] {
  const out: Group[] = [];
  for (const hit of hits) {
    const last = out[out.length - 1];
    if (last?.note === hit.note) last.hits.push(hit);
    else out.push({ note: hit.note, hits: [hit] });
  }
  return out;
}

/** Highlight every case-insensitive occurrence of `query` in `text`. */
function highlight(text: string, query: string): ReactNode[] {
  const out: ReactNode[] = [];
  const hay = text.toLowerCase();
  const needle = query.toLowerCase();
  let from = 0;
  for (;;) {
    const at = hay.indexOf(needle, from);
    if (at < 0) break;
    if (at > from) out.push(text.slice(from, at));
    out.push(
      <mark key={at} className="hit">
        {text.slice(at, at + needle.length)}
      </mark>,
    );
    from = at + needle.length;
  }
  out.push(text.slice(from));
  return out;
}

interface SearchViewProps {
  /** Bumped by App every time Ctrl+Shift+F fires — refocuses and selects the box. */
  focusToken: number;
  /** Open a note and put the cursor on `line`. */
  onOpenHit: (note: string, line: number) => void;
  /** Surface a failed scan — otherwise it reads as "no results". */
  onError: (message: string) => void;
  /** The workspace's filter: hits in notes it rejects are dropped. Absent
   * means every note. The scan itself stays whole-corpus, so switching
   * workspaces never re-runs it. */
  inScope?: (note: string) => boolean;
}

/** Content search across every note (Ctrl+Shift+F): query box on
 * top, matches grouped under the note they live in. */
export function SearchView({ focusToken, onOpenHit, onError, inScope }: SearchViewProps) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Only the newest scan may write state — a slow one must not overwrite it.
  const runRef = useRef(0);
  // Held in a ref, not an effect dep: App passes a fresh arrow every render,
  // and a dep on it would reset the debounce timer on unrelated re-renders.
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusToken]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY) {
      runRef.current++;
      setHits(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    const run = ++runRef.current;
    const timer = window.setTimeout(() => {
      void searchNotes(q)
        .then((r) => {
          if (runRef.current === run) {
            setHits(r);
            setBusy(false);
          }
        })
        .catch((err: unknown) => {
          if (runRef.current === run) {
            setHits([]);
            setBusy(false);
            onErrorRef.current(errText(err));
          }
        });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  const shown = hits && inScope ? hits.filter((h) => inScope(h.note)) : hits;
  const groups = shown ? groupByNote(shown) : [];

  return (
    <div className="search-view">
      <input
        ref={inputRef}
        className="search-input"
        value={query}
        placeholder="Search in notes…"
        spellCheck={false}
        onChange={(e) => setQuery(e.target.value)}
      />
      {shown !== null && hits !== null && (
        <p className="search-count muted">
          {shown.length === 0
            ? "No results"
            : `${shown.length}${hits.length === SEARCH_LIMIT ? "+" : ""} ${
                shown.length === 1 ? "result" : "results"
              } in ${groups.length} ${groups.length === 1 ? "note" : "notes"}`}
          {busy && " · searching…"}
        </p>
      )}
      {hits === null && busy && <p className="search-count muted">Searching…</p>}
      <div className="search-results">
        {groups.map((g) => (
          <details key={g.note} open>
            <summary>
              <span className="explorer-name">{fileOf(g.note)}</span>
              {projectOf(g.note) && <span className="explorer-detail">{projectOf(g.note)}</span>}
            </summary>
            <ul>
              {g.hits.map((h) => (
                <li
                  key={h.line}
                  onClick={() => onOpenHit(h.note, h.line)}
                  data-tip={`Line ${h.line}: ${h.text}`}
                >
                  <span className="search-line">{h.line}</span>
                  <span className="search-text">{highlight(h.text, query.trim())}</span>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </div>
  );
}
