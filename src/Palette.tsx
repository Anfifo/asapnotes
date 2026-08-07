import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { fuzzyMatch } from "./fuzzy";

export interface PaletteItem {
  /** Stable identity; note entries use the note's file name. */
  id: string;
  label: string;
  /** e.g. "draft" / "unsaved edits" / a shortcut hint */
  detail?: string;
  /** Group header shown above this item while the query is empty. */
  section?: string;
}

interface PaletteProps<T extends PaletteItem> {
  items: T[];
  placeholder: string;
  emptyText: string;
  onSelect: (item: T) => void;
  onClose: () => void;
}

function Highlight({ text, indices }: { text: string; indices: number[] }) {
  if (indices.length === 0) return <span>{text}</span>;
  const hit = new Set(indices);
  return <span>{text.split("").map((ch, i) => (hit.has(i) ? <b key={i}>{ch}</b> : ch))}</span>;
}

export function Palette<T extends PaletteItem>({
  items,
  placeholder,
  emptyText,
  onSelect,
  onClose,
}: PaletteProps<T>) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Empty query keeps the caller's order; typing fuzzy-ranks (stable sort, so
  // equal scores also keep the caller's order).
  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return items.map((item) => ({ item, indices: [] as number[], score: 0 }));
    return items
      .flatMap((item) => {
        const m = fuzzyMatch(q, item.label);
        return m ? [{ item, indices: m.indices, score: m.score }] : [];
      })
      .sort((a, b) => b.score - a.score);
  }, [items, query]);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    setIndex(0);
    listRef.current?.scrollTo(0, 0);
  }, [query]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[index]) onSelect(filtered[index].item);
    }
  };

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          placeholder={placeholder}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <ul ref={listRef}>
          {filtered.map(({ item, indices }, i) => (
            <Fragment key={item.id}>
              {query.trim() === "" &&
                item.section &&
                filtered[i - 1]?.item.section !== item.section && (
                  <li className="section">{item.section}</li>
                )}
              <li
                className={i === index ? "selected" : ""}
                // Keep the arrow-key selection in view; no-op while visible.
                ref={i === index ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
                onMouseEnter={() => setIndex(i)}
                onClick={() => onSelect(item)}
              >
                <Highlight text={item.label} indices={indices} />
                {item.detail && <span className="muted">{item.detail}</span>}
              </li>
            </Fragment>
          ))}
          {filtered.length === 0 && <li className="muted empty">{emptyText}</li>}
        </ul>
        <footer className="palette-footer">
          <span>
            <kbd>↑↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> select
          </span>
          <span>
            <kbd>Esc</kbd> close
          </span>
        </footer>
      </div>
    </div>
  );
}
