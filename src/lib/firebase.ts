import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, Auth } from 'firebase/auth';
import { initializeFirestore, Firestore, doc, getDocFromServer } from 'firebase/firestore';

// Read Firebase config from Vite environment variables (VITE_ prefix required).
// On Cloudflare Pages: Settings -> Environment Variables.
const env = (import.meta as any).env ?? {};

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID,
};

const hasUsableConfig = Boolean(
  firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId
);

// Standalone mode stubs — UI mounts and runs without Firebase.
let auth: Auth | null = null;
let db: Firestore | null = null;
let googleAuthProvider: GoogleAuthProvider | null = null;

if (hasUsableConfig) {
  try {
    const app: FirebaseApp = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true }, env.VITE_FIREBASE_FIRESTORE_DB_ID);
    googleAuthProvider = new GoogleAuthProvider();
  } catch (e) {
    console.warn('[firebase] init failed, standalone mode:', e);
  }
} else {
  console.info('[firebase] No VITE_FIREBASE_* env vars — standalone mode.');
}

export { auth, db, googleAuthProvider };
export const firebaseEnabled = hasUsableConfig;

async function testConnection() {
  if (!db) return;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch {
    console.info('Firestore operating in standalone or offline mode.');
  }
}
testConnection();
