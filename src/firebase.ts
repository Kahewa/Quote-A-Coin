import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, GoogleAuthProvider } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';

import appletConfig from '@/firebase-applet-config.json';

/**
 * Firebase initialisation.
 *
 * The web config ships in the client bundle, which is normal for Firebase web
 * apps — it identifies the project, it does not authorise anything. All data
 * protection comes from `firestore.rules`.
 *
 * Values come from `firebase-applet-config.json` and can be overridden per
 * environment with `VITE_FIREBASE_*` variables.
 */
const env = import.meta.env;

/**
 * Demo mode. With `VITE_USE_EMULATORS=true` the app talks to the local Firebase
 * Emulator Suite instead of Google's servers: no cloud project, no billing, no
 * network. See `npm run demo`.
 */
export const usingEmulators = env.VITE_USE_EMULATORS === 'true';

/** Offline-only project ID. The `demo-` prefix is what makes it credential-free. */
const DEMO_PROJECT_ID = 'demo-quote-a-coin';

const configuredProjectId =
  env.VITE_FIREBASE_PROJECT_ID || appletConfig.projectId;

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || appletConfig.apiKey,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || appletConfig.authDomain,
  projectId: usingEmulators
    ? // The emulator's project ID has to match .firebaserc, and the checked-in
      // config is still a placeholder until someone wires up a real project.
      configuredProjectId.startsWith('REPLACE_WITH')
      ? DEMO_PROJECT_ID
      : configuredProjectId
    : configuredProjectId,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || appletConfig.storageBucket,
  messagingSenderId:
    env.VITE_FIREBASE_MESSAGING_SENDER_ID || appletConfig.messagingSenderId,
  appId: env.VITE_FIREBASE_APP_ID || appletConfig.appId,
};

/**
 * The project uses a *named* Firestore database rather than `(default)`, so the
 * ID has to be passed explicitly to `getFirestore`.
 */
const databaseId = env.VITE_FIREBASE_DATABASE_ID || appletConfig.databaseId;

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, databaseId);
export const googleProvider = new GoogleAuthProvider();

if (usingEmulators) {
  const host = env.VITE_EMULATOR_HOST || '127.0.0.1';
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8080);
}

/**
 * True once the config carries something other than the checked-in placeholder
 * values. Used to explain a dead "Continue with Google" button during setup.
 */
export const isFirebaseConfigured =
  usingEmulators || !firebaseConfig.apiKey.startsWith('REPLACE_WITH');
