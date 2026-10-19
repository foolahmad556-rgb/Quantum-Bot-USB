const API_BASE_URL = (import.meta.env?.VITE_API_URL || '').replace(/\/$/, '');

export function resolveApiUrl(url: string): string {
  if (/^https?:\/\//i.test(url) || url.startsWith('//')) throw new Error('Authenticated API paths must be relative');
  return `${API_BASE_URL}${url}`;
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
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
  }

  return response.json();
}

export function authenticatedApiFetch(url: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  const token = localStorage.getItem('auth_token');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(resolveApiUrl(url), { ...options, headers });
}
