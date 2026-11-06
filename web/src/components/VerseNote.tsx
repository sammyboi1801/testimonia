import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { HIGHLIGHTS, useNotes } from "../notes";

/** My note on a verse: a highlight colour and free text, saved in this browser as you type. */
export function VerseNote({ osis }: { osis: string }) {
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

  return (
    <section className="my-note">
      <div className="my-note-head">
        <span className="about-label">My note</span>
        <span className="hl-swatches" role="radiogroup" aria-label="Highlight">
          {HIGHLIGHTS.map((h) => (
            <button
              key={h.id}
              role="radio"
              aria-checked={note?.highlight === h.id}
              className={`hl-swatch hl-${h.id}${note?.highlight === h.id ? " on" : ""}`}
              title={`Highlight ${h.label.toLowerCase()}`}
              onClick={() => set(osis, { highlight: note?.highlight === h.id ? null : h.id })}
            />
          ))}
        </span>
        {!open && (
          <button className="link-btn" onClick={() => setOpen(true)}>
            + Write a note
          </button>
        )}
      </div>
      {open && (
        <>
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
        </>
      )}
    </section>
  );
}
