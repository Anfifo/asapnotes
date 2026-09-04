import { useEffect, useState } from "react";
import { formatElapsed } from "./meetingTime";

interface MeetingChipProps {
  /** When the recording started (epoch ms) — the chip keeps its own clock. */
  startedAt: number;
  onStop: () => void;
}

/** Titlebar chip shown while a meeting records: a pulsing dot and the elapsed
 * time. The whole chip is the stop button — a running recording must be one
 * glance to see and one click to end. */
export function MeetingChip({ startedAt, onStop }: MeetingChipProps) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  return (
    <button
      className="rec-chip"
      aria-label="Stop the meeting recording"
      data-tip="Stop the meeting recording"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onStop}
    >
      <span className="rec-dot" />
      {formatElapsed(seconds)}
    </button>
  );
}
