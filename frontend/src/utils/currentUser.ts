import { useSyncExternalStore } from 'react';
import { fetchWithAuth } from './api';

// Recognized profile for presentation; this does not authorize backend actions.
export interface CurrentUser { id: string; name: string; permission: string; }
let current: CurrentUser | null = null;
let refreshing: CurrentUser | null = null;
const listeners = new Set<() => void>();
export const getCurrentUser = () => current;
export function setCurrentUser(user: CurrentUser | null) {
  if (current === user || (current && user && current.id === user.id &&
    current.name === user.name && current.permission === user.permission)) return;
  current = user;
  listeners.forEach(listener => listener());
}
export function useCurrentUser() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, getCurrentUser);
}
export async function refreshCurrentUser() {
  const snapshot = current;
  if (!snapshot || refreshing === snapshot) return;
  refreshing = snapshot;
  try {
    const response = await fetchWithAuth('/api/v1/people', { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return;
    const data = await response.json();
    if (current !== snapshot) return;
    const person = data.people?.find((person: CurrentUser) => person.id === snapshot.id);
    if (!person || person.permission === 'disabled' || person.enrollment_state === 'revoked') setCurrentUser(null);
    else setCurrentUser({id: person.id, name: person.name, permission: person.permission === 'administrator' ? 'administrator' : 'standard'});
  } catch { /* Connection failures do not imply profile deletion. */ }
  finally { if (refreshing === snapshot) refreshing = null; }
}
