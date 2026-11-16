import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { HIGHLIGHTS, useNotes } from "../notes";
import { openAsk } from "./AskDrawer";
import { CopyVerse } from "./CopyCitation";

/** One slim row of verse actions — highlight colours, my note, ask the assistant — with the note editor on demand. */
export function VerseNote({ osis, label }: { osis: string; label: string }) {
  const { get, set } = useNotes();
  const note = get(osis);
  const [text, setText] = useState(note?.text ?? "");
  const [open, setOpen] = useState(!!note?.text);
  const timer = useRef<number | undefined>(undefined);

  // switching verses loads that verse's note
  useEffect(() => {
    setText(get(osis)?.text ?? "");
    setOpen(!!get(osis)?.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [osis]);

  function change(value: string) {
    setText(value);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => set(osis, { text: value }), 400);
  }

  // the five colours wait behind one button, so the row stays calm
  const [colours, setColours] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!colours) return;
    const away = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setColours(false);
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [colours]);
  const current = HIGHLIGHTS.find((h) => h.id === note?.highlight);

  return (
    <section className="verse-actions">
      <div className="va-row">
        <span className="hl-wrap" ref={wrap}>
          <button className={`va-btn${colours ? " on" : ""}`} onClick={() => setColours(!colours)} aria-expanded={colours} title="Highlight this verse">
            <span className={`hl-dot${current ? ` hl-${current.id}` : ""}`} aria-hidden /> Highlight
          </button>
          {colours && (
            <span className="hl-pop" role="radiogroup" aria-label="Highlight colour">
              {HIGHLIGHTS.map((h) => (
                <button
                  key={h.id}
                  role="radio"
                  aria-checked={note?.highlight === h.id}
                  className={`hl-swatch hl-${h.id}${note?.highlight === h.id ? " on" : ""}`}
                  title={h.label}
                  onClick={() => {
                    set(osis, { highlight: note?.highlight === h.id ? null : h.id });
                    setColours(false);
                  }}
                />
              ))}
              {current && (
                <button className="hl-none" onClick={() => { set(osis, { highlight: null }); setColours(false); }} title="Remove the highlight">
                  ✕
                </button>
              )}
            </span>
          )}
        </span>
        <button className={`va-btn${open ? " on" : ""}`} onClick={() => setOpen(!open)} title="My note on this verse">
          ✎ {note?.text ? "My note" : "Note"}
        </button>
        <CopyVerse osis={osis} label={label} />
        <button className="va-btn va-ask" onClick={() => openAsk(label)} title="Ask the study assistant about this verse">
          ✦ Ask AI
        </button>
      </div>
      {open && (
        <div className="va-note">
          <textarea
            className="my-note-text"
            value={text}
            rows={3}
            placeholder="Your thoughts, questions, cross-references…"
            onChange={(e) => change(e.target.value)}
            onBlur={() => set(osis, { text })}
            autoFocus={!text}
          />
          <div className="my-note-foot">
            <span>Saved in this browser only</span>
            <Link to="/notes">All my notes →</Link>
          </div>
        </div>
      )}
    </section>
  );
}
