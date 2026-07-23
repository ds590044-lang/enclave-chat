// Shared Firebase bootstrap. Every page imports auth/db from here instead of
// calling initializeApp() itself, so there's exactly one primary connection.

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

export const FIREBASE_SDK_VERSION = "12.16.0";

export function isFirebaseConfigured() {
  return Boolean(firebaseConfig.apiKey) && !String(firebaseConfig.apiKey).includes("PASTE_YOUR");
}

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
