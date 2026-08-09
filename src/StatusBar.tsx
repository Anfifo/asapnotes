import { useEffect, useState } from "react";
import { EditorStatus } from "./Editor";

interface StatusBarProps {
  /** Subscribes to editor status updates directly — routing them through App
   * state would re-render the whole tree on every keystroke / cursor move. */
  register: (cb: ((s: EditorStatus) => void) | null) => void;
  /** Summon→paint latency — the product's one number, always visible. */
  summonMs: number | null;
  zoom: number;
}

/** Slim VSCode-style bar on the window's dark chrome: cursor position,
 * selection size, word count; zoom and summon latency on the right. */
export function StatusBar({ register, summonMs, zoom }: StatusBarProps) {
  const [status, setStatus] = useState<EditorStatus | null>(null);

  useEffect(() => {
    register(setStatus);
    return () => register(null);
  }, [register]);

  return (
    <footer className="statusbar">
      {status && (
        <>
          <span>
            Ln {status.line}, Col {status.col}
          </span>
          {status.selected > 0 && <span>{status.selected} selected</span>}
          <span>
            {status.words} {status.words === 1 ? "word" : "words"}
          </span>
        </>
      )}
      <span className="statusbar-spacer" />
      {zoom !== 1 && <span title="Zoom (Ctrl+0 resets)">{Math.round(zoom * 100)}%</span>}
      {summonMs !== null && <span title="summon → paint">{summonMs} ms</span>}
    </footer>
  );
}
