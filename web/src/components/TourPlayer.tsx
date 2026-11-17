// Plays the tour the assistant built: a card over the page with the stop's heading and words, Back and Next, dots to
// jump between stops. Each stop opens its passage in the reader (the range shaded on wide screens; on phones the
// verse is brought to the middle and marked) and shows its places on the map when it has any.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMeta } from "../api";
import { openMap } from "../pins";
import { endTour, goToStop, useTour, type TourStop } from "../tour";
import { showAsk } from "./AskDrawer";
import { RichAnswer } from "./RichAnswer";

const wide = () => window.matchMedia("(min-width: 900px)").matches;

/** Where a stop takes the reader. */
export function stopUrl(s: TourStop): string | null {
  if (s.osis) {
    const [book, c, v] = s.osis.split(".");
    const [, c2, v2] = (s.end ?? s.osis).split(".");
    if (!wide()) return `/read/${book}/${c}#v${v}`; // phones: no panel over the text, the verse marked instead
    const to = c2 === c && Number(v2) > Number(v) ? `&to=${v2}` : "";
    return `/read/${book}/${c}?v=${s.osis}${to}`;
  }
  return s.link ?? null;
}

/** The verses of a stop within one chapter ("Mark.1.14" to "Mark.1.20"); across chapters, the first chapter's part. */
function rangeOsis(first: string, last: string): string[] {
  const [book, c, v] = first.split(".");
  const [, c2, v2] = last.split(".");
  const end = c2 === c ? Number(v2) : Number(v) + 30;
  const out: string[] = [];
  for (let n = Number(v); n <= Math.min(end, Number(v) + 80); n++) out.push(`${book}.${c}.${n}`);
  return out;
}

export function TourPlayer() {
  const { tour, at } = useTour();
  const navigate = useNavigate();
  const books = useMeta().data?.books ?? [];
  const card = useRef<HTMLElement>(null);
  const stop = tour?.steps[at];
  const [folded, setFolded] = useState(false); // just the controls, to see more of the page

  // go where the stop is, and show its places
  useEffect(() => {
    if (!stop) return;
    const url = stopUrl(stop);
    if (url) navigate(url);
    if (stop.map) openMap({ ...stop.map, title: stop.title });
    card.current?.querySelector<HTMLElement>(".tp-next")?.focus({ preventScroll: true });
    // the stop's first verse at the top of the screen, clear of the card, once the chapter has drawn
    const t = window.setTimeout(() => {
      const el = stop.osis ? document.querySelector<HTMLElement>(`.reader [data-osis="${CSS.escape(stop.osis)}"]`) : null;
      el?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 450);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour, at]);

  // every verse of the stop softly marked (on phones too, where the reader's own range shading is not used)
  const marked = useMemo(() => (stop?.osis ? rangeOsis(stop.osis, stop.end ?? stop.osis) : []), [stop]);
  useEffect(() => {
    if (!marked.length) return;
    const style = document.createElement("style");
    style.dataset.tour = "1";
    const sel = marked.map((o) => `.reader [data-osis="${o}"]`).join(",\n");
    style.textContent = `${sel} { background-color: color-mix(in srgb, var(--accent) 6%, transparent); border-radius: 6px; scroll-margin-top: 96px; }`;
    document.head.appendChild(style);
    return () => style.remove();
  }, [marked]);

  // ← and → step through it, Esc ends it (not while typing)
  useEffect(() => {
    if (!tour) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "ArrowRight") goToStop(at + 1);
      else if (e.key === "ArrowLeft") goToStop(at - 1);
      else if (e.key === "Escape") endTour();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tour, at]);

  if (!tour || !stop) return null;
  const last = at === tour.steps.length - 1;
  return (
    <aside className={`tour-card${folded ? " folded" : ""}${stop.map ? " has-map" : ""}`} ref={card} aria-label={`Tour: ${tour.title}`} aria-live="polite">
      <header className="tp-head">
        <span className="tp-kicker">Tour</span>
        <span className="tp-title" title={tour.title}>
          {folded ? `${at + 1}/${tour.steps.length} · ${stop.title}` : tour.title}
        </span>
        <button className="icon-btn tp-fold" onClick={() => setFolded(!folded)} aria-expanded={!folded} aria-label={folded ? "Show the stop" : "Fold the card"} title={folded ? "Show the stop" : "Fold the card to see more of the page"}>
          {folded ? "▴" : "▾"}
        </button>
        <button className="icon-btn tp-close" onClick={endTour} aria-label="End the tour" title="End the tour (Esc)">
          ✕
        </button>
      </header>
      <div className="tp-dots" role="tablist" aria-label="Stops">
        {tour.steps.map((s, i) => (
          <button
            key={i}
            role="tab"
            aria-selected={i === at}
            className={`tp-dot${i === at ? " on" : ""}${i < at ? " done" : ""}`}
            onClick={() => goToStop(i)}
            title={`${i + 1}. ${s.title}`}
            aria-label={`Stop ${i + 1}: ${s.title}`}
          />
        ))}
      </div>
      <div
        className="tp-body"
        key={at}
        onClick={(e) => {
          const href = (e.target as HTMLElement).closest("a")?.getAttribute("href");
          if (!href?.startsWith("/")) return;
          e.preventDefault();
          navigate(href);
        }}
      >
        <div className="tp-step">
          Stop {at + 1} of {tour.steps.length}
          {stop.label && <span className="tp-label"> · {stop.label}</span>}
        </div>
        <h3 className="tp-h">{stop.title}</h3>
        <RichAnswer text={stop.text} books={books} />
      </div>
      <footer className="tp-foot">
        <button className="btn tp-back" onClick={() => goToStop(at - 1)} disabled={at === 0}>
          ← Back
        </button>
        <button className="link-btn tp-ask" onClick={showAsk}>
          ✦ Ask about this
        </button>
        <button className="btn primary tp-next" onClick={() => (last ? endTour() : goToStop(at + 1))}>
          {last ? "Finish" : "Next →"}
        </button>
      </footer>
    </aside>
  );
}
