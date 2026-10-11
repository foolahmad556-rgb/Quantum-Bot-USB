import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

// Load Firebase config from environment variable (encrypted at rest, never committed).
// Set FIREBASE_CREDENTIALS_JSON as a Cloudflare Workers Secret or in your environment.
const firebaseConfigStr = process.env.FIREBASE_CREDENTIALS_JSON || '{}';
let firebaseConfig: any;
try {
  firebaseConfig = JSON.parse(firebaseConfigStr);
} catch {
  console.error('FIREBASE_CREDENTIALS_JSON is missing or invalid.');
  firebaseConfig = {};
}

if (!getApps().length) {
  initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

export const adminAuth = getAuth();
