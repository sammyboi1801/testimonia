import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useVerse } from "../api";
import { useSettings } from "../settings";
import { citeBlock, citeInline, copyText } from "../studyLib";
import { cardFile, VerseCard, type CardVerse } from "./VerseCard";

/** "Copied" for a moment after a successful copy. */
function useCopied(): [boolean | null, (text: string) => Promise<boolean>] {
  const [state, setState] = useState<boolean | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    return () => window.clearTimeout(timer.current);
  }, []);
  const copy = async (text: string) => {
    const ok = await copyText(text);
    setState(ok);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState(null), 1600);
    return ok;
  };
  return [state, copy];
}

/** 18px line icons, drawn in the text colour. */
const svg = (d: string) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);
const ICON = {
  quote: svg("M7 7h4v4c0 3-1.5 5-4 6M14 7h4v4c0 3-1.5 5-4 6"),
  block: svg("M5 6h14M5 10h14M5 14h9M5 19h6"),
  link: svg("M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"),
  send: svg("M12 15V4M8 8l4-4 4 4M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"),
  image: svg("M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM4 16l5-5 4 4 2-2 5 5M15.5 8.5h.01"),
};

function MenuItem({ icon, label, hint, onClick }: { icon: React.ReactNode; label: string; hint: string; onClick: () => void }) {
  return (
    <button role="menuitem" className="cm-item" onClick={onClick}>
      <span className="cm-icon">{icon}</span>
      <span className="cm-label">{label}</span>
      <span className="cm-hint">{hint}</span>
    </button>
  );
}

interface Passage {
  label: string; // 'John 1:1–18'
  edition: string | null; // 'KJV'
  verses: { verse: number; text: string }[];
}

/** A "Copy" button with a small menu: as a quotation, or as a block with a reference line. */
/** With `shareUrl`, the button is "Share": the copy choices, plus the phone's share sheet and an image card. */
/** `onCard` shows the image card elsewhere (the selection toolbar goes away when the selection does); `onDone` runs after a copy or a send. */
export function CopyMenu({
  passage,
  editions,
  onEdition,
  className = "va-btn",
  shareUrl,
  onCard,
  onDone,
}: {
  passage: Passage | null;
  editions?: { id: string; abbrev: string }[];
  onEdition?: (id: string) => void;
  className?: string;
  shareUrl?: string;
  onCard?: (v: CardVerse) => void;
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [card, setCard] = useState(false);
  const [copied, copy] = useCopied();
  const wrap = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  const [up, setUp] = useState(false);

  // keep the menu inside the window (the study panel is narrow, and on a phone the button can sit anywhere)
  useLayoutEffect(() => {
    if (!open || !menu.current || !wrap.current) {
      setShift(0);
      setUp(false);
      return;
    }
    const w = menu.current.offsetWidth;
    const r = wrap.current.getBoundingClientRect();
    setShift(Math.min(0, window.innerWidth - 10 - (r.left + w)) + Math.max(0, 10 - r.left));
    // near the bottom of the window (a selection low on the page): open upwards
    setUp(r.bottom + 6 + menu.current.offsetHeight > window.innerHeight - 10 && r.top - 6 - menu.current.offsetHeight > 10);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const text = passage?.verses.map((v) => v.text.trim()).join(" ") ?? "";
  const inline = passage ? citeInline(text, passage.label, passage.edition) : "";
  const block = passage ? citeBlock(passage.verses, passage.label, passage.edition) : "";
  const pick = async (value: string) => {
    const ok = await copy(value);
    setOpen(false);
    if (ok && onDone) window.setTimeout(onDone, 700);
  };
  const many = (passage?.verses.length ?? 0) > 1;
  const send = async () => {
    if (!passage || !shareUrl) return;
    setOpen(false);
    try {
      // with the picture when the phone can send a file and text together, else the text and link
      const file = await cardFile({ text, label: passage.label, edition: passage.edition, url: shareUrl }).catch(() => null);
      const withPicture = file && navigator.canShare?.({ files: [file], text: inline });
      await navigator.share(withPicture ? { files: [file], text: `${inline}\n${shareUrl}` } : { title: passage.label, text: inline, url: shareUrl });
    } catch {
      /* closed */
    }
    onDone?.();
  };

  return (
    <span className="copy-wrap" ref={wrap}>
      <button className={`${className}${open ? " on" : ""}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" disabled={!passage} title="Copy with the reference">
        {copied ? "✓ Copied" : copied === false ? "Copy failed" : shareUrl ? "↗ Share" : "⧉ Copy"}
      </button>
      {open && passage && (
        <div className={`copy-menu${up ? " up" : ""}`} role="menu" ref={menu} style={{ transform: `translateX(${shift}px)` }}>
          <div className="cm-head">
            <span className="cm-ref">{passage.label}</span>
            {passage.edition && <span className="cm-ed">{passage.edition}</span>}
          </div>
          <MenuItem icon={ICON.quote} label="Copy quotation" hint={`“${text}”`} onClick={() => void pick(inline)} />
          <MenuItem icon={ICON.block} label={many ? "Copy with verse numbers" : "Copy as block"} hint={`Reference on its own line`} onClick={() => void pick(block)} />
          {shareUrl && (
            <>
              <MenuItem icon={ICON.link} label="Copy link" hint="Pastes with a picture preview" onClick={() => void pick(shareUrl)} />
              <div className="cm-rule" />
              {typeof navigator.share === "function" && <MenuItem icon={ICON.send} label="Send…" hint="Picture, text and link" onClick={() => void send()} />}
              <MenuItem
                icon={ICON.image}
                label="Image card"
                hint="Square, post or story"
                onClick={() => {
                  setOpen(false);
                  if (onCard) onCard({ text, label: passage.label, edition: passage.edition, url: shareUrl });
                  else setCard(true);
                }}
              />
            </>
          )}
          {editions && editions.length > 1 && onEdition && (
            <label className="cm-edition">
              Translation
              <select value={editions.find((e) => e.abbrev === passage.edition)?.id ?? ""} onChange={(e) => onEdition(e.target.value)}>
                {editions.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.abbrev}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      <span className="st-sr-only" aria-live="polite">
        {copied ? "Copied to the clipboard" : ""}
      </span>
      {card && passage && shareUrl && (
        <VerseCard verse={{ text, label: passage.label, edition: passage.edition, url: shareUrl }} onClose={() => setCard(false)} />
      )}
    </span>
  );
}

/** Copy one verse from the study panel, in the reader's first translation (or another English one). */
export function CopyVerse({ osis, label }: { osis: string; label: string }) {
  const { data } = useVerse(osis);
  const { settings } = useSettings();
  const [chosen, setChosen] = useState<string | null>(null);
  const texts = (data?.texts ?? []).filter((t) => t.language === "eng" || t.language === "lat");
  const t = texts.find((x) => x.edition_id === chosen) ?? texts.find((x) => x.edition_id === settings.editions[0]) ?? texts[0];
  const passage = t && data ? { label, edition: t.abbrev ?? t.edition_id, verses: [{ verse: data.verse.verse, text: t.text }] } : null;
  // the short link: pasted anywhere, its preview shows the verse as a picture (deploy/functions/share.js)
  const shareUrl = `https://testimonia.web.app/v/${encodeURIComponent(osis)}`;
  return <CopyMenu passage={passage} editions={texts.map((x) => ({ id: x.edition_id, abbrev: x.abbrev ?? x.edition_id }))} onEdition={setChosen} shareUrl={shareUrl} />;
}
