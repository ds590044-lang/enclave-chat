# Enclave — Setup Guide

A private, invite-only chat app. Nobody can sign themselves up — an
administrator creates every account. This guide assumes you're doing
everything from a phone browser. No coding, no command line, no computer
needed.

## Why this looks different from a normal app

The original plan was a Node.js server. But a server has to run *somewhere*,
all the time, and you said you can't run anything yourself. So this version
runs entirely on two free services instead:

- **Firebase** (a Google product) stores your users and messages, and keeps
  everyone's chat updated in real time. This replaces the whole server.
- **GitHub Pages** hosts the actual web page files, for free, at a public
  address anyone can visit.

Neither needs installing anything. You set both up by clicking around on
their websites. That's this whole guide.

**One honest limitation:** because there's no server, an admin can't set
someone's password directly when *resetting* it later (only when *creating*
the account). Resetting instead sends that person an email with a link to
choose a new password themselves. This is explained more in "Security notes"
at the bottom.

---

## What you'll need

- A Google account (for Firebase) — free.
- A GitHub account (for hosting) — free, sign up at github.com if you don't
  have one.
- About 20–30 minutes the first time. After that, it's already live.

---

## Part 1 — Create your Firebase project

1. Go to **console.firebase.google.com** and sign in with your Google account.
2. Tap **Add project** (or **Create a project**).
3. Give it any name, e.g. "Enclave". Tap **Continue**.
4. You'll be asked about Google Analytics — you can turn this **off**. It's
   not needed. Tap **Create project**, then **Continue** once it's ready.

## Part 2 — Turn on sign-in and the database

1. In the left sidebar, open **Build → Authentication**. Tap **Get started**.
2. Under sign-in providers, choose **Email/Password**. Turn the first toggle
   **on** (you can leave "Email link" off). Tap **Save**.
3. In the left sidebar, open **Build → Firestore Database**. Tap
   **Create database**.
4. Pick any location close to you. Then choose **Start in production mode**.
   Tap **Create**.
5. Once it opens, tap the **Rules** tab near the top.
6. Delete everything in the box, and paste in the entire contents of the
   `firestore.rules` file from this project instead. Tap **Publish**.

This Rules step is what actually keeps people's chats private — don't skip it.

## Part 3 — Register a web app and get your config

1. In the left sidebar, tap the gear icon → **Project settings**.
2. Scroll down to **Your apps**. Tap the **`</>`** (web) icon.
3. Give it a nickname (anything). You do **not** need to check the Firebase
   Hosting box. Tap **Register app**.
4. You'll see a code block with a `firebaseConfig = { ... }` object. You need
   these values in the next step — keep this page open, or come back to
   **Project settings → General** any time to see it again.

## Part 4 — Connect the app to your project

1. Open the file **`js/firebase-config.js`** from this project (GitHub's
   editor works fine for this — see Part 6 for how to get the files into
   GitHub first, then come back and edit this file there).
2. Replace each `"PASTE_YOUR_..._HERE"` with the matching value Firebase
   showed you in Part 3. It should end up looking like:
   ```js
   export const firebaseConfig = {
     apiKey: "AIzaSyD...",
     authDomain: "enclave-12345.firebaseapp.com",
     projectId: "enclave-12345",
     storageBucket: "enclave-12345.firebasestorage.app",
     messagingSenderId: "123456789012",
     appId: "1:123456789012:web:abcdef123456",
   };
   ```
3. Save. (This is safe to make public — see "Security notes" below for why.)

---

## Part 5 — Create your very first admin account

The app can only create new users through an existing admin. For the very
first one, you create it by hand, directly in Firebase:

1. Firebase Console → **Authentication** → **Users** tab → **Add user**.
2. Enter a real email address you can access, and a password. Tap **Add user**.
3. Click on the user you just created in the list, and copy their **User UID**
   (a long string of letters and numbers).
4. Go to **Firestore Database → Data** tab → **Start collection**.
   - Collection ID: `users`
   - Document ID: paste the **User UID** from step 3
   - Add these fields (use **+ Add field** for each):
     | Field | Type | Value |
     |---|---|---|
     | `username` | string | pick a username, e.g. `admin` |
     | `email` | string | the same email from step 2 |
     | `role` | string | `admin` |
     | `is_active` | boolean | `true` |
     | `createdAt` | timestamp | (use "now" / current time) |
   - Tap **Save**.
5. Still in Firestore Data tab, **Start collection** again (or **+ Add
   collection** if one already exists):
   - Collection ID: `usernameIndex`
   - Document ID: your chosen username, all **lowercase** (e.g. `admin`)
   - Add fields:
     | Field | Type | Value |
     |---|---|---|
     | `email` | string | the same email from step 2 |
     | `uid` | string | the same User UID from step 3 |
   - Tap **Save**.

That's your one manually-created account. Every account after this one gets
created from inside the app itself, by an admin.

---

## Part 6 — Put the site online with GitHub Pages

1. Go to **github.com**, sign in (or create a free account).
2. Tap the **+** in the top right → **New repository**.
3. Name it anything (e.g. `enclave-chat`). Make sure it's set to **Public**
   (GitHub Pages needs this on a free account). Tap **Create repository**.
4. On the new repo's page, tap **Add file → Upload files**.
5. Upload every file and folder from this project, keeping the `js` folder
   as a folder (most phones let you pick a whole folder to upload, or you
   can upload the files one by one and type `js/filename.js` as the path
   when GitHub asks). You should end up with, at the repo's top level:
   `index.html`, `chat.html`, `firestore.rules`, `README.md`, and a `js/`
   folder containing `firebase-config.js`, `firebase-init.js`, `utils.js`,
   `login.js`, `admin.js`, `chat.js`.
6. Scroll down and tap **Commit changes**.
7. Go to the repo's **Settings** tab → **Pages** (left sidebar, under "Code
   and automation").
8. Under **Build and deployment → Source**, choose **Deploy from a branch**.
   Under **Branch**, choose **main** and **/ (root)**. Tap **Save**.
9. Wait about a minute, then refresh the page. GitHub will show you the live
   address, something like:
   `https://yourusername.github.io/enclave-chat/`

That address is your public site. Anyone with it can reach the **login
page** — but remember, nobody can actually get in without an account you
created for them.

> Forgot to add your Firebase config before uploading? Just open
> `js/firebase-config.js` in the GitHub repo, tap the pencil (edit) icon,
> paste in your values, and commit again. The live site updates within a
> minute or two.

---

## Part 7 — First login

1. Visit your GitHub Pages address.
2. Sign in with the username and password from Part 5.
3. You should land on the chat screen with an **admin panel** icon (shield)
   next to the logout button.
4. Open it, and use **Create a new user** to make real accounts for other
   people — each needs a username, an email (used only if they ever need a
   password reset — it's never shown to other people in the chat), and
   either an auto-generated or a manual starting password.
5. After creating someone, copy the password shown and send it to them
   privately (text, call, in person). It's shown exactly once.

They can now go to the same address, sign in with what you gave them, and
start chatting.

---

## Troubleshooting

- **"Firebase isn't configured yet" banner** — `js/firebase-config.js` still
  has placeholder values. Go back to Part 4.
- **"Invalid username or password" even though you're sure it's right** —
  double check the `usernameIndex` document ID is the username in all
  **lowercase**, and that its `email` field exactly matches the Auth
  account's email.
- **Stuck on the spinner forever** — open your `users` document for that
  account and confirm `is_active` is a **boolean** `true`, not the text
  `"true"`.
- **"Missing or insufficient permissions" in the browser console** — almost
  always means the Firestore Rules weren't published, or don't match
  `firestore.rules` exactly. Re-check Part 2, step 6.
- **Nothing updates in real time** — check you're not on a restrictive
  Wi-Fi/firewall that blocks Firestore's connection; try mobile data.

---

## Security notes (read this once)

- **The Firebase config in `firebase-config.js` is not a secret.** It just
  tells the browser which Firebase project to talk to — it's normal for it
  to be public, the same way a shop's street address isn't a secret. What
  actually protects your data is `firestore.rules`, which is why installing
  it correctly (Part 2) matters so much.
- **Passwords are never stored or handled by this app's code.** Firebase's
  own Authentication service handles that, the same infrastructure Google
  itself uses.
- **Password resets go through email**, not through the admin panel showing
  a new password. This is a deliberate limit: giving an admin the power to
  silently set anyone's password requires a paid backend function, which
  this free setup avoids.
- **A technically determined person could create a bare Firebase login
  that has no profile.** Because there's no server, nothing can stop the
  underlying Firebase Auth signup call from existing. But without an
  admin-created `users` document, that account can't read a single message,
  see a single conversation, or do anything in the app — the Firestore
  Rules block all of it. In practice, it's a dead end for them, not a way in.
- **Usernames and emails are technically visible to unauthenticated
  requests** via the small `usernameIndex` lookup (that's what makes
  "log in with a username" possible without a server). Nothing else —
  messages, roles, active status — is exposed this way.

## If you outgrow the free tier

Firebase's free (Spark) plan comfortably covers a small private group. If
you outgrow it later, the natural next steps are enabling Firebase's paid
Blaze plan (usage-based, with the same free quota built in) for things like
server-side password resets via Cloud Functions, or moving the same data
model onto a traditional server. Nothing here needs to be rebuilt from
scratch to get there.
