import { useSyncExternalStore } from 'react';
import { fetchWithAuth } from './api';

// Recognized profile for presentation; this does not authorize backend actions.
export interface CurrentUser { id: string; name: string; permission: string; }
let current: CurrentUser | null = null;
const listeners = new Set<() => void>();
export const getCurrentUser = () => current;
export function setCurrentUser(user: CurrentUser | null) {
  current = user;
  listeners.forEach(listener => listener());
}
export function useCurrentUser() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, getCurrentUser);
}
export async function refreshCurrentUser() {
  const snapshot = current;
  if (!snapshot) return;
  try {
    const response = await fetchWithAuth('/api/v1/people');
    if (!response.ok) return;
    const data = await response.json();
    if (current !== snapshot) return;
    const person = data.people?.find((person: CurrentUser) => person.id === snapshot.id);
    if (!person || person.permission === 'disabled' || person.enrollment_state === 'revoked') setCurrentUser(null);
    else setCurrentUser({id: person.id, name: person.name, permission: person.permission === 'administrator' ? 'administrator' : 'standard'});
  } catch { /* Connection failures do not imply profile deletion. */ }
}
