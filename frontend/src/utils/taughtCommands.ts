import { interpretVoiceIntent, normalizeVoiceCommand } from './voiceIntent';

const storageKey = 'oracle_taught_commands';
const legacyKey = 'oracle_taught_atlas_phrases';
export const taughtCommandsChanged = 'oracle_taught_commands_changed';

export const taughtActionLabels = {
  open_map: 'Open Atlas',
  close_map: 'Close Atlas',
  open_camera: 'Open camera',
  close_camera: 'Close camera',
  launch_pet: 'Launch Oracle Pet',
} as const;

export type TaughtAction = keyof typeof taughtActionLabels;
export type TaughtCommand = { phrase: string; action: TaughtAction };

function phraseKey(phrase: string): string {
  return phrase.normalize('NFKC').toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim();
}

function actionFor(text: string): TaughtAction | null {
  const intent = interpretVoiceIntent(text).name;
  if (intent !== 'unknown' && intent !== 'open_settings') return intent;
  if (/^(?:open|launch|start|run) (?:the )?(?:oracle pet|desktop pet|pet)$/.test(phraseKey(text))) return 'launch_pet';
  return null;
}

export function isPetLaunchCommand(text: string): boolean {
  return actionFor(normalizeVoiceCommand(text)) === 'launch_pet';
}

export function parseTeachingRequest(text: string): TaughtCommand | null | undefined {
  const request = /^(?:oracle[,\s]+)?(?:please\s+)?when i say\s+(.+)$/i.exec(text.trim());
  if (!request) return undefined;
  const mapping = /^(?:"([^"]+)"|“([^”]+)”|([^,]+?))\s*,?\s+(?:please\s+)?((?:open|show|launch|display|view|activate|close|hide|exit|minimize|start|stop|run|turn on|turn off)\s+.+)$/i.exec(request[1]);
  if (!mapping) return null;
  const action = actionFor(mapping[4]);
  const phrase = (mapping[1] ?? mapping[2] ?? mapping[3]).replace(/,\s*$/, '').trim();
  return action && phrase ? { phrase, action } : null;
}

export function loadTaughtCommands(storage: Storage = localStorage): TaughtCommand[] {
  const stored = storage.getItem(storageKey);
  if (stored === null) {
    const legacy: unknown = JSON.parse(storage.getItem(legacyKey) ?? '[]');
    if (!Array.isArray(legacy)) return [];
    return legacy.filter((item): item is string => typeof item === 'string')
      .map(phrase => ({ phrase, action: 'open_map' }));
  }
  const value: unknown = JSON.parse(stored);
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is TaughtCommand =>
    item && typeof item.phrase === 'string' && typeof item.action === 'string' &&
    Object.hasOwn(taughtActionLabels, item.action),
  );
}

export function findTaughtCommand(text: string, storage: Storage = localStorage): TaughtCommand | undefined {
  const key = normalizeVoiceCommand(text);
  try {
    return key ? loadTaughtCommands(storage).find(item => normalizeVoiceCommand(item.phrase) === key) : undefined;
  } catch {
    return undefined;
  }
}

export function changeTaughtCommand(previous: string | null, replacement: TaughtCommand | null, storage: Storage = localStorage): TaughtCommand[] {
  const commands = loadTaughtCommands(storage);
  if (previous !== null && !commands.some(item => item.phrase === previous)) throw new Error('That phrase is no longer saved.');
  const remaining = commands.filter(item => item.phrase !== previous);
  if (replacement !== null) {
    const phrase = replacement.phrase.trim();
    const key = normalizeVoiceCommand(phrase);
    const intent = interpretVoiceIntent(phrase);
    if (phrase.length > 100 || key.length < 3) throw new Error('Use a phrase between 3 and 100 characters.');
    if (actionFor(phrase) || intent.name !== 'unknown' || intent.requiresClarification || /^(?:when i say|oracle|confirm|cancel|yes|no|stop)\b/.test(key)) {
      throw new Error('Choose a phrase that is distinct from an existing command.');
    }
    if (remaining.some(item => normalizeVoiceCommand(item.phrase) === key)) throw new Error('That phrase is already saved.');
    remaining.push({ ...replacement, phrase });
  }
  storage.setItem(storageKey, JSON.stringify(remaining));
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(taughtCommandsChanged));
  return remaining;
}
