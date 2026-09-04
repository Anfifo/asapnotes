import { useState } from "react";
import { defaultMeetingName } from "./meetingTime";
import * as api from "./notes";

interface StartMeetingProps {
  projects: string[];
  mounts: api.MountInfo[];
  /** Folder offered first — the last one a meeting went to. */
  defaultFolder: string;
  /** Create the note and start recording the chosen sides; a rejection stays
   * in the dialog. */
  onStart: (folder: string, name: string, mic: boolean, system: boolean) => Promise<void>;
  onClose: () => void;
}

/** The one question between the meeting button and a running recording:
 * what the note is called, which folder it lands in, and which sides to
 * capture. Everything is prefilled, so Enter on an untouched dialog is a
 * valid answer. Both sides start checked every time and the choice is not
 * remembered: a mic-only pick carried over to the next meeting would drop
 * the other voices without anyone noticing until afterwards. */
export function StartMeeting({
  projects,
  mounts,
  defaultFolder,
  onStart,
  onClose,
}: StartMeetingProps) {
  const folders = [
    "",
    ...projects,
    ...mounts.filter((m) => !m.conflicted && !m.missing).map((m) => `${m.project}/${m.at}`),
  ];
  const [name, setName] = useState(defaultMeetingName());
  const [folder, setFolder] = useState(folders.includes(defaultFolder) ? defaultFolder : "");
  const [mic, setMic] = useState(true);
  const [system, setSystem] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canStart = name.trim().length > 0 && (mic || system) && !busy;

  const submit = async () => {
    if (!canStart) return;
    setBusy(true);
    setError(null);
    try {
      await onStart(folder, name.trim(), mic, system);
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  };

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="settings" onClick={(e) => e.stopPropagation()}>
        <h1>New meeting</h1>
        <p className="meeting-hint">
          Records each chosen source as its own audio file in the note&rsquo;s assets.
        </p>
        <h2>Note name</h2>
        <input
          className="np-name"
          autoFocus
          value={name}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") void submit();
            else if (e.key === "Escape") onClose();
          }}
        />
        <h2>Folder</h2>
        <select
          className="np-name meeting-folder"
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") onClose();
          }}
        >
          {folders.map((f) => (
            <option key={f} value={f}>
              {f === "" ? "Notes root" : f}
            </option>
          ))}
        </select>
        <h2>Sources</h2>
        <label className="np-check">
          <input type="checkbox" checked={mic} onChange={(e) => setMic(e.target.checked)} />
          Microphone
        </label>
        <label className="np-check">
          <input type="checkbox" checked={system} onChange={(e) => setSystem(e.target.checked)} />
          Computer sound
        </label>
        {!mic && !system && <p className="scan-error">Pick at least one source.</p>}
        {error && <p className="scan-error">{error}</p>}
        <div className="scan-actions">
          <button className="tool-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="tool-btn scan-add" disabled={!canStart} onClick={() => void submit()}>
            Start recording
          </button>
        </div>
      </div>
    </div>
  );
}
