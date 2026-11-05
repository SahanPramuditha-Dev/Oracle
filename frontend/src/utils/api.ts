/**
 * Shared authenticated API request helper for ORACLE frontend.
 */

let session: Promise<void> | null = null;
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
  const response = await fetch(url, { ...init, headers, credentials: 'same-origin',
    signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(90000)]) : AbortSignal.timeout(90000) });
  if (response.status === 401) session = null;
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
