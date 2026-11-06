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

/** Where each footnote letter goes: just after its anchor words (and after closing punctuation). */
export function placeNotes(text: string, notes: Footnote[]): { at: number; note: Footnote; i: number }[] {
  const placed: { at: number; note: Footnote; i: number }[] = [];
  let from = 0; // find anchors in order, so repeated words attach to the right occurrence
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
    // keep a closing punctuation mark with its word: "time;ᵃ" not "timeᵃ;"
    let end = at;
    while (end < text.length && /[.,;:!?’”)\]]/.test(text[end]!)) end++;
    placed.push({ at: end, note, i });
    from = Math.max(from, at);
  });
  return placed.sort((a, b) => a.at - b.at || a.i - b.i);
}

/**
 * Verse text with the translators' footnotes as small superscript letters after the words they belong to
 * (hover a letter to read the note), and the reader's own phrase highlights as coloured marks.
 */
export function TextWithNotes({ text, notes, marks }: { text: string; notes?: Footnote[]; marks?: TextMark[] }) {
  if (!notes?.length && !marks?.length) return <>{text}</>;
  const placed = notes?.length ? placeNotes(text, notes) : [];
  const cuts = new Set<number>([0, text.length]);
  for (const p of placed) cuts.add(p.at);
  for (const m of marks ?? []) {
    cuts.add(Math.max(0, Math.min(text.length, m.start)));
    cuts.add(Math.max(0, Math.min(text.length, m.end)));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const out: ReactNode[] = [];
  let k = 0;
  for (let j = 0; j < points.length; j++) {
    const at = points[j]!;
    for (const p of placed) if (p.at === at) out.push(<NoteMark key={`n${p.i}`} note={p.note} label={letter(p.i)} />);
    const next = points[j + 1];
    if (next === undefined || next <= at) continue;
    const piece = text.slice(at, next);
    const mark = (marks ?? []).find((m) => m.start <= at && m.end >= next);
    out.push(mark ? <mark key={`m${k++}`} className={`phrase hl-${mark.color}`}>{piece}</mark> : piece);
  }
  return <>{out}</>;
}

/** A highlighted range of verse text (character offsets). */
export interface TextMark {
  start: number;
  end: number;
  color: string;
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
