import { useCallback, useRef, useState } from "react";

export type ToastKind = "error" | "info";

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  /** Runs on click, before the toast dismisses; `tip` says what it does. */
  action?: { run: () => void; tip: string };
}

/** Errors linger — they usually name something the user must redo. */
const DISMISS_MS: Record<ToastKind, number> = { error: 6000, info: 3000 };
/** A toast with an action stays long enough to reach for, such as while an
 * agent that started a recording is still answering. */
const ACTION_MS = 30000;
/** Older toasts drop off the top rather than growing a wall of them. */
const MAX_VISIBLE = 4;

/** The app's one place to surface a failure the user would otherwise never see.
 *
 * A plain hook rather than a context provider: every call site lives in `App`
 * already, so a provider would buy nothing but indirection. */
export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, kind: ToastKind = "error", action?: ToastItem["action"]) => {
      const id = nextId.current++;
      setToasts((ts) => [...ts, { id, kind, message, action }].slice(-MAX_VISIBLE));
      // A stale timer for an already-dismissed toast is a harmless no-op.
      window.setTimeout(() => dismiss(id), action ? ACTION_MS : DISMISS_MS[kind]);
    },
    [dismiss],
  );

  return { toasts, toast, dismiss };
}

/** Turn whatever a rejected Tauri command threw into one readable line. */
export function errText(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return String(err);
}
