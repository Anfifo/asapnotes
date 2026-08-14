export interface WelcomeAction {
  label: string;
  detail?: string;
  run: () => void;
}

export interface WelcomeRecent {
  id: string;
  label: string;
  detail?: string;
  isNote: boolean;
}

interface WelcomePanelProps {
  actions: WelcomeAction[];
  recent: WelcomeRecent[];
  /** The primer rows — built by the app from the effective keybinds, so a
   * rebound chord is what first-run orientation teaches. */
  shortcuts: [string, string][];
  onOpenRecent: (id: string, isNote: boolean) => void;
}

/** The deliberate zero-tab state: main actions as clickable rows, the most
 * recent notes, and a shortcuts primer — so it doubles as first-run
 * orientation. It only ever follows closing the last tab; summoning past it
 * lands in a fresh note, so capture stays instant. */
export function WelcomePanel({ actions, recent, shortcuts, onOpenRecent }: WelcomePanelProps) {
  return (
    <div className="welcome">
      <div className="welcome-inner">
        <h1>asapnotes</h1>
        <p className="welcome-tag">Instant-capture markdown notes</p>
        <div className="welcome-section">Start</div>
        <ul className="welcome-list">
          {actions.map((a) => (
            <li key={a.label}>
              <button onClick={a.run}>
                <span className="welcome-label">{a.label}</span>
                {a.detail && <span className="welcome-detail">{a.detail}</span>}
              </button>
            </li>
          ))}
        </ul>
        {recent.length > 0 && (
          <>
            <div className="welcome-section">Recent</div>
            <ul className="welcome-list">
              {recent.map((r) => (
                <li key={r.id}>
                  <button onClick={() => onOpenRecent(r.id, r.isNote)}>
                    <span className="welcome-label">{r.label}</span>
                    {r.detail && <span className="welcome-detail">{r.detail}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="welcome-section">Shortcuts</div>
        <div className="welcome-keys">
          {shortcuts.map(([keys, what]) => (
            <div key={keys}>
              <kbd>{keys}</kbd>
              <span>{what}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
