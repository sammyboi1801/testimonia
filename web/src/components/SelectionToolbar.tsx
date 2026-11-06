import { useEffect, useState, type RefObject } from "react";
import { HIGHLIGHTS, useNotes, type Highlight } from "../notes";
import { rangeOffsets, snapToWords } from "../selection";
import { openAsk } from "./AskDrawer";

interface Picked {
  osis: string;
  ed: string;
  label: string;
  start: number;
  end: number;
  text: string;
  x: number;
  y: number;
}

/**
 * Select words in a verse and this toolbar appears above them: highlight in a colour, remove highlights,
 * or ask the assistant about the phrase. Works on any `.vtext[data-osis][data-ed]` inside the reader.
 */
export function SelectionToolbar({ root, verseLabel }: { root: RefObject<HTMLElement | null>; verseLabel: (osis: string) => string }) {
  const { addMark, clearMarks } = useNotes();
  const [picked, setPicked] = useState<Picked | null>(null);

  useEffect(() => {
    const read = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return setPicked(null);
      const range = sel.getRangeAt(0);
      const host = (n: Node) => (n.nodeType === 1 ? (n as Element) : n.parentElement)?.closest<HTMLElement>(".vtext[data-osis][data-ed]");
      const a = host(range.startContainer);
      const b = host(range.endContainer);
      if (!a || a !== b || !root.current?.contains(a)) return setPicked(null); // one verse at a time
      const offsets = rangeOffsets(a, range);
      if (!offsets) return setPicked(null);
      const plain = a.dataset.text ?? "";
      const { start, end } = snapToWords(plain, offsets.start, offsets.end);
      if (end <= start) return setPicked(null);
      const r = range.getBoundingClientRect();
      setPicked({
        osis: a.dataset.osis!,
        ed: a.dataset.ed!,
        label: verseLabel(a.dataset.osis!),
        start,
        end,
        text: plain.slice(start, end),
        x: Math.min(Math.max(r.left + r.width / 2, 150), window.innerWidth - 150),
        y: r.top,
      });
    };
    const onUp = () => window.setTimeout(read, 0);
    const onChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) setPicked(null);
    };
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchend", onUp);
    document.addEventListener("keyup", onUp);
    document.addEventListener("selectionchange", onChange);
    const hide = () => setPicked(null);
    root.current?.addEventListener("scroll", hide, { passive: true });
    const el = root.current;
    return () => {
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchend", onUp);
      document.removeEventListener("keyup", onUp);
      document.removeEventListener("selectionchange", onChange);
      el?.removeEventListener("scroll", hide);
    };
  }, [root, verseLabel]);

  if (!picked) return null;
  const done = () => {
    window.getSelection()?.removeAllRanges();
    setPicked(null);
  };
  const colour = (c: Highlight) => {
    addMark(picked.osis, { ed: picked.ed, start: picked.start, end: picked.end, color: c });
    done();
  };
  const top = picked.y < 70 ? picked.y + 40 : picked.y - 46;
  return (
    <div className="sel-bar" style={{ left: picked.x, top }} role="toolbar" aria-label="Highlight selection" onMouseDown={(e) => e.preventDefault()}>
      {HIGHLIGHTS.map((h) => (
        <button key={h.id} className={`hl-swatch hl-${h.id}`} title={`Highlight ${h.label.toLowerCase()}`} onClick={() => colour(h.id)} />
      ))}
      <button
        className="sel-btn"
        title="Remove highlights here"
        onClick={() => {
          clearMarks(picked.osis, picked.ed, picked.start, picked.end);
          done();
        }}
      >
        ⌫
      </button>
      <button
        className="sel-btn sel-ask"
        onClick={() => {
          openAsk(picked.label, `In ${picked.label}, what does “${picked.text}” mean, and how is it understood?`);
          done();
        }}
      >
        ✦ Ask
      </button>
    </div>
  );
}
