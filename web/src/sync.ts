// Optional sign-in, and each reader's notes, highlights, pins, saved sets, chats and settings kept in Firebase so
// they follow them between devices. Nothing here runs unless the site is built with a Firebase config
// (VITE_FIREBASE_* — see web/.env.example); without one the app works exactly as before, everything in the browser.
//
// How it works: the app keeps its data in localStorage under a few keys. This module mirrors those keys to
// Firestore (users/{uid}/blobs/{key}), merges what each device has when someone signs in, and listens for
// changes from their other devices. API keys for the assistant are never synced.
import { useSyncExternalStore } from "react";

const SYNCED = {
  "testimonia.notes.v1": "notes",
  "testimonia.pins.v1": "pins",
  "testimonia.settings.v1": "settings",
  "testimonia.ai.chats.v1": "chats",
  "testimonia.ai.config": "assistant", // provider and model only; the API key is stored apart and never synced
  "testimonia.plans": "plans", // reading plan progress
  "testimonia.lastRead": "reading", // where you were reading
  "testimonia.activity": "activity", // days with reading (streak)
  "testimonia.profile": "profile", // the name you chose
} as const;
type Key = keyof typeof SYNCED;
const KEYS = Object.keys(SYNCED) as Key[];
const MAX_DOC = 900_000; // Firestore documents hold 1 MiB: long chat histories are trimmed to fit

const env = import.meta.env;
const config = env.VITE_FIREBASE_API_KEY
  ? {
      apiKey: env.VITE_FIREBASE_API_KEY as string,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string,
      projectId: env.VITE_FIREBASE_PROJECT_ID as string,
      appId: env.VITE_FIREBASE_APP_ID as string,
    }
  : null;
export const syncAvailable = config !== null;

// ----------------------------------------------------------------------------- status for the UI

export interface SyncState {
  status: "off" | "signed-out" | "connecting" | "synced" | "saving" | "error";
  ready: boolean; // the first sign-in check has answered (until then, signed-out may just mean "not known yet")
  user: { name: string | null; email: string | null; photo: string | null } | null;
  error?: string;
}
let state: SyncState = { status: config ? "signed-out" : "off", user: null, ready: !config };
const listeners = new Set<() => void>();
function setState(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
export function useSync(): SyncState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** Stores reload a key when another device changed it (each store listens for this). */
export const REMOTE_EVENT = "testimonia:synced";
export function onRemoteChange(key: string, reload: () => void): () => void {
  const h = (e: Event) => (e as CustomEvent<string>).detail === key && reload();
  window.addEventListener(REMOTE_EVENT, h);
  return () => window.removeEventListener(REMOTE_EVENT, h);
}

// ----------------------------------------------------------------------------- merging two devices' data

type Json = Record<string, unknown>;
const parse = (raw: string | null): unknown => {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

/** Both sides kept; where both changed the same item, the later edit wins. */
export function merge(key: Key, local: unknown, remote: unknown): unknown {
  if (local == null) return remote;
  if (remote == null) return local;
  if (key === "testimonia.notes.v1") {
    const out: Json = { ...(remote as Json) };
    for (const [osis, n] of Object.entries(local as Record<string, { updated?: string }>)) {
      const r = out[osis] as { updated?: string } | undefined;
      if (!r || (n.updated ?? "") >= (r.updated ?? "")) out[osis] = n;
    }
    return out;
  }
  if (key === "testimonia.pins.v1") {
    const l = local as { pinned: string[]; sets: { id: string; created?: string }[] };
    const r = remote as typeof l;
    const sets = new Map((r.sets ?? []).map((s) => [s.id, s]));
    for (const s of l.sets ?? []) sets.set(s.id, s);
    return { pinned: [...new Set([...(r.pinned ?? []), ...(l.pinned ?? [])])], sets: [...sets.values()] };
  }
  if (key === "testimonia.ai.chats.v1") {
    const byId = new Map<string, { id: string; updated?: string }>();
    for (const c of [...((remote as { id: string; updated?: string }[]) ?? []), ...((local as { id: string; updated?: string }[]) ?? [])]) {
      const have = byId.get(c.id);
      if (!have || (c.updated ?? "") >= (have.updated ?? "")) byId.set(c.id, c);
    }
    return [...byId.values()].sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? "")).slice(0, 100);
  }
  if (key === "testimonia.activity") return [...new Set([...((remote as string[]) ?? []), ...((local as string[]) ?? [])])].sort().slice(-400);
  if (key === "testimonia.plans") {
    const out: Record<string, { start: string | null; done: number[] }> = { ...(remote as Record<string, { start: string | null; done: number[] }>) };
    for (const [id, p] of Object.entries(local as typeof out)) {
      const r = out[id];
      out[id] = r ? { start: r.start ?? p.start, done: [...new Set([...(r.done ?? []), ...(p.done ?? [])])].sort((a, b) => a - b) } : p;
    }
    return out;
  }
  return remote; // settings, the assistant choice, the reading position: the account's (newest from any device)
}

function fit(key: Key, value: unknown): string {
  let json = JSON.stringify(value);
  if (key === "testimonia.ai.chats.v1" && Array.isArray(value)) {
    let list = value as unknown[];
    while (json.length > MAX_DOC && list.length > 1) {
      list = list.slice(0, Math.max(1, Math.floor(list.length * 0.8)));
      json = JSON.stringify(list);
    }
  }
  return json;
}

// ----------------------------------------------------------------------------- Firebase (loaded only when configured)

/* eslint-disable @typescript-eslint/no-explicit-any */
let fb: {
  auth: any;
  db: any;
  mod: { auth: typeof import("firebase/auth"); store: typeof import("firebase/firestore") };
} | null = null;
let uid: string | null = null;
let applying = false; // writing what came from Firebase: not a local change to send back
const timers = new Map<Key, number>();
const unsubs: (() => void)[] = [];

async function firebase() {
  if (fb || !config) return fb;
  const [{ initializeApp }, auth, store] = await Promise.all([import("firebase/app"), import("firebase/auth"), import("firebase/firestore")]);
  const app = initializeApp(config);
  fb = { auth: auth.getAuth(app), db: store.getFirestore(app), mod: { auth, store } };
  return fb;
}

function writeLocal(key: Key, json: string) {
  applying = true;
  try {
    localStorage.setItem(key, json);
  } finally {
    applying = false;
  }
  window.dispatchEvent(new CustomEvent(REMOTE_EVENT, { detail: key }));
}

async function upload(key: Key): Promise<boolean> {
  const f = await firebase();
  if (!f || !uid) return false;
  setState({ status: "saving" });
  try {
    const value = parse(localStorage.getItem(key));
    const { doc, setDoc, serverTimestamp } = f.mod.store;
    await setDoc(doc(f.db, "users", uid, "blobs", SYNCED[key]), { json: fit(key, value), updated: serverTimestamp() });
    setState({ status: "synced" });
    return true;
  } catch (e) {
    setState({ status: "error", error: String(e) });
    return false;
  }
}

/** Local changes go up a few seconds later, batched (keeps Firestore writes, and cost, low). */
function scheduleUpload(key: Key) {
  if (!uid || applying) return;
  window.clearTimeout(timers.get(key));
  timers.set(key, window.setTimeout(() => void upload(key), 2500));
}

async function connect(user: { uid: string; displayName: string | null; email: string | null; photoURL: string | null }) {
  const f = (await firebase())!;
  const { doc, getDoc, onSnapshot } = f.mod.store;
  uid = user.uid;
  setState({ status: "connecting", user: { name: user.displayName, email: user.email, photo: user.photoURL } });
  try {
    for (const key of KEYS) {
      const ref = doc(f.db, "users", uid, "blobs", SYNCED[key]);
      const snap = await getDoc(ref);
      const remote = snap.exists() ? parse(snap.data().json as string) : null;
      const merged = merge(key, parse(localStorage.getItem(key)), remote);
      if (merged != null) {
        const json = JSON.stringify(merged);
        if (json !== localStorage.getItem(key)) writeLocal(key, json);
        if (!snap.exists() || json !== (snap.data().json as string)) await upload(key);
      }
      // changes made on the reader's other devices
      unsubs.push(
        onSnapshot(ref, (s: any) => {
          if (!s.exists() || s.metadata.hasPendingWrites) return;
          const incoming = s.data().json as string;
          if (incoming === localStorage.getItem(key)) return;
          writeLocal(key, JSON.stringify(merge(key, parse(localStorage.getItem(key)), parse(incoming))));
        }),
      );
    }
    setState({ status: "synced" });
  } catch (e) {
    setState({ status: "error", error: String(e) });
  }
}

function disconnect() {
  unsubs.splice(0).forEach((u) => u());
  uid = null;
  setState({ status: "signed-out", user: null });
}

/** Start listening for sign-in (call once at startup). */
export async function startSync(): Promise<void> {
  if (!config) return;
  // every write to a synced key is a local change to send up
  const original = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k: string, v: string) {
    original.call(this, k, v);
    if (this === window.localStorage && k in SYNCED) scheduleUpload(k as Key);
  };
  const f = (await firebase())!;
  f.mod.auth.onAuthStateChanged(f.auth, (user: any) => {
    setState({ ready: true });
    if (user) void connect(user);
    else disconnect();
  });
  try {
    await f.mod.auth.getRedirectResult(f.auth); // finishing a sign-in that went by redirect (phones)
  } catch {
    /* no redirect pending */
  }
}

export async function signIn(): Promise<void> {
  const f = await firebase();
  if (!f) return;
  const { GoogleAuthProvider, signInWithPopup, signInWithRedirect } = f.mod.auth;
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(f.auth, provider);
  } catch (e) {
    // popups are often blocked on phones and in installed apps: go by redirect instead
    if (String(e).includes("popup")) await signInWithRedirect(f.auth, provider);
    else setState({ status: "error", error: String(e) });
  }
}

/** Friendly words for Firebase's error codes. */
function authMessage(e: unknown): string {
  const code = String((e as { code?: string })?.code ?? e);
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) return "That email and password don't match an account.";
  if (code.includes("email-already-in-use")) return "There is already an account with this email — sign in instead.";
  if (code.includes("weak-password")) return "Choose a password of at least 6 characters.";
  if (code.includes("invalid-email")) return "That doesn't look like an email address.";
  if (code.includes("too-many-requests")) return "Too many attempts — try again in a few minutes.";
  if (code.includes("network")) return "No connection — check your internet and try again.";
  return "Something went wrong. Please try again.";
}

/** Email sign-in: 'signin' an existing account or 'create' a new one. Returns an error message, or null. */
export async function signInWithEmail(mode: "signin" | "create", email: string, password: string): Promise<string | null> {
  const f = await firebase();
  if (!f) return "Sign-in is not set up.";
  const a = f.mod.auth;
  try {
    if (mode === "create") await a.createUserWithEmailAndPassword(f.auth, email.trim(), password);
    else await a.signInWithEmailAndPassword(f.auth, email.trim(), password);
    return null;
  } catch (e) {
    return authMessage(e);
  }
}

/** Send a password-reset email. Returns an error message, or null. */
export async function resetPassword(email: string): Promise<string | null> {
  const f = await firebase();
  if (!f) return "Sign-in is not set up.";
  try {
    await f.mod.auth.sendPasswordResetEmail(f.auth, email.trim());
    return null;
  } catch (e) {
    return authMessage(e);
  }
}

/** Send every waiting change to the account now. False if any did not get there (offline, error). */
export async function flush(): Promise<boolean> {
  timers.forEach((t) => window.clearTimeout(t));
  timers.clear();
  if (!uid) return true;
  if (!navigator.onLine) return false;
  const done = await Promise.all(KEYS.filter((k) => localStorage.getItem(k) !== null).map((k) => upload(k)));
  return done.every(Boolean);
}

/** Sign out: everything kept with the account is first saved to it, then removed from this device (it comes back
 *  on signing in). Display settings stay; the assistant's API key goes too only if asked. Returns false, doing
 *  nothing, when changes could not be saved, unless `force`. */
export async function signOut(opts: { forgetKey?: boolean; force?: boolean } = {}): Promise<boolean> {
  const f = await firebase();
  if (!f) return true;
  if (!(await flush()) && !opts.force) return false;
  unsubs.splice(0).forEach((u) => u());
  await f.mod.auth.signOut(f.auth);
  for (const key of KEYS) {
    if (key === "testimonia.settings.v1") continue; // theme, text size, layout: the device's
    localStorage.removeItem(key);
    window.dispatchEvent(new CustomEvent(REMOTE_EVENT, { detail: key })); // the open pages empty themselves
  }
  localStorage.removeItem("testimonia.ai.chat.current");
  localStorage.removeItem("testimonia.ai.current");
  if (opts.forgetKey) {
    localStorage.removeItem("testimonia.ai.key");
    sessionStorage.removeItem("testimonia.ai.key");
  }
  return true;
}

/** Delete everything stored for this account, and the account. What is on this device stays. */
export async function deleteAccount(): Promise<void> {
  const f = await firebase();
  const user = f?.auth.currentUser;
  if (!f || !user) return;
  const { doc, deleteDoc } = f.mod.store;
  for (const key of KEYS) await deleteDoc(doc(f.db, "users", user.uid, "blobs", SYNCED[key]));
  unsubs.splice(0).forEach((u) => u());
  uid = null;
  try {
    await f.mod.auth.deleteUser(user);
  } catch {
    // Firebase asks for a recent sign-in before deleting an account
    if (user.providerData.some((p: { providerId: string }) => p.providerId === "google.com")) {
      await f.mod.auth.reauthenticateWithPopup(user, new f.mod.auth.GoogleAuthProvider());
    } else {
      const password = window.prompt("To delete your account, enter your password once more:");
      if (!password) return;
      await f.mod.auth.reauthenticateWithCredential(user, f.mod.auth.EmailAuthProvider.credential(user.email, password));
    }
    await f.mod.auth.deleteUser(user);
  }
  setState({ status: "signed-out", user: null });
}
