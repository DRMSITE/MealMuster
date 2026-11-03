// @ts-check
import { initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  signOut as firebaseSignOut,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
} from "firebase/auth";

// Local development always uses the Auth emulator with a demo project, so a
// developer machine can never sign in to (or write to) a live project by accident.
const useEmulator =
  import.meta.env.DEV || import.meta.env.VITE_USE_AUTH_EMULATOR === "true";

/** @type {import("firebase/auth").Auth | undefined} */
let cached;

function auth() {
  if (cached) return cached;
  const app = initializeApp(
    useEmulator
      ? {
          apiKey: "demo-api-key",
          authDomain: "localhost",
          projectId: "demo-mealmuster",
        }
      : {
          apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
          authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
          projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
        },
  );
  cached = getAuth(app);
  if (useEmulator)
    connectAuthEmulator(cached, "http://127.0.0.1:9099", {
      disableWarnings: true,
    });
  return cached;
}

/** @param {(user: { email: string | null } | null) => void} callback */
export const onUser = (callback) => onAuthStateChanged(auth(), callback);

/** @param {string} email @param {string} password */
export const signIn = (email, password) =>
  signInWithEmailAndPassword(auth(), email, password);

export const signOut = () => firebaseSignOut(auth());

/** A fresh ID token for the API; the SDK refreshes it when it is close to expiry. */
export const idToken = async () =>
  (await auth().currentUser?.getIdToken()) ?? "";
