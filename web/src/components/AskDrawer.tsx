import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Chat } from "./Chat";

interface AskRequest {
  context: string | null;
  question?: string;
}

const EVENT = "testimonia:ask";

/** Open the assistant drawer from anywhere, optionally about a verse ("John 1:18") and with a question. */
export function openAsk(context: string | null = null, question?: string): void {
  window.dispatchEvent(new CustomEvent<AskRequest>(EVENT, { detail: { context, question } }));
}

function contextFromUrl(pathname: string, search: string): string | null {
  const v = new URLSearchParams(search).get("v");
  if (v) return v.replace(/^([1-4]?[A-Za-z]+)\.(\d+)\.(\d+)$/, "$1 $2:$3");
  const m = /^\/read\/([^/]+)\/(\d+)/.exec(pathname);
  return m ? `${m[1]} ${m[2]}` : null;
}

/** A floating ✦ Ask button on every page and the slide-over chat it opens. */
export function AskDrawer() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [req, setReq] = useState<AskRequest>({ context: null });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const on = (e: Event) => {
      setReq((e as CustomEvent<AskRequest>).detail);
      setNonce((n) => n + 1);
      setOpen(true);
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  if (location.pathname.startsWith("/ask")) return null;

  return (
    <>
      {/* with a verse open, the study panel has its own "Ask AI" button */}
      {!open && !(location.pathname.startsWith("/read") && new URLSearchParams(location.search).has("v")) && (
        <button
          className="ask-fab"
          onClick={() => openAsk(contextFromUrl(location.pathname, location.search))}
          title="Ask the study assistant"
          aria-label="Ask the study assistant"
        >
          <span className="ask-fab-star" aria-hidden>
            ✦
          </span>
          <span className="ask-fab-label">Ask</span>
        </button>
      )}
      {open && (
        <div className="ask-layer" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <aside className="ask-drawer" role="dialog" aria-label="Study assistant">
            <header className="ask-drawer-head">
              <strong>✦ Study assistant</strong>
              {req.context && <span className="ask-context">{req.context}</span>}
              <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close">
                ✕
              </button>
            </header>
            <Chat key={nonce} context={req.context} initial={req.question} compact />
          </aside>
        </div>
      )}
    </>
  );
}
