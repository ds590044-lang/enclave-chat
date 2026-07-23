// Admin panel logic, wired up by chat.js only when the signed-in person has
// role "admin". Everything here is also re-checked server-side by
// firestore.rules, so even a tampered client can't do more than this UI allows.

import { firebaseConfig } from "./firebase-config.js";
import {
  initializeApp,
  deleteApp,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  doc,
  getDoc,
  updateDoc,
  writeBatch,
  collection,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { escapeHtml, generatePassword } from "./utils.js";

const USERNAME_RE = /^[a-zA-Z0-9_.]{3,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Creating a user via createUserWithEmailAndPassword signs the *browser* in
// as that new user - a serious problem if that browser is the admin's own
// session. Spinning up a short-lived, separately-named Firebase app instance
// lets us mint the account without ever touching the admin's real session.
async function createAuthAccountWithoutSigningOutAdmin(email, password) {
  const secondaryApp = initializeApp(firebaseConfig, `secondary-${Date.now()}`);
  const secondaryAuth = getAuth(secondaryApp);
  try {
    const credential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    return credential.user.uid;
  } finally {
    try {
      await signOut(secondaryAuth);
    } catch {
      // already signed out or never signed in - fine either way
    }
    await deleteApp(secondaryApp);
  }
}

export function initAdminPanel({ db, auth, me }) {
  const openButton = document.getElementById("admin-panel-button");
  const modal = document.getElementById("admin-modal");
  const closeButton = document.getElementById("admin-modal-close");
  const backdrop = document.getElementById("admin-modal-backdrop");
  const createForm = document.getElementById("create-user-form");
  const createFormError = document.getElementById("create-form-error");
  const usersTableBody = document.getElementById("admin-users-tbody");
  const credentialBox = document.getElementById("credential-box");
  const credentialText = document.getElementById("credential-text");
  const credentialCopyButton = document.getElementById("credential-copy-button");
  const credentialDismissButton = document.getElementById("credential-dismiss");
  const manualPasswordWrapper = document.getElementById("manual-password-wrapper");
  const manualPasswordInput = document.getElementById("manual-password");

  if (!openButton || !modal) return; // defensive: markup not present for this role

  let usersUnsubscribe = null;
  let currentRows = [];

  function openModal() {
    modal.classList.remove("hidden");
    document.body.classList.add("overflow-hidden");
    subscribeToUsers();
  }

  function closeModal() {
    modal.classList.add("hidden");
    document.body.classList.remove("overflow-hidden");
    credentialBox.classList.add("hidden");
    createFormError.classList.add("hidden");
    createForm.reset();
    manualPasswordWrapper.classList.add("hidden");
    if (usersUnsubscribe) {
      usersUnsubscribe();
      usersUnsubscribe = null;
    }
  }

  openButton.addEventListener("click", openModal);
  closeButton.addEventListener("click", closeModal);
  backdrop.addEventListener("click", closeModal);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.classList.contains("hidden")) closeModal();
  });

  document.querySelectorAll('input[name="password-mode"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      const manual = document.querySelector('input[name="password-mode"]:checked').value === "manual";
      manualPasswordWrapper.classList.toggle("hidden", !manual);
      if (!manual) manualPasswordInput.value = "";
    });
  });

  credentialCopyButton?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(credentialText.textContent);
      const original = credentialCopyButton.textContent;
      credentialCopyButton.textContent = "Copied";
      setTimeout(() => {
        credentialCopyButton.textContent = original;
      }, 1500);
    } catch (err) {
      console.error(err);
    }
  });

  credentialDismissButton?.addEventListener("click", () => {
    credentialBox.classList.add("hidden");
  });

  function subscribeToUsers() {
    if (usersUnsubscribe) usersUnsubscribe();
    usersUnsubscribe = onSnapshot(
      collection(db, "users"),
      (snapshot) => {
        currentRows = [];
        snapshot.forEach((docSnap) => currentRows.push({ uid: docSnap.id, ...docSnap.data() }));
        currentRows.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
        renderUsersTable();
      },
      (err) => console.error("admin users listener:", err)
    );
  }

  function renderUsersTable() {
    usersTableBody.innerHTML = currentRows.map(rowHtml).join("");
  }

  function rowHtml(user) {
    const isSelf = user.uid === me.uid;
    const statusBadge = user.is_active
      ? `<span class="inline-flex rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">Active</span>`
      : `<span class="inline-flex rounded-full bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-400">Deactivated</span>`;
    const roleBadge =
      user.role === "admin"
        ? `<span class="inline-flex rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400">Admin</span>`
        : `<span class="inline-flex rounded-full bg-slate-500/10 px-2 py-0.5 text-xs font-medium text-slate-400">User</span>`;
    const toggleButton = isSelf
      ? `<span class="text-xs text-slate-600">You</span>`
      : `<button data-action="toggle-active" data-uid="${escapeHtml(user.uid)}" data-active="${user.is_active}" class="text-xs font-medium ${
          user.is_active ? "text-rose-400 hover:text-rose-300" : "text-emerald-400 hover:text-emerald-300"
        }">${user.is_active ? "Deactivate" : "Activate"}</button>`;

    return `
      <tr class="border-b border-white/5 last:border-0">
        <td class="py-3 pr-4">
          <div class="font-medium text-slate-100">${escapeHtml(user.username || "")}</div>
          <div class="text-xs text-slate-500">${escapeHtml(user.email || "")}</div>
        </td>
        <td class="py-3 pr-4">${roleBadge}</td>
        <td class="py-3 pr-4">${statusBadge}</td>
        <td class="py-3 pr-4">
          <div class="flex items-center justify-end gap-3 whitespace-nowrap">
            <button data-action="reset-password" data-email="${escapeHtml(user.email || "")}" class="text-xs font-medium text-amber-400 hover:text-amber-300">Reset password</button>
            ${toggleButton}
          </div>
        </td>
      </tr>`;
  }

  usersTableBody.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;

    if (action === "reset-password") {
      const email = button.dataset.email;
      if (!email) return;
      if (!confirm(`Send a password reset email to ${email}?`)) return;
      button.disabled = true;
      try {
        await sendPasswordResetEmail(auth, email);
        alert(`Password reset email sent to ${email}.`);
      } catch (err) {
        console.error(err);
        alert("Could not send the reset email. Double-check your Firebase setup.");
      } finally {
        button.disabled = false;
      }
      return;
    }

    if (action === "toggle-active") {
      const uid = button.dataset.uid;
      const isActive = button.dataset.active === "true";
      const row = currentRows.find((r) => r.uid === uid);
      if (!row) return;

      if (isActive && row.role === "admin") {
        const otherActiveAdmins = currentRows.filter((r) => r.role === "admin" && r.is_active && r.uid !== uid);
        if (otherActiveAdmins.length === 0) {
          alert("You can't deactivate the only active admin account.");
          return;
        }
      }

      const confirmMessage = isActive
        ? `Deactivate ${row.username}? They will lose access immediately.`
        : `Reactivate ${row.username}?`;
      if (!confirm(confirmMessage)) return;

      button.disabled = true;
      try {
        await updateDoc(doc(db, "users", uid), { is_active: !isActive });
      } catch (err) {
        console.error(err);
        alert("Could not update this account.");
      } finally {
        button.disabled = false;
      }
    }
  });

  createForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    createFormError.classList.add("hidden");
    credentialBox.classList.add("hidden");

    const formData = new FormData(createForm);
    const username = String(formData.get("username") || "").trim();
    const usernameKey = username.toLowerCase();
    const email = String(formData.get("email") || "").trim();
    const role = formData.get("role") === "admin" ? "admin" : "user";
    const passwordMode = formData.get("password-mode");
    let password = passwordMode === "manual" ? String(formData.get("manual-password") || "") : "";

    if (!USERNAME_RE.test(username)) {
      return showCreateError('Username must be 3-30 characters: letters, numbers, "_" or "." only.');
    }
    if (!EMAIL_RE.test(email)) {
      return showCreateError("Enter a valid email (used only for password recovery, never shown in chat).");
    }
    if (passwordMode === "manual" && password.length < 8) {
      return showCreateError("Manual passwords need to be at least 8 characters.");
    }
    if (!password) password = generatePassword(12);

    const submitButton = createForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = "Creating…";

    try {
      const existingIndex = await getDoc(doc(db, "usernameIndex", usernameKey));
      if (existingIndex.exists()) {
        showCreateError("That username is already taken.");
        return;
      }

      const uid = await createAuthAccountWithoutSigningOutAdmin(email, password);

      const batch = writeBatch(db);
      batch.set(doc(db, "users", uid), {
        username,
        email,
        role,
        is_active: true,
        createdAt: serverTimestamp(),
        lastSeen: null,
      });
      batch.set(doc(db, "usernameIndex", usernameKey), { email, uid });
      await batch.commit();

      credentialText.textContent = `Username: ${username}   Password: ${password}`;
      credentialBox.classList.remove("hidden");
      createForm.reset();
      manualPasswordWrapper.classList.add("hidden");
    } catch (err) {
      console.error(err);
      const message =
        err?.code === "auth/email-already-in-use"
          ? "That email is already tied to another account."
          : "Could not create the account. Check your Firebase setup and try again.";
      showCreateError(message);
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Create user";
    }
  });

  function showCreateError(message) {
    createFormError.textContent = message;
    createFormError.classList.remove("hidden");
  }
}
