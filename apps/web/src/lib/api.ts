export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiRequestError extends Error {
  constructor(public status: number, public code: string, message: string, public correlationId?: string) {
    super(message);
  }
}

/** Fired when the session is missing or expired, so the app can show the login screen. */
export const UNAUTHORIZED_EVENT = 'glitch:unauthorized';

async function handle<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  if (res.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = body?.error;
    throw new ApiRequestError(res.status, err?.code ?? 'HTTP_ERROR', err?.message ?? `HTTP ${res.status}`, err?.correlationId);
  }
  return body as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  return handle<T>(await fetch(`${API_URL}${path}`, { cache: 'no-store', credentials: 'include' }));
}

export async function apiSend<T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown, contentType = 'application/json'): Promise<T> {
  const isRaw = body instanceof Blob || typeof body === 'string';
  return handle<T>(
    await fetch(`${API_URL}${path}`, {
      method,
      credentials: 'include',
      headers: body === undefined ? {} : { 'content-type': contentType },
      body: body === undefined ? undefined : isRaw ? (body as BodyInit) : JSON.stringify(body)
    })
  );
}

export const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString('es-MX'));
export const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
export const fmtDate = (d: string | null | undefined) => (d ? new Date(d).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
