import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

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

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || appletConfig.apiKey,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || appletConfig.authDomain,
  projectId: env.VITE_FIREBASE_PROJECT_ID || appletConfig.projectId,
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

/** True when the config still holds the checked-in placeholder values. */
export const isFirebaseConfigured = !firebaseConfig.apiKey.startsWith('REPLACE_WITH');
