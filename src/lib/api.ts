import { supabase } from "./supabase.ts";

/** An API error with a short code (translated with errorMessage in src/i18n). */
export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}

export async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {};
}

/** Calls the API as the signed-in user. */
export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await apiFetch(method, path, body);
  const data = res.status === 204 ? undefined : await res.json().catch(() => undefined);
  if (!res.ok) throw new ApiError((data as { error?: string })?.error ?? `http_${res.status}`, res.status);
  return data as T;
}

export async function apiFetch(method: string, path: string, body?: unknown, signal?: AbortSignal) {
  return fetch(path, {
    method,
    headers: { ...(await authHeader()), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
}
