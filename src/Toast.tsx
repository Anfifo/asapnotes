import { ToastItem } from "./toasts";

interface ToastStackProps {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}

/** Bottom-right stack, newest at the bottom. Click anywhere on a toast to
 * dismiss it early — there is nothing else to do with one. */
export function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast toast-${t.kind}`}
          role="status"
          data-tip="Click to dismiss"
          onClick={() => onDismiss(t.id)}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
