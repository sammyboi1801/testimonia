// The assistant's answer, drawn as Testimonia draws everything else: a verse on its own line becomes a card with
// its words, a quoted father becomes a pull-quote under his name, links carry a small sign of what they open, and
// paintings show inline with their credit. Paragraphs fade in as they stream, instead of the whole answer redrawing.
//
// The answer stays markdown (as it is saved and copied); this only changes how it is shown. Every link keeps its
// href, so a tap still peeks at a verse or a work, or opens the page.

import { createElement, Fragment, memo, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { useQuery } from "@tanstack/react-query";
import { chapterQuery, useMeta } from "../api";
import { useBackClose } from "../backClose";
import { useSettings } from "../settings";
import { linkRefs } from "./VersePeek";

type Books = { osis: string; name: string }[];

const VOID = new Set(["br", "hr", "img", "wbr"]);
const MAX_CARDS = 4; // verse cards per answer; any more stay as links
/** Images shown inline: Wikimedia's (freely licensed, credited by the assistant); anything else stays a link. */
const IMAGE_HOSTS = /^https:\/\/(upload|thumb)\.wikimedia\.org\//;
const TEXT_EDS = (e: string) => e !== "tagnt" && e !== "tahot" && e !== "lxx";

export type LinkKind = "verse" | "word" | "work" | "place" | "person" | "event" | "passage" | "manuscript" | "topic" | "external" | "page";

/** What a link opens, from its href. */
export function linkKind(href: string): LinkKind {
  if (/^https?:\/\//.test(href)) return "external";
  if (/^\/read\//.test(href)) return /[?&]w=/.test(href) ? "word" : "verse";
  if (/^\/library\/[^/?#]+\/\d+/.test(href)) return "work";
  if (/^\/place\/|^\/atlas\?(?:.*&)?place=/.test(href)) return "place";
  if (/^\/person\//.test(href)) return "person";
  if (/^\/event\//.test(href)) return "event";
  if (/^\/passage\//.test(href)) return "passage";
  if (/^\/manuscript\//.test(href)) return "manuscript";
  if (/^\/topic\//.test(href)) return "topic";
  return "page";
}

const ICON_PATH: Partial<Record<LinkKind, string>> = {
  verse: "M4 5.5C6 4.5 8.5 4.5 12 6v13c-3.5-1.5-6-1.5-8-.5Zm16 0c-2-1-4.5-1-8 .5v13c3.5-1.5 6-1.5 8-.5Z",
  passage: "M4 5.5C6 4.5 8.5 4.5 12 6v13c-3.5-1.5-6-1.5-8-.5Zm16 0c-2-1-4.5-1-8 .5v13c3.5-1.5 6-1.5 8-.5Z",
  work: "M7 4h8l3 3v13H7Zm8 0v3h3M10 11h5m-5 3h5m-5 3h3",
  manuscript: "M6 4h12v16H6ZM9 8h6M9 11h6M9 14h4",
  place: "M12 21s-6-5.5-6-10a6 6 0 1 1 12 0c0 4.5-6 10-6 10Zm0-8a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  person: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8c1-3.5 4-5 7-5s6 1.5 7 5",
  event: "M5 6h14v14H5ZM5 10h14M9 3v4m6-4v4",
  topic: "M5 7h14M5 12h14M5 17h9",
  word: "M5 5h14v10H9l-4 4ZM9 9h6M9 12h4", // a word's meaning: a speech bubble
};

function LinkIcon({ kind }: { kind: LinkKind }) {
  const d = ICON_PATH[kind];
  if (!d) return null;
  return (
    <svg className="cl-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

function Chip({ href, title, children }: { href: string; title?: string; children: ReactNode }) {
  const kind = linkKind(href);
  if (kind === "external")
    return (
      <a href={href} title={title} className="chip-link cl-external" target="_blank" rel="noreferrer noopener">
        {children}
        <span className="cl-out" aria-hidden>↗</span>
      </a>
    );
  return (
    <a href={href} title={title} className={`chip-link cl-${kind}`}>
      <LinkIcon kind={kind} />
      {children}
    </a>
  );
}

/** "/read/John/3?v=John.3.16&to=18" → the verse and the last verse of the range. */
function verseOf(href: string): { osis: string; to: number | null } | null {
  try {
    const u = new URL(href, "https://x.invalid");
    const osis = u.searchParams.get("v");
    if (!osis || !/^[1-4]?[A-Za-z]+\.\d+\.\d+$/.test(osis)) return null;
    return { osis, to: Number(u.searchParams.get("to")) || null };
  } catch {
    return null;
  }
}

/** A verse (or a few) shown with its words, in the reader's own translation. */
function VerseCard({ href, label }: { href: string; label: string }) {
  const v = verseOf(href)!;
  const [book, c, n] = v.osis.split(".") as [string, string, string];
  const { settings } = useSettings();
  const ed = settings.editions.find(TEXT_EDS) ?? "bsb";
  const meta = useMeta();
  const q = useQuery(chapterQuery(book, Number(c), [ed]));
  const from = Number(n);
  const to = v.to && v.to > from ? Math.min(v.to, from + 5) : from;
  const verses = (q.data?.verses ?? []).filter((x) => x.verse >= from && x.verse <= to && x.texts[ed]?.text);
  const abbrev = meta.data?.editions.find((e) => e.id === ed)?.abbrev ?? ed.toUpperCase();
  if (q.isError || (q.data && !verses.length))
    return (
      <p className="ans-in">
        <Chip href={href}>{label}</Chip>
      </p>
    );
  return (
    <figure className="ans-verse ans-in">
      {verses.length ? (
        <blockquote>
          {verses.map((x, i) => (
            <Fragment key={x.vkey}>
              {verses.length > 1 && <sup>{x.verse}</sup>}
              {x.texts[ed]!.text}
              {i < verses.length - 1 ? " " : ""}
            </Fragment>
          ))}
        </blockquote>
      ) : (
        <div className="ans-verse-skel" aria-label={`Loading ${label}`}>
          <span />
          <span />
        </div>
      )}
      <figcaption>
        <Chip href={href}>{label}</Chip>
        <span className="ans-ed">{abbrev}</span>
      </figcaption>
    </figure>
  );
}

/** A painting or manuscript image, with its caption; a tap shows it large. */
function AnswerImage({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false);
  useBackClose(open, () => setOpen(false));
  if (!IMAGE_HOSTS.test(src))
    return (
      <a href={src} className="chip-link cl-external" target="_blank" rel="noreferrer noopener">
        {alt || "image"}
        <span className="cl-out" aria-hidden>↗</span>
      </a>
    );
  return (
    <span className="ans-fig">
      <button type="button" className="ans-fig-btn" onClick={() => setOpen(true)} aria-label={`Show ${alt || "the image"} larger`}>
        <img src={src} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
      </button>
      {alt && <span className="ans-cap">{alt}</span>}
      {open &&
        createPortal(
          <div className="art-view" role="dialog" aria-label={alt} onClick={() => setOpen(false)}>
            <figure onClick={(e) => e.stopPropagation()}>
              <img src={src} alt={alt} referrerPolicy="no-referrer" />
              {alt && (
                <figcaption>
                  <strong>{alt}</strong>
                </figcaption>
              )}
              <button className="icon-btn art-close" onClick={() => setOpen(false)} aria-label="Close">
                ✕
              </button>
            </figure>
          </div>,
          document.body,
        )}
    </span>
  );
}

const ATTR: Record<string, string> = { class: "className", for: "htmlFor", colspan: "colSpan", rowspan: "rowSpan" };

/** One node of the sanitised HTML as React, with links, images and quotations given their Testimonia form. */
function convert(node: Node, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  const kids = () => [...el.childNodes].map((c, i) => convert(c, `${key}.${i}`));
  if (tag === "a") {
    const href = el.getAttribute("href") ?? "";
    return href ? (
      <Chip key={key} href={href} title={el.getAttribute("title") ?? undefined}>
        {kids()}
      </Chip>
    ) : (
      <Fragment key={key}>{kids()}</Fragment>
    );
  }
  if (tag === "img") return <AnswerImage key={key} src={el.getAttribute("src") ?? ""} alt={el.getAttribute("alt") ?? ""} />;
  if (tag === "table")
    return (
      <div key={key} className="ans-table">
        <table>{kids()}</table>
      </div>
    );
  if (tag === "blockquote") {
    // "— Irenaeus, Against Heresies 3.11": the last line names who said it
    const paras = [...el.children].filter((c) => c.tagName === "P");
    const last = paras[paras.length - 1];
    const cite = last && /^\s*(?:—|–|―|-{1,2})\s*\S/.test(last.textContent ?? "") && paras.length > 1 ? last : null;
    return (
      <blockquote key={key} className="ans-quote">
        {[...el.childNodes].map((c, i) =>
          c === cite ? (
            <p key={`${key}.${i}`} className="ans-cite">
              {[...c.childNodes].map((cc, j) =>
                // the dash that introduces the name is the quote's styling here, not text to show
                j === 0 && cc.nodeType === Node.TEXT_NODE ? (cc.textContent ?? "").replace(/^\s*(?:—|–|―|-{1,2})\s*/, "") : convert(cc, `${key}.${i}.${j}`),
              )}
            </p>
          ) : (
            convert(c, `${key}.${i}`)
          ),
        )}
      </blockquote>
    );
  }
  const props: Record<string, string> = {};
  for (const a of [...el.attributes]) if (a.name !== "style") props[ATTR[a.name] ?? a.name] = a.value;
  return VOID.has(tag) ? createElement(tag, { key, ...props }) : createElement(tag, { key, ...props }, ...kids());
}

/** A paragraph that is nothing but one verse link: shown as a card. */
function soleVerseLink(el: Element): { href: string; label: string } | null {
  if (el.tagName !== "P") return null;
  const meaningful = [...el.childNodes].filter((c) => c.nodeType === Node.ELEMENT_NODE || (c.textContent ?? "").trim());
  if (meaningful.length !== 1 || meaningful[0]!.nodeName !== "A") return null;
  const a = meaningful[0] as Element;
  const href = a.getAttribute("href") ?? "";
  return linkKind(href) === "verse" && verseOf(href) ? { href, label: a.textContent ?? "" } : null;
}

function sanitize(text: string, books: Books): string {
  return DOMPurify.sanitize(marked.parse(linkRefs(text, books), { async: false }) as string);
}

/** The answer. `live` while it is still arriving: the paragraph being written is not turned into a card yet. */
export const RichAnswer = memo(function RichAnswer({ text, books, live = false }: { text: string; books: Books; live?: boolean }) {
  const blocks = useMemo(() => {
    const doc = new DOMParser().parseFromString(sanitize(text, books), "text/html");
    const nodes = [...doc.body.childNodes].filter((n) => n.nodeType === Node.ELEMENT_NODE || (n.textContent ?? "").trim());
    let cards = 0;
    return nodes.map((n, i) => {
      const key = String(i);
      const isLast = i === nodes.length - 1;
      if (n.nodeType === Node.ELEMENT_NODE) {
        const sole = soleVerseLink(n as Element);
        if (sole && !(live && isLast) && cards < MAX_CARDS) {
          cards++;
          return <VerseCard key={`card-${key}`} href={sole.href} label={sole.label} />;
        }
        const out = convert(n, key);
        // every block fades in once, when it first appears; later words in it just appear
        return <div key={key} className="ans-in ans-block">{out}</div>;
      }
      return <p key={key} className="ans-in">{n.textContent}</p>;
    });
  }, [text, books, live]);
  return <div className="ask-md rich">{blocks}</div>;
});
