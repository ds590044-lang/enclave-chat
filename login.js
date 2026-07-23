import { auth, db, isFirebaseConfigured } from "./firebase-init.js";
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const form = document.getElementById("login-form");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const errorBox = document.getElementById("error-box");
const submitButton = document.getElementById("submit-button");
const togglePasswordButton = document.getElementById("toggle-password");
const configWarning = document.getElementById("config-warning");
const formWrapper = document.getElementById("form-wrapper");

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove("hidden");
}

function hideError() {
  errorBox.classList.add("hidden");
  errorBox.textContent = "";
}

function setLoading(isLoading) {
  submitButton.disabled = isLoading;
  submitButton.textContent = isLoading ? "Signing in…" : "Sign in";
}

// If the person hasn't pasted their Firebase config yet, say so plainly
// instead of letting them hit a confusing SDK error.
if (!isFirebaseConfigured()) {
  configWarning.classList.remove("hidden");
  formWrapper.classList.add("hidden");
} else {
  togglePasswordButton?.addEventListener("click", () => {
    const isHidden = passwordInput.type === "password";
    passwordInput.type = isHidden ? "text" : "password";
    togglePasswordButton.textContent = isHidden ? "Hide" : "Show";
    togglePasswordButton.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideError();

    const username = usernameInput.value.trim().toLowerCase();
    const password = passwordInput.value;

    if (!username || !password) {
      showError("Enter your username and password.");
      return;
    }

    setLoading(true);
    try {
      // Usernames aren't a native Firebase Auth concept, so we keep a small
      // public lookup (username -> email) that only stores that one field.
      // See firestore.rules for exactly what it exposes and why.
      const indexSnap = await getDoc(doc(db, "usernameIndex", username));
      if (!indexSnap.exists()) {
        showError("Invalid username or password.");
        return;
      }

      const { email } = indexSnap.data();
      const credential = await signInWithEmailAndPassword(auth, email, password);

      const profileSnap = await getDoc(doc(db, "users", credential.user.uid));
      if (!profileSnap.exists() || profileSnap.data().is_active !== true) {
        await signOut(auth);
        showError("This account is inactive. Contact your administrator.");
        return;
      }

      window.location.href = "chat.html";
    } catch (err) {
      console.error(err);
      showError("Invalid username or password.");
    } finally {
      setLoading(false);
    }
  });

  // Already have a valid, active session? Skip straight past the form.
  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    try {
      const profileSnap = await getDoc(doc(db, "users", user.uid));
      if (profileSnap.exists() && profileSnap.data().is_active === true) {
        window.location.href = "chat.html";
      }
    } catch (err) {
      console.error(err);
      // Not fatal - the person can just use the form normally.
    }
  });
}
