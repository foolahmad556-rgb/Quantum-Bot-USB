import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { initializeFirestore, doc, getDocFromServer } from 'firebase/firestore';

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

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
}, firebaseConfig.firestoreDatabaseId);
export const googleAuthProvider = new GoogleAuthProvider();

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    // Gracefully handle connection status without alarming error logs
    console.info("Firestore operating in standalone or offline mode.");
  }
}
testConnection();
