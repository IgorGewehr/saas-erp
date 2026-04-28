import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  Firestore,
} from 'firebase/firestore';
import { getStorage, FirebaseStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'demo-api-key',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'demo.firebaseapp.com',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'demo-project',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'demo.appspot.com',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '000000000000',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '1:000000000000:web:0000000000000000',
};

// Use globalThis to persist instances across Next.js HMR module re-evaluations.
// Without this, each hot-reload creates a new module scope while the previous
// Firestore instance still has active listeners, causing "INTERNAL ASSERTION
// FAILED: Unexpected state" in Firebase 11+.
const g = globalThis as typeof globalThis & {
  _fb_app?: FirebaseApp;
  _fb_auth?: Auth;
  _fb_db?: Firestore;
  _fb_storage?: FirebaseStorage;
};

if (!g._fb_app) {
  g._fb_app = getApps().length ? getApp() : initializeApp(firebaseConfig);
}
if (!g._fb_auth) g._fb_auth = getAuth(g._fb_app);
if (!g._fb_db) {
  // Use initializeFirestore only on first call (before getFirestore would lock the instance).
  // persistentLocalCache stores snapshots in IndexedDB — second visit loads from cache
  // in <50ms instead of waiting for a network round trip.
  try {
    g._fb_db = initializeFirestore(g._fb_app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    // Firestore already initialized (e.g. HMR re-evaluation) — fall back to getFirestore
    g._fb_db = getFirestore(g._fb_app);
  }
}
if (!g._fb_storage) g._fb_storage = getStorage(g._fb_app);

export const app     = g._fb_app;
export const auth    = g._fb_auth;
export const db      = g._fb_db;
export const storage = g._fb_storage;
