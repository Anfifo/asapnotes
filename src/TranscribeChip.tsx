interface TranscribeChipProps {
  percent: number;
  onCancel: () => void;
}

/** Titlebar chip shown while a recording is being transcribed: a spinner and
 * how far along it is. The whole chip cancels, like the recording chip stops. */
export function TranscribeChip({ percent, onCancel }: TranscribeChipProps) {
  return (
    <button
      className="rec-chip tx-chip"
      aria-label="Cancel the transcription"
      data-tip={`Transcribing, ${percent}% — click to cancel`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onCancel}
    >
      <span className="tx-spin" />
      {percent}%
    </button>
  );
}
