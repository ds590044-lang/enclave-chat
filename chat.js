import { auth, db, isFirebaseConfigured } from "./firebase-init.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  increment,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { initAdminPanel } from "./admin.js";
import {
  escapeHtml,
  colorForName,
  initialFor,
  formatMessageTime,
  formatSidebarTime,
  formatDateDivider,
  toDate,
} from "./utils.js";

const HEARTBEAT_INTERVAL_MS = 25000;
const ONLINE_THRESHOLD_MS = 45000;
const TYPING_TIMEOUT_MS = 2500;
const MAX_MESSAGE_LENGTH = 2000;

const state = {
  me: null, // { uid, username, role }
  conversations: [],
  directory: [],
  activeConversationId: null,
  activeOtherUid: null,
  isTyping: false,
  typingTimeoutHandle: null,
};

const unsub = { conversations: null, directory: null, messages: null };
let heartbeatTimer = null;

const els = {
  loadingScreen: document.getElementById("loading-screen"),
  appShell: document.getElementById("app-shell"),
  configWarning: document.getElementById("config-warning"),

  myAvatar: document.getElementById("my-avatar"),
  myUsername: document.getElementById("my-username"),
  myRoleBadge: document.getElementById("my-role-badge"),
  logoutButton: document.getElementById("logout-button"),
  adminPanelButton: document.getElementById("admin-panel-button"),

  sidebar: document.getElementById("sidebar"),
  searchInput: document.getElementById("search-input"),
  conversationList: document.getElementById("conversation-list"),
  emptyConversations: document.getElementById("empty-conversations"),

  newChatButton: document.getElementById("new-chat-button"),
  newChatModal: document.getElementById("new-chat-modal"),
  newChatBackdrop: document.getElementById("new-chat-backdrop"),
  newChatClose: document.getElementById("new-chat-close"),
  contactSearchInput: document.getElementById("contact-search-input"),
  contactList: document.getElementById("contact-list"),

  emptyState: document.getElementById("empty-state"),
  chatView: document.getElementById("chat-view"),
  chatHeaderAvatar: document.getElementById("chat-header-avatar"),
  chatHeaderName: document.getElementById("chat-header-name"),
  chatHeaderStatus: document.getElementById("chat-header-status"),
  backToListButton: document.getElementById("back-to-list-button"),

  messageList: document.getElementById("message-list"),

  messageForm: document.getElementById("message-form"),
  messageInput: document.getElementById("message-input"),

  connectionBanner: document.getElementById("connection-banner"),
};

if (!isFirebaseConfigured()) {
  els.configWarning.classList.remove("hidden");
  els.loadingScreen.classList.add("hidden");
} else {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "index.html";
      return;
    }
    try {
      const profileSnap = await getDoc(doc(db, "users", user.uid));
      if (!profileSnap.exists() || profileSnap.data().is_active !== true) {
        await signOut(auth);
        window.location.href = "index.html";
        return;
      }
      state.me = {
        uid: user.uid,
        username: profileSnap.data().username,
        role: profileSnap.data().role,
      };
      boot();
    } catch (err) {
      console.error(err);
      els.loadingScreen.innerHTML =
        '<p class="text-sm text-rose-400">Something went wrong loading your account. Refresh to try again.</p>';
    }
  });
}

function boot() {
  renderMe();
  showConversationListView(); // sets sidebar/chat-view/empty-state to a known state before first paint

  els.loadingScreen.classList.add("hidden");
  els.appShell.classList.remove("hidden");

  wireEvents();
  startHeartbeat();
  subscribeToConversations();
  subscribeToDirectory();

  if (state.me.role === "admin") {
    els.adminPanelButton.classList.remove("hidden");
    initAdminPanel({ db, auth, me: state.me });
  }
}

function renderMe() {
  els.myAvatar.textContent = initialFor(state.me.username);
  els.myAvatar.className = `flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white ${colorForName(
    state.me.username
  )}`;
  els.myUsername.textContent = state.me.username;
  if (state.me.role === "admin") els.myRoleBadge.classList.remove("hidden");
}

// ---------------------------------------------------------------- events --

function wireEvents() {
  els.logoutButton.addEventListener("click", async () => {
    stopHeartbeat();
    unsubscribeAll();
    await signOut(auth);
    window.location.href = "index.html";
  });

  els.backToListButton?.addEventListener("click", showConversationListView);

  els.searchInput?.addEventListener("input", renderConversationList);

  els.newChatButton.addEventListener("click", openNewChatModal);
  els.newChatClose.addEventListener("click", closeNewChatModal);
  els.newChatBackdrop.addEventListener("click", closeNewChatModal);
  els.contactSearchInput?.addEventListener("input", renderContactList);

  els.conversationList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-conversation-id]");
    if (!button) return;
    handleConversationRowClick(button.dataset.conversationId);
  });

  els.contactList.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-uid]");
    if (!button) return;
    const otherUid = button.dataset.uid;
    const otherUsername = button.dataset.username;
    closeNewChatModal();
    try {
      const conversationId = await startConversation(otherUid, otherUsername);
      await openConversation(conversationId, otherUid, otherUsername);
    } catch (err) {
      console.error("start conversation failed", err);
      alert("Could not start that conversation. Please try again.");
    }
  });

  els.messageForm.addEventListener("submit", handleSendMessage);
  els.messageInput.addEventListener("input", () => {
    autoResizeTextarea();
    handleTypingInput();
  });
  els.messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      els.messageForm.requestSubmit();
    }
  });

  window.addEventListener("offline", () => els.connectionBanner.classList.remove("hidden"));
  window.addEventListener("online", () => els.connectionBanner.classList.add("hidden"));

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") updateHeartbeat();
  });
}

// -------------------------------------------------------------- presence --

function startHeartbeat() {
  updateHeartbeat();
  heartbeatTimer = setInterval(updateHeartbeat, HEARTBEAT_INTERVAL_MS);
}
function stopHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
}
async function updateHeartbeat() {
  try {
    await updateDoc(doc(db, "users", state.me.uid), { lastSeen: serverTimestamp() });
  } catch (err) {
    console.error("heartbeat failed", err);
  }
}
function isOnline(lastSeenValue) {
  const date = toDate(lastSeenValue);
  if (!date) return false;
  return Date.now() - date.getTime() < ONLINE_THRESHOLD_MS;
}

// ---------------------------------------------------------- conversations --

function subscribeToConversations() {
  const q = query(
    collection(db, "conversations"),
    where("participants", "array-contains", state.me.uid),
    orderBy("updatedAt", "desc")
  );
  unsub.conversations = onSnapshot(
    q,
    (snapshot) => {
      state.conversations = [];
      snapshot.forEach((docSnap) => state.conversations.push({ id: docSnap.id, ...docSnap.data() }));
      renderConversationList();
      refreshActiveHeader();
    },
    (err) => console.error("conversations listener", err)
  );
}

function subscribeToDirectory() {
  const q = query(collection(db, "users"), where("is_active", "==", true));
  unsub.directory = onSnapshot(
    q,
    (snapshot) => {
      state.directory = [];
      snapshot.forEach((docSnap) => {
        if (docSnap.id !== state.me.uid) state.directory.push({ uid: docSnap.id, ...docSnap.data() });
      });
      state.directory.sort((a, b) => a.username.localeCompare(b.username));
      renderContactList();
      renderConversationList();
      refreshActiveHeader();
    },
    (err) => console.error("directory listener", err)
  );
}

function otherParticipantInfo(conversation) {
  const otherUid = conversation.participants.find((uid) => uid !== state.me.uid);
  const directoryEntry = state.directory.find((u) => u.uid === otherUid);
  const username = conversation.participantUsernames?.[otherUid] || directoryEntry?.username || "Unknown user";
  return {
    uid: otherUid,
    username,
    online: directoryEntry ? isOnline(directoryEntry.lastSeen) : false,
  };
}

function getActiveConversation() {
  return state.conversations.find((c) => c.id === state.activeConversationId) || null;
}

function renderConversationList() {
  const searchTerm = (els.searchInput?.value || "").trim().toLowerCase();
  const rows = state.conversations
    .map((c) => ({ ...c, other: otherParticipantInfo(c) }))
    .filter((c) => !searchTerm || c.other.username.toLowerCase().includes(searchTerm));

  els.emptyConversations.classList.toggle("hidden", rows.length > 0);
  els.conversationList.innerHTML = rows.map(conversationRowHtml).join("");
}

function conversationRowHtml(conversation) {
  const isActive = conversation.id === state.activeConversationId;
  const unread = conversation.unreadCount?.[state.me.uid] || 0;
  const lastMessage = conversation.lastMessage;
  const preview = lastMessage
    ? (lastMessage.senderId === state.me.uid ? "You: " : "") + escapeHtml(lastMessage.text)
    : "Say hello \u{1F44B}";
  const time = lastMessage ? formatSidebarTime(lastMessage.timestamp) : "";

  return `
    <button data-conversation-id="${conversation.id}" class="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/5 ${
    isActive ? "bg-white/5" : ""
  }">
      <div class="relative shrink-0">
        <div class="flex h-11 w-11 items-center justify-center rounded-full text-sm font-semibold text-white ${colorForName(
          conversation.other.username
        )}">${initialFor(conversation.other.username)}</div>
        ${
          conversation.other.online
            ? '<span class="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[#14161B] bg-emerald-400"></span>'
            : ""
        }
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-center justify-between gap-2">
          <span class="truncate font-medium text-slate-100">${escapeHtml(conversation.other.username)}</span>
          <span class="shrink-0 text-xs text-slate-500">${time}</span>
        </div>
        <div class="flex items-center justify-between gap-2">
          <span class="truncate text-sm text-slate-400">${preview}</span>
          ${
            unread > 0
              ? `<span class="ml-2 flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-slate-950">${
                  unread > 99 ? "99+" : unread
                }</span>`
              : ""
          }
        </div>
      </div>
    </button>`;
}

function handleConversationRowClick(conversationId) {
  if (state.activeConversationId === conversationId) {
    showChatView();
    return;
  }
  const conversation = state.conversations.find((c) => c.id === conversationId);
  if (!conversation) return;
  const other = otherParticipantInfo(conversation);
  openConversation(conversationId, other.uid, other.username);
}

async function startConversation(otherUid, otherUsername) {
  const conversationId = [state.me.uid, otherUid].sort().join("_");
  const ref = doc(db, "conversations", conversationId);
  const existing = await getDoc(ref);
  if (!existing.exists()) {
    await setDoc(ref, {
      participants: [state.me.uid, otherUid].sort(),
      participantUsernames: { [state.me.uid]: state.me.username, [otherUid]: otherUsername },
      updatedAt: serverTimestamp(),
      lastMessage: null,
      unreadCount: { [state.me.uid]: 0, [otherUid]: 0 },
      typing: { [state.me.uid]: false, [otherUid]: false },
    });
  }
  return conversationId;
}

async function openConversation(conversationId, otherUid, otherUsername) {
  state.activeConversationId = conversationId;
  state.activeOtherUid = otherUid;

  els.chatHeaderAvatar.textContent = initialFor(otherUsername);
  els.chatHeaderAvatar.className = `flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold text-white ${colorForName(
    otherUsername
  )}`;
  els.chatHeaderName.textContent = otherUsername;
  els.chatHeaderStatus.classList.remove("text-amber-400");
  const directoryEntry = state.directory.find((u) => u.uid === otherUid);
  els.chatHeaderStatus.textContent = directoryEntry && isOnline(directoryEntry.lastSeen) ? "Online" : "Offline";

  renderConversationList();
  showChatView();
  subscribeToMessages(conversationId, otherUid);
}

function refreshActiveHeader() {
  const conversation = getActiveConversation();
  if (!conversation) return;
  const typingMap = conversation.typing;
  const otherIsTyping = Boolean(typingMap?.[state.activeOtherUid]);
  if (otherIsTyping) {
    els.chatHeaderStatus.textContent = "typing…";
    els.chatHeaderStatus.classList.add("text-amber-400");
    return;
  }
  els.chatHeaderStatus.classList.remove("text-amber-400");
  const other = state.directory.find((u) => u.uid === state.activeOtherUid);
  if (state.activeConversationId) {
    els.chatHeaderStatus.textContent = other && isOnline(other.lastSeen) ? "Online" : "Offline";
  }
}

// -------------------------------------------------------------- messages --

function subscribeToMessages(conversationId, otherUid) {
  if (unsub.messages) {
    unsub.messages();
    unsub.messages = null;
  }
  const q = query(collection(db, "conversations", conversationId, "messages"), orderBy("timestamp", "asc"), limit(500));
  unsub.messages = onSnapshot(
    q,
    (snapshot) => {
      const messages = [];
      snapshot.forEach((docSnap) => messages.push({ id: docSnap.id, ref: docSnap.ref, ...docSnap.data() }));
      renderMessages(messages);
      markIncomingMessagesRead(conversationId, otherUid, messages);
    },
    (err) => console.error("messages listener", err)
  );
}

function renderMessages(messages) {
  const nearBottom = isScrolledNearBottom();
  let html = "";
  let lastDateKey = null;

  for (const message of messages) {
    const date = toDate(message.timestamp);
    const dateKey = date ? date.toDateString() : null;
    if (dateKey && dateKey !== lastDateKey) {
      html += `<div class="my-3 flex justify-center"><span class="rounded-full bg-white/5 px-3 py-1 text-xs font-medium text-slate-400">${formatDateDivider(
        message.timestamp
      )}</span></div>`;
      lastDateKey = dateKey;
    }
    html += messageBubbleHtml(message);
  }

  els.messageList.innerHTML =
    html || '<div class="flex h-full items-center justify-center px-6 text-center text-sm text-slate-500">No messages yet — say hello \u{1F44B}</div>';

  if (nearBottom) scrollMessagesToBottom();
}

function messageBubbleHtml(message) {
  const mine = message.senderId === state.me.uid;
  const time = formatMessageTime(message.timestamp);
  const readTick = !mine
    ? ""
    : message.isRead
    ? '<svg class="inline h-3.5 w-3.5" viewBox="0 0 16 16" fill="none"><path d="M1 8.5 4.5 12 9 5.5M6.5 8.5 10 12l5.5-8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    : '<svg class="inline h-3.5 w-3.5 opacity-70" viewBox="0 0 16 16" fill="none"><path d="M2 8.5 6 12.5 14 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  return `
    <div class="flex ${mine ? "justify-end" : "justify-start"} px-4 py-0.5">
      <div class="max-w-[78%] rounded-2xl px-3.5 py-2 ${
        mine ? "rounded-br-sm bg-amber-500 text-slate-950" : "rounded-bl-sm bg-[#242832] text-slate-100"
      }">
        <p class="whitespace-pre-wrap break-words text-sm leading-relaxed">${escapeHtml(message.text)}</p>
        <div class="mt-1 flex items-center justify-end gap-1 ${
          mine ? "text-slate-950/60" : "text-slate-500"
        } text-[11px]">
          <span>${time}</span>
          ${readTick}
        </div>
      </div>
    </div>`;
}

function isScrolledNearBottom() {
  const el = els.messageList;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
}
function scrollMessagesToBottom() {
  requestAnimationFrame(() => {
    els.messageList.scrollTop = els.messageList.scrollHeight;
  });
}

async function markIncomingMessagesRead(conversationId, otherUid, messages) {
  if (conversationId !== state.activeConversationId) return;
  const unreadFromOther = messages.filter((m) => m.senderId === otherUid && m.isRead === false);
  if (unreadFromOther.length === 0) return;

  try {
    const batch = writeBatch(db);
    unreadFromOther.forEach((m) => batch.update(m.ref, { isRead: true }));
    batch.update(doc(db, "conversations", conversationId), { [`unreadCount.${state.me.uid}`]: 0 });
    await batch.commit();
  } catch (err) {
    console.error("mark read failed", err);
  }
}

async function handleSendMessage(event) {
  event.preventDefault();
  const text = els.messageInput.value.trim().slice(0, MAX_MESSAGE_LENGTH);
  if (!text || !state.activeConversationId || !state.activeOtherUid) return;

  const conversationId = state.activeConversationId;
  const otherUid = state.activeOtherUid;

  els.messageInput.value = "";
  autoResizeTextarea();
  clearTypingState();

  try {
    const batch = writeBatch(db);
    const messageRef = doc(collection(db, "conversations", conversationId, "messages"));
    batch.set(messageRef, {
      senderId: state.me.uid,
      text,
      timestamp: serverTimestamp(),
      isRead: false,
    });
    batch.update(doc(db, "conversations", conversationId), {
      updatedAt: serverTimestamp(),
      lastMessage: { text, senderId: state.me.uid, timestamp: serverTimestamp() },
      [`unreadCount.${otherUid}`]: increment(1),
      [`typing.${state.me.uid}`]: false,
    });
    await batch.commit();
  } catch (err) {
    console.error("send message failed", err);
    alert("Message failed to send. Check your connection and try again.");
  }
}

function autoResizeTextarea() {
  const el = els.messageInput;
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 160) + "px";
}

// --------------------------------------------------------------- typing --

function handleTypingInput() {
  if (!state.activeConversationId) return;
  if (!state.isTyping) {
    state.isTyping = true;
    setTypingState(true);
  }
  clearTimeout(state.typingTimeoutHandle);
  state.typingTimeoutHandle = setTimeout(() => {
    state.isTyping = false;
    setTypingState(false);
  }, TYPING_TIMEOUT_MS);
}

function clearTypingState() {
  clearTimeout(state.typingTimeoutHandle);
  if (state.isTyping) {
    state.isTyping = false;
    setTypingState(false);
  }
}

async function setTypingState(isTyping) {
  if (!state.activeConversationId) return;
  try {
    await updateDoc(doc(db, "conversations", state.activeConversationId), {
      [`typing.${state.me.uid}`]: isTyping,
    });
  } catch (err) {
    console.error("typing update failed", err);
  }
}

// --------------------------------------------------------------- new chat --

function openNewChatModal() {
  els.newChatModal.classList.remove("hidden");
  document.body.classList.add("overflow-hidden");
  renderContactList();
}
function closeNewChatModal() {
  els.newChatModal.classList.add("hidden");
  document.body.classList.remove("overflow-hidden");
  if (els.contactSearchInput) els.contactSearchInput.value = "";
}

function renderContactList() {
  const searchTerm = (els.contactSearchInput?.value || "").trim().toLowerCase();
  const rows = state.directory.filter((u) => !searchTerm || u.username.toLowerCase().includes(searchTerm));
  els.contactList.innerHTML = rows.length
    ? rows.map(contactRowHtml).join("")
    : '<div class="px-4 py-6 text-center text-sm text-slate-500">No one matches that search.</div>';
}

function contactRowHtml(user) {
  const online = isOnline(user.lastSeen);
  return `
    <button data-uid="${escapeHtml(user.uid)}" data-username="${escapeHtml(user.username)}" class="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/5">
      <div class="relative shrink-0">
        <div class="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white ${colorForName(
          user.username
        )}">${initialFor(user.username)}</div>
        ${online ? '<span class="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-[#1C1F26] bg-emerald-400"></span>' : ""}
      </div>
      <div class="min-w-0 flex-1">
        <div class="truncate font-medium text-slate-100">${escapeHtml(user.username)}</div>
        <div class="text-xs text-slate-500">${online ? "Online" : "Offline"}${user.role === "admin" ? " · Admin" : ""}</div>
      </div>
    </button>`;
}

// ------------------------------------------------------- responsive view --

// These three elements are toggled between "hidden" and their real display
// value as an explicit pair on every change, never left with both classes
// (or neither) at once - that ambiguity is what causes the classic
// "hidden not actually hiding it" Tailwind bug. #sidebar additionally
// carries a static md:flex, which - because responsive variants are always
// ordered after base utilities - keeps it visible on desktop no matter what
// JS does here.
function showChatView() {
  els.emptyState.classList.remove("flex");
  els.emptyState.classList.add("hidden");

  els.chatView.classList.remove("hidden");
  els.chatView.classList.add("flex");

  els.sidebar.classList.remove("flex");
  els.sidebar.classList.add("hidden");
}
function showConversationListView() {
  els.chatView.classList.remove("flex");
  els.chatView.classList.add("hidden");

  els.emptyState.classList.remove("hidden");
  els.emptyState.classList.add("flex");

  els.sidebar.classList.remove("hidden");
  els.sidebar.classList.add("flex");
}

function unsubscribeAll() {
  Object.keys(unsub).forEach((key) => {
    if (unsub[key]) {
      unsub[key]();
      unsub[key] = null;
    }
  });
}
