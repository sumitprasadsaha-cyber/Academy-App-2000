import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

export const firebaseConfig = {
  apiKey: "AIzaSyASbswlD6JRb_jEoYE4JVcMsolPyR6t5to",
  authDomain: "academy-connect-500d1.firebaseapp.com",
  projectId: "academy-connect-500d1",
  storageBucket: "academy-connect-500d1.firebasestorage.app",
  messagingSenderId: "835356071946",
  appId: "1:835356071946:web:5450b3be3cb3ee79aa67f3",
  measurementId: "G-Q8LJ49FNCK"
};

let appInstance: any = null;
let dbInstance: any = null;
let authInstance: any = null;
let initializationPromise: Promise<void> | null = null;

export async function ensureFirebaseInitialized(): Promise<void> {
  if (appInstance) return;
  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    try {
      let config: any = null;

      // 1. Try to fetch dynamic configuration from AI Studio workspace
      try {
        const res = await fetch("/firebase-applet-config.json");
        if (res.ok) {
          config = await res.json();
          console.log("[Firebase] Loaded dynamic configuration from firebase-applet-config.json");
        }
      } catch (e) {
        // Ignored, will fallback
      }

      // 2. Try loading from VITE_ environment variables
      const metaEnv = (import.meta as any).env || {};
      if (!config && metaEnv.VITE_FIREBASE_API_KEY) {
        config = {
          apiKey: metaEnv.VITE_FIREBASE_API_KEY,
          authDomain: metaEnv.VITE_FIREBASE_AUTH_DOMAIN,
          projectId: metaEnv.VITE_FIREBASE_PROJECT_ID,
          storageBucket: metaEnv.VITE_FIREBASE_STORAGE_BUCKET,
          messagingSenderId: metaEnv.VITE_FIREBASE_MESSAGING_SENDER_ID,
          appId: metaEnv.VITE_FIREBASE_APP_ID,
          measurementId: metaEnv.VITE_FIREBASE_MEASUREMENT_ID,
        };
        console.log("[Firebase] Loaded configuration from environment variables");
      }

      // 3. Fallback to hardcoded default config
      if (!config) {
        config = firebaseConfig;
        console.log("[Firebase] Falling back to default configuration");
      }

      if (getApps().length > 0) {
        appInstance = getApp();
      } else {
        appInstance = initializeApp(config);
      }

      authInstance = getAuth(appInstance);
      dbInstance = getFirestore(appInstance);
    } catch (err) {
      console.warn("[Firebase] Initialization failed. App will operate in local fallback/sandbox mode.", err);
      appInstance = null;
      authInstance = null;
      dbInstance = null;
    }
  })();

  return initializationPromise;
}

/**
 * Creates a new Auth user via a secondary Firebase app instance.
 * This prevents the current active user (admin) from being signed out on the client.
 */
export async function createNewUserAuth(email: string, password: string): Promise<string> {
  await ensureFirebaseInitialized();
  
  // Try to load active dynamic config, or fallback to default
  let config: any = null;
  try {
    const res = await fetch("/firebase-applet-config.json");
    if (res.ok) {
      config = await res.json();
    }
  } catch (e) {
    // Ignored, will fallback
  }

  const metaEnv = (import.meta as any).env || {};
  if (!config && metaEnv.VITE_FIREBASE_API_KEY) {
    config = {
      apiKey: metaEnv.VITE_FIREBASE_API_KEY,
      authDomain: metaEnv.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: metaEnv.VITE_FIREBASE_PROJECT_ID,
      storageBucket: metaEnv.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: metaEnv.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: metaEnv.VITE_FIREBASE_APP_ID,
      measurementId: metaEnv.VITE_FIREBASE_MEASUREMENT_ID,
    };
  }

  if (!config) {
    config = firebaseConfig;
  }

  const secondaryAppName = `secondary-app-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const secondaryApp = initializeApp(config, secondaryAppName);
  const secondaryAuth = getAuth(secondaryApp);
  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    const uid = cred.user.uid;
    // Clean up secondary auth
    await secondaryAuth.signOut();
    return uid;
  } catch (err: any) {
    const errCode = (err?.code || "").toLowerCase();
    const errMsg = (err?.message || "").toLowerCase();
    if (errCode.includes("email-already-in-use") || errMsg.includes("email-already-in-use")) {
      try {
        const cred = await signInWithEmailAndPassword(secondaryAuth, email, password);
        const uid = cred.user.uid;
        await secondaryAuth.signOut();
        return uid;
      } catch {
        throw err;
      }
    }
    throw err;
  } finally {
    // We don't delete the app dynamically as it is lightweight, but signing out is sufficient.
  }
}

export async function getFirebaseApp() {
  await ensureFirebaseInitialized();
  return appInstance;
}

export async function getFirebaseAuth() {
  await ensureFirebaseInitialized();
  return authInstance;
}

export async function getFirebaseDb() {
  await ensureFirebaseInitialized();
  return dbInstance;
}

export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {},
    operationType,
    path,
  };
  console.error("Firestore Error: ", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
