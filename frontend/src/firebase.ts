import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User } from "firebase/auth";
import { getAnalytics, isSupported } from "firebase/analytics";

const env = (import.meta as any).env || {};

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || "AIzaSyCxp32uijBeNw6qhQjVCqp-KVK32Dmcui0",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || "oracle-5ac86.firebaseapp.com",
  projectId: env.VITE_FIREBASE_PROJECT_ID || "oracle-5ac86",
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || "oracle-5ac86.firebasestorage.app",
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || "877368960977",
  appId: env.VITE_FIREBASE_APP_ID || "1:877368960977:web:2ea237c37777d5712222f0",
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID || "G-JC599BNSCY",
};

// Initialize App (Singleton)
export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// Auth & Providers
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: "select_account",
});

// Analytics (Safe check for browser environment)
export let analytics: ReturnType<typeof getAnalytics> | null = null;
if (typeof window !== "undefined") {
  isSupported().then((supported) => {
    if (supported) {
      analytics = getAnalytics(app);
    }
  });
}

// Google Sign-In helper functions
export async function signInWithGoogle(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}

export { onAuthStateChanged };
export type { User };
