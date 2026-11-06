import { useRef, useState, type ReactNode } from "react";
import DOMPurify from "dompurify";
import { createPortal } from "react-dom";
import type { Footnote } from "../types";

export const NOTE_KIND: Record<string, string> = {
  textual: "manuscripts differ",
  alternative: "or",
  literal: "literally",
  note: "note",
  study: "study note",
};

const letter = (i: number) => (i < 26 ? String.fromCharCode(97 + i) : String(i + 1));

/**
 * Verse text with its translators' footnotes as small superscript letters placed after the words they belong
 * to (falling back to the end of the verse when the anchor is not found). Hovering a letter shows the note.
 */
export function TextWithNotes({ text, notes }: { text: string; notes?: Footnote[] }) {
  if (!notes?.length) return <>{text}</>;
  // find each anchor in order, so repeated words attach to the right occurrence
  const placed: { at: number; note: Footnote; i: number }[] = [];
  let from = 0;
  notes.forEach((note, i) => {
    const anchor = (note.anchor ?? "").trim();
    let at = anchor ? text.indexOf(anchor, from) : 0;
    if (anchor && at < 0) at = text.indexOf(anchor);
    if (anchor && at < 0) {
      // the USFM wording can differ slightly from the verse text: try the last word alone
      const last = anchor.split(/\s+/).pop() ?? "";
      at = last ? text.indexOf(last, from) : -1;
      at = at >= 0 ? at + last.length : text.length;
    } else if (anchor) {
      at += anchor.length;
    }
    placed.push({ at, note, i });
    from = Math.max(from, at);
  });
  placed.sort((a, b) => a.at - b.at || a.i - b.i);
  const out: ReactNode[] = [];
  let pos = 0;
  for (const p of placed) {
    // keep a closing punctuation mark with its word: "time;ᵃ" not "timeᵃ;"
    let at = p.at;
    while (at < text.length && /[.,;:!?’”)\]]/.test(text[at]!)) at++;
    if (at > pos) out.push(text.slice(pos, at));
    out.push(<NoteMark key={p.i} note={p.note} label={letter(p.i)} />);
    pos = Math.max(pos, at);
  }
  out.push(text.slice(pos));
  return <>{out}</>;
}

function NoteMark({ note, label }: { note: Footnote; label: string }) {
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const ref = useRef<HTMLElement>(null);
  const show = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const up = r.bottom + 180 > window.innerHeight;
      setPos({ left: Math.max(8, Math.min(r.left - 12, window.innerWidth - 336)), top: up ? r.top - 6 : r.bottom + 6, up });
    }, 150);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPos(null), 150);
  };
  return (
    <sup
      ref={ref}
      className={`fn fn-${note.kind ?? "note"}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onClick={(e) => e.stopPropagation()}
      tabIndex={0}
      onFocus={show}
      onBlur={hide}
      aria-label={`Footnote ${label}`}
    >
      {label}
      {pos &&
        createPortal(
          <span
            className={`fn-pop${pos.up ? " up" : ""}`}
            role="tooltip"
            style={{ left: pos.left, top: pos.top }}
            onMouseEnter={() => window.clearTimeout(timer.current)}
            onMouseLeave={hide}
          >
            <span className="fn-kind">{NOTE_KIND[note.kind ?? "note"] ?? note.kind}</span>
            <span className="fn-body" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(note.body) }} />
          </span>,
          document.body,
        )}
    </sup>
  );
}
