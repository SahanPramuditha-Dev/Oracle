import { OracleSelect } from './OracleSelect';
import { useState } from 'react';
import { readReplyPreferences, replyOptions, saveReplyPreferences, type ReplyPreferenceField } from '../utils/replyPreferences';

const fields: Record<ReplyPreferenceField, string> = { tone: 'Tone', language: 'Language', length: 'Reply length' };

export function ReplyPreferencesPane() {
  const [preferences, setPreferences] = useState(readReplyPreferences);
  const [error, setError] = useState('');

  function update(field: ReplyPreferenceField, value: string) {
    const next = readReplyPreferences();
    if (value) Object.assign(next, { [field]: value });
    else delete next[field];
    try {
      saveReplyPreferences(next);
      setPreferences(next);
      setError('');
    } catch {
      setError('Could not save reply preferences in this browser.');
    }
  }

  return (
    <section className="settings-tile" aria-label="Reply preferences">
      <div className="settings-tile-info">
        <div className="settings-tile-title">Reply preferences</div>
        <div className="settings-tile-desc">Applies to new AI chat replies. Changes save automatically in this browser.</div>
      </div>
      {(Object.keys(fields) as ReplyPreferenceField[]).map(field => (
        <div className="settings-field settings-field-inline" key={field}>
          <label htmlFor={`reply-preference-${field}`}>{fields[field]}</label>
          <OracleSelect
            id={`reply-preference-${field}`}
            aria-label={fields[field]}
            value={preferences[field] ?? ''}
            onChange={value => update(field, value)}
            options={[
              { value: '', label: 'Use profile default' },
              ...Object.entries(replyOptions[field]).map(([value, label]) => ({ value, label })),
            ]}
          />
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
