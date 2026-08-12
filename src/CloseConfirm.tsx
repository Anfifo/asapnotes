interface CloseConfirmProps {
  /** Display name of the tab being closed. */
  label: string;
  /** Never saved as a note — the wording changes, the choices don't. */
  untitled: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

/** Three-way stop before a tab holding unsaved content closes: Save, Discard
 * (the draft goes to the recycle bin — recoverability is the safety net, the
 * dialog talks about what happens), or Cancel. In-app because the native
 * dialog is two-button. */
export function CloseConfirm({ label, untitled, onSave, onDiscard, onCancel }: CloseConfirmProps) {
  return (
    <div
      className="palette-backdrop"
      onClick={onCancel}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
        // The dialog owns the keyboard while it is up — no app shortcuts.
        e.stopPropagation();
      }}
    >
      <div className="settings close-confirm" onClick={(e) => e.stopPropagation()}>
        <h1>Unsaved changes</h1>
        <p>
          {untitled
            ? `"${label}" hasn't been saved as a note yet. Closing it without saving discards what you wrote.`
            : `"${label}" has changes that aren't saved. Closing it without saving discards them.`}
        </p>
        <div className="scan-actions">
          <button className="tool-btn close-discard" onClick={onDiscard}>
            Discard
          </button>
          <button className="tool-btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="tool-btn scan-add" autoFocus onClick={onSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
