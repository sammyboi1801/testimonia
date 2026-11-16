import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useChapter, useMeta, useSection } from "../api";
import { Html } from "./Html";
import { useSettings } from "../settings";

/** A verse (or a few) in a small box beside the chat, so a reference can be read without leaving the conversation. */

export interface PeekTarget {
  href: string; // /read/John/3?v=John.3.16&to=18, or /library/{edition}/{section}
  rect: DOMRect; // the link that was tapped
  quote?: string; // for a work: the words quoted, marked in the section
  label?: string; // for a work: its title as the link showed it
}

/** Links that open in a box rather than a page: a verse, or a section of a work. */
export const peekable = (href: string | null | undefined): href is string => !!href && (/^\/read\//.test(href) || /^\/library\/[^/?#]+\/\d+/.test(href));

export function Peek({ target, onClose }: { target: PeekTarget; onClose: () => void }) {
  return target.href.startsWith("/library/") ? <WorkPeek target={target} onClose={onClose} /> : <VersePeek target={target} onClose={onClose} />;
}

/** Where the box sits: beside the link, below it if there is room, else above; always inside the window. */
function usePlace(box: React.RefObject<HTMLDivElement | null>, rect: DOMRect, deps: unknown[]) {
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean }>({ left: 12, top: 0, above: false });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.max(12, Math.min(window.innerWidth - w - 12, rect.left + rect.width / 2 - w / 2));
    const below = rect.bottom + 10 + h < window.innerHeight - 12;
    setPos({ left, top: below ? rect.bottom + 10 : Math.max(12, rect.top - h - 10), above: !below });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rect, ...deps]);
  return pos;
}

/** Closes on a tap outside, Esc, or when the page under it scrolls. */
function useDismiss(box: React.RefObject<HTMLDivElement | null>, onClose: () => void) {
  useEffect(() => {
    const away = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) onClose();
    };
    const scroll = (e: Event) => {
      if (!box.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", away);
    document.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", away);
      document.removeEventListener("scroll", scroll, true);
    };
  }, [box, onClose]);
}

/** A section of an early Christian work in a box, scrolled to the words quoted and marked. */
function WorkPeek({ target, onClose }: { target: PeekTarget; onClose: () => void }) {
  const navigate = useNavigate();
  const m = target.href.match(/^\/library\/([^/?#]+)\/(\d+)/)!;
  const edition = decodeURIComponent(m[1]!);
  const data = useSection(edition, Number(m[2]));
  const box = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const pos = usePlace(box, target.rect, [data.data]);
  useDismiss(box, onClose);
  // find the quoted words in the section and mark them
  useEffect(() => {
    const root = body.current;
    if (!root || !data.data || !target.quote) return;
    const words = target.quote.replace(/\.{3}|…/g, " ").replace(/\s+/g, " ").trim().split(" ");
    const probe = words.slice(Math.min(3, Math.max(0, words.length - 8)), Math.min(3, Math.max(0, words.length - 8)) + 6).join(" ");
    if (probe.length < 12) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent ?? "").replace(/\s+/g, " ");
      const i = text.indexOf(probe);
      if (i < 0) continue;
      try {
        const range = document.createRange();
        range.setStart(n, i);
        range.setEnd(n, Math.min((n.textContent ?? "").length, i + probe.length));
        const mark = document.createElement("mark");
        range.surroundContents(mark);
        mark.scrollIntoView({ block: "center" });
      } catch {
        /* the quote crosses markup: leave it unmarked */
      }
      break;
    }
  }, [data.data, target.quote]);
  const s = data.data?.section;
  const label = [target.label, s?.cite && !target.label?.includes(s.cite) ? s.cite : ""].filter(Boolean).join(" ") || s?.title || "From the library";
  return (
    <div ref={box} className={`verse-peek work-peek${pos.above ? " above" : ""}`} style={{ left: pos.left, top: pos.top }} role="dialog" aria-label={label}>
      <div className="vp-head">
        <strong>{label}</strong>
        <button className="vp-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="vp-text wp-text" ref={body}>
        {data.isLoading && (
          <>
            <div className="skel" style={{ height: 14, width: "95%", marginBottom: 10 }} />
            <div className="skel" style={{ height: 14, width: "80%", marginBottom: 10 }} />
            <div className="skel" style={{ height: 14, width: "60%" }} />
          </>
        )}
        {s && <Html html={s.html} />}
        {data.error && <span className="muted">This section could not be loaded.</span>}
      </div>
      <button
        className="vp-open"
        onClick={() => {
          onClose();
          navigate(target.href);
        }}
      >
        Read the whole work →
      </button>
    </div>
  );
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
  const pos = usePlace(box, target.rect, [data.data]);
  useDismiss(box, onClose);

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
