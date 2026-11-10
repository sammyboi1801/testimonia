import { useEffect, useRef, useState } from "react";
import { deleteAccount, resetPassword, signIn, signInWithEmail, signOut, syncAvailable, useSync } from "../sync";

const STATUS: Record<string, string> = {
  connecting: "Syncing…",
  saving: "Saving…",
  synced: "Synced across your devices",
  error: "Sync problem — your data is safe on this device",
};

/** Sign in to keep notes, highlights, pins, chats and settings on every device. Hidden when sync is not set up. */
export function AccountButton() {
  const s = useSync();
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  if (!syncAvailable) return null;

  if (!s.user)
    return (
      <div className="account" ref={box}>
        <button className="account-signin" onClick={() => setOpen(!open)} aria-expanded={open} title="Keep your notes, pins and chats on every device">
          Sign in to sync
        </button>
        {open && <SignInCard />}
      </div>
    );

  const initial = (s.user.name ?? s.user.email ?? "?").slice(0, 1).toUpperCase();
  return (
    <div className="account" ref={box}>
      <button className={`account-avatar status-${s.status}`} onClick={() => setOpen(!open)} aria-label="Your account" aria-expanded={open}>
        {s.user.photo ? <img src={s.user.photo} alt="" referrerPolicy="no-referrer" /> : <span>{initial}</span>}
      </button>
      {open && (
        <div className="account-card" role="dialog" aria-label="Your account">
          <strong>{s.user.name ?? "Signed in"}</strong>
          {s.user.email && <span className="muted small">{s.user.email}</span>}
          <span className={`account-status status-${s.status}`}>{STATUS[s.status] ?? ""}</span>
          <p className="muted small">
            Your notes, highlights, pins, saved sets, chats and settings are kept with your account. Assistant API keys stay on this device only.
          </p>
          {leaving && <SignOutStep onDone={() => { setLeaving(false); setOpen(false); }} onCancel={() => setLeaving(false)} />}
          <div className="account-actions" hidden={leaving}>
            <button className="btn" onClick={() => setLeaving(true)}>
              Sign out
            </button>
            <button
              className="btn danger"
              onClick={() => {
                if (window.confirm("Delete your account and everything stored with it? What is on this device stays.")) void deleteAccount().then(() => setOpen(false));
              }}
            >
              Delete my account
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Google, or an email and password (with a reset link for forgotten passwords). */
function SignInCard() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok?: boolean } | null>(null);
  const run = async (mode: "signin" | "create") => {
    setBusy(true);
    setMessage(null);
    const err = await signInWithEmail(mode, email, password);
    setBusy(false);
    if (err) setMessage({ text: err });
  };
  return (
    <div className="account-card" role="dialog" aria-label="Sign in">
      <strong>Sign in to sync</strong>
      <p className="muted small">Keep your notes, highlights, pins and chats on every device. Everything still works without an account.</p>
      <button className="btn account-google" onClick={() => void signIn()} disabled={busy}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
          <path fill="#4285F4" d="M22.6 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6c-.3 1.4-1.1 2.6-2.3 3.4v2.8h3.7c2.1-2 3.2-4.9 3.2-8.3Z" />
          <path fill="#34A853" d="M12 23c3.1 0 5.7-1 7.6-2.8l-3.7-2.8c-1 .7-2.3 1.1-3.9 1.1-3 0-5.5-2-6.4-4.7H1.8v2.9C3.7 20.5 7.6 23 12 23Z" />
          <path fill="#FBBC05" d="M5.6 13.8c-.2-.7-.4-1.4-.4-2.2s.1-1.5.4-2.2V6.5H1.8C1 8 .6 9.7.6 11.6s.4 3.6 1.2 5.1l3.8-2.9Z" />
          <path fill="#EA4335" d="M12 4.8c1.7 0 3.2.6 4.4 1.7l3.3-3.3C17.7 1.3 15.1.2 12 .2 7.6.2 3.7 2.7 1.8 6.5l3.8 2.9C6.5 6.7 9 4.8 12 4.8Z" />
        </svg>
        Continue with Google
      </button>
      <div className="account-or">
        <span>or with email</span>
      </div>
      <form
        className="account-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run("signin");
        }}
      >
        <input type="email" autoComplete="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
        {message && <span className={message.ok ? "account-ok" : "account-error"}>{message.text}</span>}
        <div className="account-actions">
          <button className="btn primary" type="submit" disabled={busy || !email || !password}>
            Sign in
          </button>
          <button className="btn" type="button" disabled={busy || !email || password.length < 6} onClick={() => void run("create")}>
            Create account
          </button>
        </div>
        <button
          className="link-btn account-forgot"
          type="button"
          disabled={!email}
          onClick={async () => {
            const err = await resetPassword(email);
            setMessage(err ? { text: err } : { text: "Check your email for a link to set a new password.", ok: true });
          }}
        >
          Forgot password?
        </button>
      </form>
    </div>
  );
}

/** Sign out: what leaves this device, and whether the assistant's key goes too. */
function SignOutStep({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const hasKey = (() => {
    try {
      return !!(localStorage.getItem("testimonia.ai.key") || sessionStorage.getItem("testimonia.ai.key"));
    } catch {
      return false;
    }
  })();
  const [forgetKey, setForgetKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [unsynced, setUnsynced] = useState(false);
  const go = async (force: boolean) => {
    setBusy(true);
    const ok = await signOut({ forgetKey, force });
    setBusy(false);
    if (ok) onDone();
    else setUnsynced(true);
  };
  return (
    <div className="account-leave">
      <strong>Sign out of this device?</strong>
      <p className="muted small">
        Your notes, highlights, places, conversations, plans and reading position are saved to your account first, then removed from this
        device. They come back when you sign in again. Theme and text size stay.
      </p>
      {hasKey && (
        <label className="account-check">
          <input type="checkbox" checked={forgetKey} onChange={(e) => setForgetKey(e.target.checked)} />
          Also remove my assistant API key from this device
        </label>
      )}
      {unsynced && (
        <p className="account-error">
          Some changes couldn’t be saved to your account (are you offline?). Signing out now would lose them from this device.
        </p>
      )}
      <div className="account-actions">
        {unsynced ? (
          <button className="btn danger" disabled={busy} onClick={() => void go(true)}>
            Sign out anyway
          </button>
        ) : (
          <button className="btn primary" disabled={busy} onClick={() => void go(false)}>
            {busy ? "Saving…" : "Sign out"}
          </button>
        )}
        <button className="btn" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
