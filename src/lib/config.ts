export function getApiBaseUrl(): string {
  const envUrl = import.meta.env.VITE_API_URL as string | undefined;
  if (envUrl && envUrl.trim().length > 0) {
    return envUrl.replace(/\/+$/, '');
  }
  return '';
}

export function getWsUrl(): string {
  const envWs = import.meta.env.VITE_WS_URL as string | undefined;
  if (envWs && envWs.trim().length > 0) {
    return envWs;
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

export async function apiFetch<T>(path: string, options?: RequestInit & { token?: string | null }): Promise<T> {
  const base = getApiBaseUrl();
  const headers = new Headers(options?.headers);
  if (!headers.has('Content-Type') && options?.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (options?.token) {
    headers.set('Authorization', `Bearer ${options.token}`);
  }
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as T;
}
