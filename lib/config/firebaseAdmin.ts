import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getAuth, Auth } from 'firebase-admin/auth';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { getStorage, Storage } from 'firebase-admin/storage';

let adminApp: App;
let adminAuth: Auth;
let adminDb: Firestore;
let adminStorage: Storage;

function getAdminApp(): App {
  if (getApps().length > 0) {
    return getApps()[0];
  }

  // Storage bucket — same one the client SDK uses. Defaulting to
  // `<projectId>.appspot.com` if the env var is missing keeps Firebase Storage
  // calls working in dev without extra config.
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
    || (projectId ? `${projectId}.appspot.com` : undefined);

  // Option 1: Service account JSON via env var
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (serviceAccount) {
    try {
      const parsed = JSON.parse(serviceAccount);
      return initializeApp({ credential: cert(parsed), storageBucket });
    } catch {
      console.error('[Firebase Admin] Failed to parse FIREBASE_SERVICE_ACCOUNT');
    }
  }

  // Option 2: Individual env vars
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (projectId && clientEmail && privateKey) {
    return initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
      storageBucket,
    });
  }

  // Option 3: Default credentials (GCP environments, emulator)
  return initializeApp({ projectId: projectId || 'demo-project', storageBucket });
}

adminApp = getAdminApp();
adminAuth = getAuth(adminApp);
adminDb = getFirestore(adminApp);
adminStorage = getStorage(adminApp);

export { adminApp, adminAuth, adminDb, adminStorage };
