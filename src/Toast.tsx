import { ToastItem } from "./toasts";

interface ToastStackProps {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}

/** Bottom-right stack, newest at the bottom. Clicking a toast runs its action,
 * if it has one, and dismisses it. */
export function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast toast-${t.kind}`}
          role="status"
          data-tip={t.action?.tip ?? "Click to dismiss"}
          onClick={() => {
            t.action?.run();
            onDismiss(t.id);
          }}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
