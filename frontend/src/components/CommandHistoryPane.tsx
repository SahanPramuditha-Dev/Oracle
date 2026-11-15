import { useEffect, useState } from 'react';
import {
  clearCommandHistory, commandHistoryChanged, commandHistoryEnabled, readCommandHistory,
  setCommandHistoryEnabled, type CommandAttempt,
} from '../utils/commandHistory';
import { changeTaughtCommand, findTaughtCommand, taughtActionLabels, type TaughtAction } from '../utils/taughtCommands';

export function CommandHistoryPane() {
  const [enabled, setEnabled] = useState(false);
  const [attempts, setAttempts] = useState<CommandAttempt[]>([]);
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [phrase, setPhrase] = useState('');
  const [action, setAction] = useState<TaughtAction | ''>('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    function refresh() {
      try {
        setEnabled(commandHistoryEnabled());
        setAttempts(readCommandHistory());
      } catch {
        setStatus('Could not read command history in this browser.');
      }
    }
    refresh();
    window.addEventListener(commandHistoryChanged, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(commandHistoryChanged, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  function changeHistory(update: () => void) {
    try {
      update();
      setStatus('');
    } catch {
      setStatus('Could not update command history in this browser.');
    }
  }

  return (
    <section className="shortcuts-tester-hero" aria-label="Command correction history">
      <div className="pane-title-block">
        <h2>Command history</h2>
        <p>Keep up to 30 recent voice command transcripts in this browser. Turning history off pauses recording.</p>
      </div>
      <div className="shortcuts-row-item">
        <label className="settings-check-label">
          <input type="checkbox" checked={enabled} onChange={event => {
            const checked = event.target.checked;
            changeHistory(() => { setCommandHistoryEnabled(checked); setEnabled(checked); });
          }} />
          Record voice command history
        </label>
        <button type="button" className="settings-action-btn" disabled={!attempts.length} onClick={() => changeHistory(() => {
          clearCommandHistory();
          setCorrecting(null);
        })}>Clear history</button>
      </div>
      {attempts.map(attempt => (
        <details key={attempt.id} className="settings-history-entry">
          <summary>{attempt.interpretation} · {new Date(attempt.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</summary>
          <dl>
            <dt>Heard</dt><dd>{attempt.transcript}</dd>
            {attempt.submitted !== attempt.transcript && <><dt>Submitted</dt><dd>{attempt.submitted}</dd></>}
            <dt>Outcome</dt><dd>{attempt.outcome}</dd>
          </dl>
          {correcting === attempt.id ? (
            <form className="settings-history-form" onSubmit={event => {
              event.preventDefault();
              if (!action) return;
              try {
                const original = findTaughtCommand(attempt.submitted);
                const existing = findTaughtCommand(phrase);
                const previous = original && original.phrase === existing?.phrase ? original.phrase : null;
                changeTaughtCommand(previous, { phrase, action });
                setCorrecting(null);
                setStatus('Correction saved as a taught phrase.');
              } catch (error) {
                setStatus(error instanceof Error ? error.message : 'Could not save the correction.');
              }
            }}>
              <label className="settings-field">Phrase <input className="settings-input" value={phrase} maxLength={100} required onChange={event => setPhrase(event.target.value)} /></label>
              <label className="settings-field">Action <select className="settings-select" value={action} required onChange={event => setAction(event.target.value as TaughtAction | '')}>
                <option value="">Choose an action</option>
                {Object.entries(taughtActionLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select></label>
              <div className="settings-actions">
                <button type="submit" className="settings-action-btn">Save correction</button>
                <button type="button" className="settings-action-btn" onClick={() => { setCorrecting(null); setStatus(''); }}>Cancel</button>
              </div>
            </form>
          ) : (
            <button type="button" className="settings-action-btn" onClick={() => {
              setCorrecting(attempt.id);
              setPhrase(attempt.submitted.slice(0, 100));
              setAction('');
              setStatus('');
            }}>Teach a correction</button>
          )}
        </details>
      ))}
      {!attempts.length && <p>No voice command attempts recorded.</p>}
      {status && <p role="status">{status}</p>}
    </section>
  );
}
