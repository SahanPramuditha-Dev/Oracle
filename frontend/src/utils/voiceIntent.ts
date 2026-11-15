export type VoiceIntentName =
  | 'open_map'
  | 'close_map'
  | 'open_camera'
  | 'close_camera'
  | 'open_settings'
  | 'unknown';

export interface VoiceIntent {
  name: VoiceIntentName;
  confidence: number;
  normalizedText: string;
  requiresClarification: boolean;
}

const normalize = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Remove only explicit address/politeness wrappers; never guess the destination.
export function normalizeVoiceCommand(text: string): string {
  let command = normalize(text);
  let previous: string;
  do {
    previous = command;
    command = command
      .replace(/^(?:(?:hey|hi|ok|okay)\s+)?oracle(?:\s+|$)/, '')
      .replace(/^(?:please|can you|could you|would you)\s+/, '')
      .replace(/\s+please$/, '').trim();
  } while (command !== previous);
  return command;
}

const commands = [
  ['open_map', /^(?:(?:open|show|display|launch|view|activate|enter|bring up) )?(?:the )?(?:tactical )?(?:geo )?(?:map|maps|atlas|spatial intelligence)(?: (?:view|mode))?$/],
  ['close_map', /^(?:close|hide|exit|minimize) (?:the )?(?:tactical )?(?:geo )?(?:map|maps|atlas)$/],
  ['open_settings', /^(?:open|show|display|launch|view|bring up) (?:the )?(?:system )?settings$/],
  ['open_camera', /^(?:open|show|start|turn on|enable) (?:the )?camera$/],
  ['close_camera', /^(?:close|stop|turn off|disable) (?:the )?camera$/],
] as const;

export const commandEvents = {
  open_map: 'oracle_activate_atlas_protocol',
  close_map: 'oracle_close_atlas_protocol',
  open_settings: 'oracle_open_settings',
  open_camera: 'oracle_open_camera',
  close_camera: 'oracle_close_camera',
} satisfies Record<Exclude<VoiceIntentName, 'unknown'>, string>;

export function interpretVoiceIntent(text: string): VoiceIntent {
  const normalizedText = normalize(text);
  const command = normalizeVoiceCommand(normalizedText);

  const match = commands.find(([, pattern]) => pattern.test(command));
  if (match) {
    return { name: match[0], confidence: 0.99, normalizedText, requiresClarification: false };
  }

  // A short, ambiguous transcript must not be silently mapped to a sensitive action.
  if (/^(?:open|show|launch|view|activate|enter)(?: it| at| mat| up| that| this)?$/.test(command)) {
    return { name: 'unknown', confidence: 0.35, normalizedText, requiresClarification: true };
  }

  return { name: 'unknown', confidence: 0, normalizedText, requiresClarification: false };
}
