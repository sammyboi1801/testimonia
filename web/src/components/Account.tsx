import { useEffect, useRef, useState } from "react";
import { deleteAccount, signIn, signOut, syncAvailable, useSync } from "../sync";

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
      <button className="account-signin" onClick={() => void signIn()} title="Keep your notes, pins and chats on every device">
        Sign in to sync
      </button>
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
          <div className="account-actions">
            <button className="btn" onClick={() => void signOut().then(() => setOpen(false))}>
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
