const historyKey = 'oracle_command_history';
const enabledKey = 'oracle_command_history_enabled';
export const commandHistoryChanged = 'oracle_command_history_changed';

export type CommandAttempt = {
  id: string;
  at: number;
  transcript: string;
  submitted: string;
  interpretation: string;
  outcome: string;
};

export function commandHistoryEnabled(): boolean {
  return localStorage.getItem(enabledKey) === 'true';
}

export function readCommandHistory(): CommandAttempt[] {
  const stored: unknown = JSON.parse(localStorage.getItem(historyKey) ?? '[]');
  return Array.isArray(stored) ? stored : [];
}

export function setCommandHistoryEnabled(enabled: boolean): void {
  localStorage.setItem(enabledKey, String(enabled));
}

export function clearCommandHistory(): void {
  localStorage.removeItem(historyKey);
  window.dispatchEvent(new Event(commandHistoryChanged));
}

export function recordCommandAttempt(transcript: string | undefined, submitted: string, interpretation: string, outcome: string): string | undefined {
  if (!transcript) return;
  try {
    if (!commandHistoryEnabled()) return;
    const id = crypto.randomUUID();
    const attempt = { id, at: Date.now(), transcript: transcript.slice(0, 200), submitted: submitted.slice(0, 200), interpretation, outcome };
    localStorage.setItem(historyKey, JSON.stringify([attempt, ...readCommandHistory()].slice(0, 30)));
    window.dispatchEvent(new Event(commandHistoryChanged));
    return id;
  } catch {
    return undefined;
  }
}

export function updateCommandOutcome(id: string | undefined, outcome: string): void {
  if (!id) return;
  try {
    const attempts = readCommandHistory();
    if (!attempts.some(attempt => attempt.id === id && attempt.outcome !== outcome)) return;
    localStorage.setItem(historyKey, JSON.stringify(attempts.map(attempt => attempt.id === id ? { ...attempt, outcome } : attempt)));
    window.dispatchEvent(new Event(commandHistoryChanged));
  } catch {
    // A history write must not interrupt command execution.
  }
}
