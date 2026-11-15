export const replyOptions = {
  tone: { professional: 'Professional', friendly: 'Friendly', technical: 'Technical' },
  language: { match: 'Match my message', english: 'English', sinhala: 'Sinhala' },
  length: { brief: 'Brief', balanced: 'Balanced', detailed: 'Detailed' },
} as const;

export type ReplyPreferenceField = keyof typeof replyOptions;
export type ReplyPreferences = Partial<{ [Field in ReplyPreferenceField]: keyof typeof replyOptions[Field] }>;

const storageKey = 'oracle_reply_preferences';

export function readReplyPreferences(): ReplyPreferences {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    return Object.fromEntries(Object.entries(replyOptions).flatMap(([field, choices]) => {
      const value = stored?.[field];
      return typeof value === 'string' && Object.prototype.hasOwnProperty.call(choices, value) ? [[field, value]] : [];
    })) as ReplyPreferences;
  } catch {
    return {};
  }
}

export function saveReplyPreferences(preferences: ReplyPreferences): void {
  localStorage.setItem(storageKey, JSON.stringify(preferences));
}
