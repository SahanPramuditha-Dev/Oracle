/**
 * Shared authenticated API request helper for ORACLE frontend.
 */

let session: Promise<void> | null = null;
let adminGrant: { credential: string; deadline: number } | null = null;
let adminExpiry: ReturnType<typeof setTimeout> | undefined;
const adminListeners = new Set<() => void>();

export const hasAdminGrant = () => adminGrant !== null && performance.now() < adminGrant.deadline;

export function subscribeToAdminGrant(listener: () => void) {
  adminListeners.add(listener);
  return () => { adminListeners.delete(listener); };
}

function clearAdminGrant() {
  if (!adminGrant) return;
  clearTimeout(adminExpiry);
  adminGrant = null;
  adminListeners.forEach(listener => listener());
}

export function acceptAdminGrant(credential: string, expiresInSeconds: number) {
  const previous = adminGrant?.credential;
  clearTimeout(adminExpiry);
  adminGrant = { credential, deadline: performance.now() + expiresInSeconds * 1000 };
  adminExpiry = setTimeout(clearAdminGrant, expiresInSeconds * 1000);
  adminListeners.forEach(listener => listener());
  if (previous) void revokeAdminCredential(previous).catch(() => {});
}

async function revokeAdminCredential(credential: string) {
  const response = await fetchWithAuth('/api/v1/admin/grant', {
    method: 'DELETE', headers: { 'X-Oracle-Admin-Grant': credential }, signal: AbortSignal.timeout(5000)
  });
  await readJson(response);
}

export async function revokeAdminGrant() {
  const credential = adminGrant?.credential;
  clearAdminGrant();
  if (credential) await revokeAdminCredential(credential);
}

async function ensureSession(): Promise<void> {
  if (!session) session = fetch('/api/v1/auth/session', {
    headers: { 'X-Oracle-Client': 'web' }, credentials: 'same-origin', signal: AbortSignal.timeout(10000)
  }).then(response => {
    if (!response.ok) throw new Error('Local session unavailable. Check the backend connection.');
  }).catch(error => { session = null; throw error; });
  return session;
}
export async function fetchWithAuth(url: string, init: RequestInit = {}): Promise<Response> {
  await ensureSession();
  if (init.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  const headers = new Headers(init.headers); headers.set('X-Oracle-Client', 'web');
  if (url.startsWith('/api/v1/people/') && hasAdminGrant() && adminGrant && !headers.has('X-Oracle-Admin-Grant')) {
    headers.set('X-Oracle-Admin-Grant', adminGrant.credential);
  }
  const response = await fetch(url, { ...init, headers, credentials: 'same-origin',
    signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(90000)]) : AbortSignal.timeout(90000) });
  if (response.status === 401) session = null;
  if (response.status === 403 && adminGrant && headers.get('X-Oracle-Admin-Grant') === adminGrant.credential) {
    const error = await response.clone().json().catch(() => null);
    if (error?.detail === 'Active Administrator Protocol clearance required') clearAdminGrant();
  }
  return response;
}
export async function readJson<T>(response: Response): Promise<T> {
  let data;
  try { data = await response.json(); } catch { throw new Error('The local service returned an unreadable response.'); }
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : data.message || `Request failed (${response.status}).`);
  return data as T;
}
export async function localApi<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  return readJson<T>(await fetchWithAuth(`/api/v1/${path}`, { method, signal,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) }));
}
