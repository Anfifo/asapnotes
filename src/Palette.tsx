import { useEffect, useMemo, useRef, useState } from "react";

export interface PaletteItem {
  /** Note/draft file name (`*.md`) — the id used against the backend. */
  id: string;
  label: string;
  /** e.g. "draft" / "unsaved edits" */
  detail?: string;
  /** false = untitled draft that has no saved note yet */
  isNote: boolean;
}

interface PaletteProps {
  items: PaletteItem[];
  onSelect: (item: PaletteItem) => void;
  onClose: () => void;
}

export function Palette({ items, onSelect, onClose }: PaletteProps) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((i) => i.label.toLowerCase().includes(q)) : items;
  }, [items, query]);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => setIndex(0), [query]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[index]) onSelect(filtered[index]);
    }
  };

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          placeholder="Switch to note…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <ul>
          {filtered.map((item, i) => (
            <li
              key={item.id}
              className={i === index ? "selected" : ""}
              onMouseEnter={() => setIndex(i)}
              onClick={() => onSelect(item)}
            >
              <span>{item.label}</span>
              {item.detail && <span className="muted">{item.detail}</span>}
            </li>
          ))}
          {filtered.length === 0 && <li className="muted empty">No matching notes</li>}
        </ul>
      </div>
    </div>
  );
}
