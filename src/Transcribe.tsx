import { useEffect, useState } from "react";
import * as api from "./notes";
import { fileOf } from "./paths";
import { formatElapsed } from "./meetingTime";
import { COMMON_LANGUAGES, languageName, WHISPER_LANGUAGES } from "./whisperLanguages";

const mb = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`;

interface DownloadButtonProps {
  what: string;
  bytes: number | null;
  download: api.TranscriptionDownload | null;
  onDownload: (what: string) => void;
  onCancel: () => void;
}

/** "Download (488 MB)", turning into the figure so far and a cancel while its
 * own download runs. Any other download in flight disables it: one at a time. */
function DownloadButton({ what, bytes, download, onDownload, onCancel }: DownloadButtonProps) {
  if (download?.what === what) {
    const pct = download.total > 0 ? Math.floor((download.received / download.total) * 100) : null;
    return (
      <span className="tx-progress">
        {pct === null ? mb(download.received) : `${pct}%`}
        <button className="tool-btn" onClick={onCancel}>
          Cancel
        </button>
      </span>
    );
  }
  return (
    <button className="tool-btn" disabled={download !== null} onClick={() => onDownload(what)}>
      Download{bytes ? ` (${mb(bytes)})` : ""}
    </button>
  );
}

interface TranscriptionSetupProps {
  status: api.TranscriptionStatus;
  onDownload: (what: string) => void;
  onCancelDownload: () => void;
  /** Settings offers removal; the dialog does not. */
  onRemove?: (what: string) => void;
  /** The dialog picks a model here; Settings only lists them. */
  selected?: string;
  onSelect?: (id: string) => void;
}

/** The add-on's parts as one table: the engine, then the models. Each row
 * says whether it is on disk and offers the one action that applies. */
export function TranscriptionSetup({
  status,
  onDownload,
  onCancelDownload,
  onRemove,
  selected,
  onSelect,
}: TranscriptionSetupProps) {
  const engine = status.engine;
  const download = (what: string, bytes: number | null) => (
    <DownloadButton
      what={what}
      bytes={bytes}
      download={status.download}
      onDownload={onDownload}
      onCancel={onCancelDownload}
    />
  );
  return (
    <>
      <table>
        <tbody>
          <tr>
            <td>Engine</td>
            <td>
              <span className={engine ? "mcp-dot ok" : "mcp-dot bad"} />
              {engine
                ? engine.installed
                  ? "Installed"
                  : "Development build, beside the app"
                : "Not installed"}
            </td>
            <td className="tx-action">
              {engine
                ? engine.installed &&
                  onRemove && (
                    <button className="tool-btn" onClick={() => onRemove("engine")}>
                      Remove
                    </button>
                  )
                : status.engine_downloadable && download("engine", status.engine_bytes)}
            </td>
          </tr>
          {status.models.map((m) => (
            <tr key={m.id} className={onSelect ? "tx-pick" : undefined}>
              <td>
                {onSelect ? (
                  <label>
                    <input
                      type="radio"
                      name="tx-model"
                      checked={selected === m.id}
                      disabled={!m.installed}
                      onChange={() => onSelect(m.id)}
                    />
                    {m.label}
                  </label>
                ) : (
                  m.label
                )}
              </td>
              <td className="muted">{m.detail}</td>
              <td className="tx-action">
                {m.installed ? (
                  onRemove ? (
                    <button className="tool-btn" onClick={() => onRemove(m.id)}>
                      Remove
                    </button>
                  ) : (
                    <span className="muted">{mb(m.bytes)}</span>
                  )
                ) : (
                  download(m.id, m.bytes)
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!engine && !status.engine_downloadable && (
        <p className="settings-note">
          This build has no engine release to download. Build one with{" "}
          <code>cargo build --features transcribe --bin asapnotes-transcribe</code> in{" "}
          <code>src-tauri</code>; the app finds it beside its own executable.
        </p>
      )}
    </>
  );
}

interface TranscribeDialogProps {
  recording: api.MeetingRecording;
  status: api.TranscriptionStatus;
  /** What the last run used; the language is still a question every time. */
  defaultLanguage: string;
  defaultModel: string;
  onDownload: (what: string) => void;
  onCancelDownload: () => void;
  /** Start the run; a rejection stays in the dialog. */
  onStart: (language: string, model: string) => Promise<void>;
  onClose: () => void;
}

/** The questions between a recording and its transcript: which language was
 * spoken, and which model to run. The language has no automatic option; the
 * model guesses it badly, and a wrong guess is a transcript in the wrong
 * language. Missing parts of the add-on are downloadable from here, so a first
 * run does not detour through Settings. */
export function TranscribeDialog({
  recording,
  status,
  defaultLanguage,
  defaultModel,
  onDownload,
  onCancelDownload,
  onStart,
  onClose,
}: TranscribeDialogProps) {
  const installed = (id: string) => status.models.some((m) => m.id === id && m.installed);
  const [language, setLanguage] = useState(defaultLanguage);
  const [model, setModel] = useState(() =>
    installed(defaultModel) ? defaultModel : (status.models.find((m) => m.installed)?.id ?? ""),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A model downloaded from this dialog becomes the pick when nothing was.
  useEffect(() => {
    if (!installed(model)) setModel(status.models.find((m) => m.installed)?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.models]);

  const canStart =
    status.engine !== null && language !== "" && installed(model) && !status.job && !busy;

  const submit = async () => {
    if (!canStart) return;
    setBusy(true);
    setError(null);
    try {
      await onStart(language, model);
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  };

  const common = WHISPER_LANGUAGES.slice(0, COMMON_LANGUAGES);
  const rest = WHISPER_LANGUAGES.slice(COMMON_LANGUAGES)
    .map((code) => [code, languageName(code)] as const)
    .sort((a, b) => a[1].localeCompare(b[1]));

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="settings" onClick={(e) => e.stopPropagation()}>
        <h1>Transcribe</h1>
        <p className="meeting-hint">
          {fileOf(recording.note)}
          {recording.seconds !== null && `, ${formatElapsed(recording.seconds)}`}. Runs on this
          computer; the transcript becomes a note beside this one.
        </p>
        <h2>Language spoken</h2>
        <select
          className="np-name meeting-folder"
          autoFocus
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") void submit();
            else if (e.key === "Escape") onClose();
          }}
        >
          <option value="" disabled>
            Pick the language of the meeting
          </option>
          <optgroup label="Common">
            {common.map((code) => (
              <option key={code} value={code}>
                {languageName(code)}
              </option>
            ))}
          </optgroup>
          <optgroup label="All languages">
            {rest.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </optgroup>
        </select>
        <h2>Model</h2>
        <TranscriptionSetup
          status={status}
          selected={model}
          onSelect={setModel}
          onDownload={onDownload}
          onCancelDownload={onCancelDownload}
        />
        {status.job && (
          <p className="scan-error">Another transcription is running; wait for it to finish.</p>
        )}
        {error && <p className="scan-error">{error}</p>}
        <div className="scan-actions">
          <button className="tool-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="tool-btn scan-add" disabled={!canStart} onClick={() => void submit()}>
            Transcribe
          </button>
        </div>
      </div>
    </div>
  );
}
