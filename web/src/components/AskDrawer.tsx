import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Chat } from "./Chat";
import { useBackClose } from "../backClose";


interface AskRequest {
  context: string | null;
  question?: string;
}

const EVENT = "testimonia:ask";

/** Open the assistant drawer from anywhere, optionally about a verse ("John 1:18") and with a question. */
export function openAsk(context: string | null = null, question?: string): void {
  window.dispatchEvent(new CustomEvent<AskRequest>(EVENT, { detail: { context, question } }));
}

/** What the reader has on screen right now, for the assistant: read at the moment a question is sent, so it
 *  follows the reader around the site. Built from the address (ids the tools understand) and the page heading. */
export function screenContext(): string {
  const { pathname, search } = window.location;
  const q = new URLSearchParams(search);
  const heading = (document.querySelector("main h1, .page h1, .work-text h1, .work-text h2, h1")?.textContent ?? "").trim().slice(0, 140);
  const parts: string[] = [];
  let m: RegExpExecArray | null;
  if ((m = /^\/read\/([^/]+)\/(\d+)/.exec(pathname))) {
    parts.push(`the Bible reader at ${m[1]} ${m[2]}`);
    const v = q.get("v");
    if (v) parts.push(`verse ${v} selected (study panel open${q.get("t") ? `, ${q.get("t")} tab` : ""})`);
  } else if ((m = /^\/library\/([^/]+)\/(\d+)/.exec(pathname))) {
    parts.push(`the library, reading edition=${decodeURIComponent(m[1]!)} section=${m[2]}${heading ? ` ("${heading}")` : ""}`);
  } else if (pathname.startsWith("/atlas")) {
    parts.push(`the atlas${q.get("place") ? `, place ${q.get("place")} selected` : ""}`);
  } else if ((m = /^\/(book|manuscript|person|place|event|topic|parallels|passage|domains)\/(.+)$/.exec(pathname))) {
    parts.push(`the ${m[1]} page ${decodeURIComponent(m[2]!)}${heading ? ` ("${heading}")` : ""}`);
  } else if (pathname.startsWith("/library")) {
    parts.push(`the library (${q.get("view") ?? "bookshelf"} view)`);
  } else if (pathname.startsWith("/search")) {
    parts.push(`search results for "${q.get("q") ?? ""}"`);
  } else {
    parts.push(`the page ${pathname}${heading ? ` ("${heading}")` : ""}`);
  }
  return `${parts.join("; ")} — address ${pathname}${search}`;
}

function contextFromUrl(pathname: string, search: string): string | null {
  const v = new URLSearchParams(search).get("v");
  if (v) return v.replace(/^([1-4]?[A-Za-z]+)\.(\d+)\.(\d+)$/, "$1 $2:$3");
  const m = /^\/read\/([^/]+)\/(\d+)/.exec(pathname);
  return m ? `${m[1]} ${m[2]}` : null;
}

/** "✦ Ask AI" beside any text selected outside the Bible reader (which has its own selection toolbar):
 *  the fathers, manuscripts, Wikipedia cards, book pages… The question carries the selection and the page. */
function SelectionAsk() {
  const [at, setAt] = useState<{ x: number; y: number; text: string } | null>(null);
  useEffect(() => {
    let timer: number | undefined;
    const check = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const sel = window.getSelection();
        const text = sel?.toString().trim() ?? "";
        if (!sel || sel.isCollapsed || text.length < 3 || sel.rangeCount === 0) return setAt(null);
        const node = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement;
        if (!node || node.closest(".reader, .ask-drawer, .ask-page, input, textarea, .sel-bar")) return setAt(null);
        const r = sel.getRangeAt(0).getBoundingClientRect();
        if (!r.width && !r.height) return setAt(null);
        setAt({ x: Math.min(Math.max(8, r.left + r.width / 2 - 50), window.innerWidth - 120), y: r.top > 60 ? r.top - 40 : r.bottom + 8, text });
      }, 180);
    };
    document.addEventListener("selectionchange", check);
    return () => {
      document.removeEventListener("selectionchange", check);
      window.clearTimeout(timer);
    };
  }, []);
  if (!at) return null;
  const quote = at.text.length > 600 ? `${at.text.slice(0, 600)}…` : at.text;
  return (
    <button
      className="sel-ask-float"
      style={{ left: at.x, top: at.y }}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        openAsk(null, `Explain this passage from the page I am reading:\n\n“${quote}”`);
        window.getSelection()?.removeAllRanges();
        setAt(null);
      }}
    >
      ✦ Ask AI
    </button>
  );
}

/** A floating ✦ Ask button on every page and the slide-over chat it opens. */
export function AskDrawer() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  useBackClose(open, () => setOpen(false));
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
  // phones: the ✦ button slides away while reading down the page and comes back on the way up
  const [tucked, setTucked] = useState(false);
  useEffect(() => {
    let last = 0;
    const onScroll = (e: Event) => {
      const el = e.target instanceof Element ? e.target : document.scrollingElement;
      if (!el || el.closest?.(".ask-drawer, .picker-pop, .wm-sheet, .menu")) return;
      const y = el.scrollTop;
      if (Math.abs(y - last) < 12) return;
      setTucked(y > last && y > 120);
      last = y;
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", onScroll, { capture: true });
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
      <SelectionAsk />
      {/* with a verse open, the study panel has its own "Ask AI" button */}
      {!open && !(location.pathname.startsWith("/read") && new URLSearchParams(location.search).has("v")) && (
        <button
          className={`ask-fab${tucked ? " tucked" : ""}`}
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
