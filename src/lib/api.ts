const API_BASE_URL = (import.meta.env?.VITE_API_URL || '').replace(/\/$/, '');

export function resolveApiUrl(url: string): string {
  if (/^https?:\/\//i.test(url) || url.startsWith('//')) throw new Error('Authenticated API paths must be relative');
  return `${API_BASE_URL}${url}`;
}

export async function readJsonResponse<T = any>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error(response.status >= 500
      ? `Backend unavailable (HTTP ${response.status})`
      : `Empty server response (HTTP ${response.status})`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(response.status >= 500
      ? `Backend unavailable (HTTP ${response.status})`
      : `Invalid server response (HTTP ${response.status})`);
  }
}

export async function fetchWithAuth(url: string, options: RequestInit = {}) {
  const token = localStorage.getItem('auth_token');
  if (!token) {
    throw new Error('User not authenticated');
  }

  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Content-Type', 'application/json');

  const response = await fetch(resolveApiUrl(url), {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errorData = await readJsonResponse<{ error?: string }>(response);
    throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
  }

  return readJsonResponse(response);
}

export function authenticatedApiFetch(url: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  const token = localStorage.getItem('auth_token');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(resolveApiUrl(url), { ...options, headers });
}
