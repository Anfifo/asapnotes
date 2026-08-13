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

const SHORTCUTS: [string, string][] = [
  ["Ctrl+Alt+A", "Summon / hide from anywhere"],
  ["Ctrl+N", "New note"],
  ["Ctrl+P", "Switch note"],
  ["Ctrl+K", "Command palette"],
  ["Ctrl+Shift+F", "Search in notes"],
  ["Esc", "Hide window"],
];

interface WelcomePanelProps {
  actions: WelcomeAction[];
  recent: WelcomeRecent[];
  onOpenRecent: (id: string, isNote: boolean) => void;
}

/** The deliberate zero-tab state: main actions as clickable rows, the most
 * recent notes, and a shortcuts primer — so it doubles as first-run
 * orientation. It only ever follows closing the last tab; summoning past it
 * lands in a fresh note, so capture stays instant. */
export function WelcomePanel({ actions, recent, onOpenRecent }: WelcomePanelProps) {
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
          {SHORTCUTS.map(([keys, what]) => (
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
