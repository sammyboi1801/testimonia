import { useEffect, useState, type RefObject } from "react";
import { useMeta } from "../api";
import { HIGHLIGHTS, useNotes, type Highlight } from "../notes";
import { rangeOffsets, snapToWords } from "../selection";
import { openAsk } from "./AskDrawer";
import { CopyMenu } from "./CopyCitation";
import { VerseCard, type CardVerse } from "./VerseCard";

interface Part {
  osis: string;
  start: number;
  end: number;
}

interface Picked {
  parts: Part[]; // one per verse: a selection may run across several
  ed: string;
  label: string;
  text: string;
  texts: string[]; // the words picked in each part
  x: number;
  y: number;
}

/**
 * Select words in a verse, or across several, and this toolbar appears above them: highlight in a colour, remove
 * highlights, or ask the assistant about the words. Works on any `.vtext[data-osis][data-ed]` inside the reader.
 * Across verses, each verse keeps its own part (start to end of the words selected in it), all in one colour.
 */
export function SelectionToolbar({ root, verseLabel }: { root: RefObject<HTMLElement | null>; verseLabel: (osis: string) => string }) {
  const { addMark, clearMarks } = useNotes();
  const meta = useMeta();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [card, setCard] = useState<CardVerse | null>(null); // stays open after the selection is gone

  useEffect(() => {
    const read = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return setPicked(null);
      const range = sel.getRangeAt(0);
      const host = (n: Node) => (n.nodeType === 1 ? (n as Element) : n.parentElement)?.closest<HTMLElement>(".vtext[data-osis][data-ed]");
      const touched = [...(root.current?.querySelectorAll<HTMLElement>(".vtext[data-osis][data-ed]") ?? [])].filter((el) => range.intersectsNode(el));
      const first = host(range.startContainer) ?? touched[0];
      if (!first) return setPicked(null);
      // one translation: side by side, a selection also passes through the other columns' verses
      const ed = first.dataset.ed!;
      const parts: Part[] = [];
      const texts: string[] = [];
      for (const el of touched.filter((el) => el.dataset.ed === ed).slice(0, 60)) {
        const offsets = rangeOffsets(el, range);
        if (!offsets) continue;
        const plain = el.dataset.text ?? "";
        const { start, end } = snapToWords(plain, offsets.start, offsets.end);
        if (end <= start) continue;
        parts.push({ osis: el.dataset.osis!, start, end });
        texts.push(plain.slice(start, end));
      }
      if (!parts.length) return setPicked(null);
      const r = range.getBoundingClientRect();
      setPicked({
        parts,
        ed,
        label: spanLabel(parts[0]!.osis, parts[parts.length - 1]!.osis, verseLabel),
        text: texts.join(" "),
        texts,
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

  const cardLayer = card && <VerseCard verse={card} onClose={() => setCard(null)} />;
  if (!picked) return cardLayer || null;
  const done = () => {
    window.getSelection()?.removeAllRanges();
    setPicked(null);
  };
  const colour = (c: Highlight) => {
    for (const p of picked.parts) addMark(p.osis, { ed: picked.ed, start: p.start, end: p.end, color: c });
    done();
  };
  const top = picked.y < 70 ? picked.y + 40 : picked.y - 46;
  const first = picked.parts[0]!.osis;
  const last = picked.parts[picked.parts.length - 1]!.osis;
  const passage = {
    label: picked.label,
    edition: meta.data?.editions.find((e) => e.id === picked.ed)?.abbrev ?? picked.ed,
    verses: picked.parts.map((p, i) => ({ verse: Number(p.osis.split(".")[2]), text: picked.texts[i]! })),
  };
  // the link opens the whole verses; its preview picture shows them (deploy/functions/share.js)
  const shareUrl = `https://testimonia.web.app/v/${encodeURIComponent(first === last ? first : `${first}-${last}`)}`;
  return (
    <>
    {cardLayer}
    <div className="sel-bar" style={{ left: picked.x, top }} role="toolbar" aria-label="Highlight selection" onMouseDown={(e) => e.preventDefault()}>
      {HIGHLIGHTS.map((h) => (
        <button key={h.id} className={`hl-swatch hl-${h.id}`} title={`Highlight ${h.label.toLowerCase()}`} onClick={() => colour(h.id)} />
      ))}
      <button
        className="sel-btn"
        title="Remove highlights here"
        onClick={() => {
          for (const p of picked.parts) clearMarks(p.osis, picked.ed, p.start, p.end);
          done();
        }}
      >
        ⌫
      </button>
      <CopyMenu
        passage={passage}
        className="sel-btn"
        shareUrl={shareUrl}
        onCard={(v) => {
          setCard(v);
          done();
        }}
        onDone={done}
      />
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
    </>
  );
}

/** "John 3:16", "John 3:16–18", or "John 3:36 – 4:2" across a chapter break. */
export function spanLabel(from: string, to: string, verseLabel: (osis: string) => string): string {
  if (from === to) return verseLabel(from);
  const [b1, c1] = from.split(".");
  const [b2, c2, v2] = to.split(".");
  if (b1 === b2 && c1 === c2) return `${verseLabel(from)}–${v2}`;
  if (b1 === b2) return `${verseLabel(from)}–${c2}:${v2}`;
  return `${verseLabel(from)} – ${verseLabel(to)}`;
}
