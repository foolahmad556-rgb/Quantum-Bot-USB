import { auth } from './firebase.ts';

const API_BASE_URL = (import.meta.env.VITE_API_URL || 'https://5uq4nr.bot-keep.xyz').replace(/\/$/, '');

function resolveApiUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `${API_BASE_URL}${url}`;
}

export async function fetchWithAuth(url: string, options: RequestInit = {}) {
  if (!auth) {
    throw new Error('Firebase authentication is not configured');
  }

  const user = auth.currentUser;
  if (!user) {
    throw new Error('User not authenticated');
  }

  const token = await user.getIdToken();
  const headers = {
    ...options.headers,
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

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
