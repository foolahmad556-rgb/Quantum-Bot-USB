import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

// Service account JSON from the runtime environment (never committed).
function loadCredentials(): Record<string, any> | null {
  const raw = process.env.FIREBASE_CREDENTIALS_JSON;
  if (!raw) {
    console.warn('FIREBASE_CREDENTIALS_JSON not set; Firebase Admin uses default init.');
    return null;
  }
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error('FIREBASE_CREDENTIALS_JSON is not valid JSON.');
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    console.error('FIREBASE_CREDENTIALS_JSON is not a valid object.');
    return null;
  }
  const missing = ['project_id', 'client_email', 'private_key'].filter(k => !(k in parsed));
  if (missing.length > 0) {
    console.error(`FIREBASE_CREDENTIALS_JSON missing required fields: ${missing.join(', ')}`);
    return null;
  }
  if (typeof parsed.private_key === 'string') {
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  }
  return parsed;
}

const creds = loadCredentials();

function initApp(): App {
  const existing = getApps();
  if (existing.length) return existing[0];
  if (creds) {
    return initializeApp({ credential: cert(creds as any), projectId: creds.project_id });
  }
  return initializeApp();
}

export const adminAuth = getAuth(initApp());
