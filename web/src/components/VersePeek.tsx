import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useChapter, useMeta } from "../api";
import { useSettings } from "../settings";

/** A verse (or a few) in a small box beside the chat, so a reference can be read without leaving the conversation. */

export interface PeekTarget {
  href: string; // /read/John/3?v=John.3.16&to=18
  rect: DOMRect; // the link that was tapped
}

const FALLBACK = ["web", "kjva", "bsb"];

function parse(href: string): { book: string; chapter: number; from: number | null; to: number | null } | null {
  const u = new URL(href, window.location.origin);
  const m = u.pathname.match(/^\/read\/([^/]+)\/(\d+)/);
  if (!m) return null;
  const v = u.searchParams.get("v")?.split(".")[2];
  const from = v ? Number(v) : null;
  const to = Number(u.searchParams.get("to")) || null;
  return { book: decodeURIComponent(m[1]!), chapter: Number(m[2]), from, to };
}

export function VersePeek({ target, onClose }: { target: PeekTarget; onClose: () => void }) {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const meta = useMeta();
  const ref = parse(target.href);
  const editions = [...new Set([settings.editions[0] ?? "bsb", ...FALLBACK])];
  const data = useChapter(ref?.book ?? "John", ref?.chapter ?? 1, editions);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean }>({ left: 12, top: 0, above: false });

  // beside the link: below it if there is room, else above; always inside the window
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const r = target.rect;
    const left = Math.max(12, Math.min(window.innerWidth - w - 12, r.left + r.width / 2 - w / 2));
    const below = r.bottom + 10 + h < window.innerHeight - 12;
    setPos({ left, top: below ? r.bottom + 10 : Math.max(12, r.top - h - 10), above: !below });
  }, [target, data.data]);

  useEffect(() => {
    const away = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) onClose();
    };
    const scroll = (e: Event) => {
      if (!box.current?.contains(e.target as Node)) onClose(); // the chat moved: the box would be adrift
    };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", away);
    document.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", away);
      document.removeEventListener("scroll", scroll, true);
    };
  }, [onClose]);

  if (!ref) return null;
  const bookName = meta.data?.books.find((b) => b.osis === ref.book)?.name ?? ref.book;
  const verses = data.data?.verses ?? [];
  const first = ref.from ?? verses.find((v) => v.verse > 0)?.verse ?? 1;
  const last = ref.to ?? (ref.from ? ref.from : first + 2); // a chapter link shows its opening verses
  const shown = verses.filter((v) => v.verse >= first && v.verse <= last);
  const ed = editions.find((e) => shown.some((v) => v.texts[e]?.text)) ?? editions[0]!;
  const abbrev = meta.data?.editions.find((e) => e.id === ed)?.abbrev ?? ed.toUpperCase();
  const label = `${bookName} ${ref.chapter}${ref.from ? `:${first}${last > first ? `–${last}` : ""}` : ""}`;

  return (
    <div ref={box} className={`verse-peek${pos.above ? " above" : ""}`} style={{ left: pos.left, top: pos.top }} role="dialog" aria-label={label}>
      <div className="vp-head">
        <strong>{label}</strong>
        <span className="vp-ed">{abbrev}</span>
        <button className="vp-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="vp-text">
        {data.isLoading && (
          <>
            <div className="skel" style={{ height: 14, width: "95%", marginBottom: 10 }} />
            <div className="skel" style={{ height: 14, width: "70%" }} />
          </>
        )}
        {shown.map((v) => (
          <span key={v.verse}>
            {shown.length > 1 && <sup>{v.verse}</sup>}
            {v.texts[ed]?.text}{" "}
          </span>
        ))}
        {!data.isLoading && !shown.length && <span className="muted">This passage could not be found.</span>}
      </div>
      <button
        className="vp-open"
        onClick={() => {
          onClose();
          navigate(target.href);
        }}
      >
        Open in the reader →
      </button>
    </div>
  );
}

/** Plain references in an answer ("John 3:16", "Rom 8:28–30") become links the peek can open; existing links and code
 *  are left alone. `books` are the Bible's books with their names. */
export function linkRefs(text: string, books: { osis: string; name: string }[]): string {
  if (!books.length) return text;
  const names = new Map<string, string>();
  for (const b of books) {
    names.set(b.name.toLowerCase(), b.osis);
    names.set(b.osis.toLowerCase(), b.osis);
    if (b.osis === "Ps") names.set("psalm", "Ps");
  }
  const alt = [...names.keys()].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s"));
  const re = new RegExp(`(?<![\\w/\\[])(${alt.join("|")})\\.?\\s+(\\d{1,3}):(\\d{1,3})(?:\\s*[–-]\\s*(\\d{1,3}))?(?![\\w:])`, "gi");
  // leave markdown links, images and code exactly as they are
  return text
    .split(/(!?\[[^\]]*\]\([^)]*\)|`[^`]*`)/)
    .map((part, i) =>
      i % 2
        ? part
        : part.replace(re, (all, name: string, ch: string, v: string, to?: string) => {
            const osis = names.get(name.toLowerCase().replace(/\s+/g, " "));
            if (!osis) return all;
            return `[${all}](/read/${osis}/${ch}?v=${osis}.${ch}.${v}${to ? `&to=${to}` : ""})`;
          }),
    )
    .join("");
}
