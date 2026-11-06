import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMeta, useVerse } from "../api";
import { useSettings } from "../settings";
import { citeBlock, citeInline, copyText } from "../studyLib";

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

interface Passage {
  label: string; // 'John 1:1–18'
  edition: string | null; // 'KJV'
  verses: { verse: number; text: string }[];
}

/** A "Copy" button with a small menu: as a quotation, or as a block with a reference line. */
export function CopyMenu({ passage, editions, onEdition, className = "va-btn" }: { passage: Passage | null; editions?: { id: string; abbrev: string }[]; onEdition?: (id: string) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const [copied, copy] = useCopied();
  const wrap = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);

  // keep the menu inside the window (the study panel is narrow, and on a phone the button can sit anywhere)
  useLayoutEffect(() => {
    if (!open || !menu.current || !wrap.current) {
      setShift(0);
      return;
    }
    const w = menu.current.offsetWidth;
    const left = wrap.current.getBoundingClientRect().left;
    setShift(Math.min(0, window.innerWidth - 10 - (left + w)) + Math.max(0, 10 - left));
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
    await copy(value);
    setOpen(false);
  };
  const short = (s: string) => (s.length > 70 ? `${s.slice(0, 68).trimEnd()}…` : s);

  return (
    <span className="copy-wrap" ref={wrap}>
      <button className={`${className}${open ? " on" : ""}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" disabled={!passage} title="Copy with the reference">
        {copied ? "✓ Copied" : copied === false ? "Copy failed" : "⧉ Copy"}
      </button>
      {open && passage && (
        <div className="copy-menu" role="menu" ref={menu} style={{ transform: `translateX(${shift}px)` }}>
          <button role="menuitem" onClick={() => void pick(inline)}>
            <span className="cm-label">Quotation</span>
            <span className="cm-sample">
              “{short(text)}” ({passage.label}
              {passage.edition ? `, ${passage.edition}` : ""})
            </span>
          </button>
          <button role="menuitem" onClick={() => void pick(block)}>
            <span className="cm-label">Block with reference</span>
            <span className="cm-sample">
              {short(text)}
              <br />— {passage.label}
              {passage.edition ? ` (${passage.edition})` : ""}
            </span>
          </button>
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
  return <CopyMenu passage={passage} editions={texts.map((x) => ({ id: x.edition_id, abbrev: x.abbrev ?? x.edition_id }))} onEdition={setChosen} />;
}

/** Selection toolbar: copy the selected words as “…” (John 1:1, KJV). */
export function CopySelection({ text, label, edition, onDone }: { text: string; label: string; edition: string; onDone: () => void }) {
  const meta = useMeta();
  const [copied, copy] = useCopied();
  const abbrev = meta.data?.editions.find((e) => e.id === edition)?.abbrev ?? edition;
  return (
    <button
      className="sel-btn"
      title={`Copy “…” (${label}, ${abbrev})`}
      onClick={async () => {
        if (await copy(citeInline(text, label, abbrev))) window.setTimeout(onDone, 700);
      }}
    >
      {copied ? "✓ Copied" : "⧉ Copy"}
    </button>
  );
}
