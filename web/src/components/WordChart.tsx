import { useMemo, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { osisLabel, verseUrl } from "../lib";
import { useWordChapters, useWordInBook } from "../studyApi";
import type { Book, WordStudy } from "../types";

// Canonical sections, each starting at the named book.
const GROUPS: Record<"OT" | "NT", { from: string; label: string }[]> = {
  OT: [
    { from: "Gen", label: "Law" },
    { from: "Josh", label: "History" },
    { from: "Job", label: "Poetry" },
    { from: "Isa", label: "Prophets" },
  ],
  NT: [
    { from: "Matt", label: "Gospels · Acts" },
    { from: "Rom", label: "Paul" },
    { from: "Heb", label: "Hebrews – Revelation" },
  ],
};

const W = 400;
const TOP = 16;
const BASE = 96;
const GAP = 7; // between sections

/**
 * Occurrences per book in canonical order (the word's own Testament, sections apart), the chapters where it
 * clusters, and — after a click on a bar — every occurrence in that book.
 */
export function WordChart({ strong, byBook, books }: { strong: string; byBook: WordStudy["by_book"]; books: Book[] }) {
  const testament: "OT" | "NT" = strong.startsWith("H") ? "OT" : "NT";
  const [hover, setHover] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const chapters = useWordChapters(strong);
  const inBook = useWordInBook(strong, picked);
  const hebrew = strong.startsWith("H");

  const layout = useMemo(() => {
    const counts = new Map(byBook.map((b) => [b.book, b.n]));
    const list = books.filter((b) => b.testament === testament).sort((a, b) => a.ord - b.ord);
    const starts = new Set(GROUPS[testament].map((g) => g.from));
    const groupsSeen = list.filter((b) => starts.has(b.osis)).length;
    const band = (W - GAP * Math.max(0, groupsSeen - 1)) / Math.max(1, list.length);
    const max = Math.max(1, ...list.map((b) => counts.get(b.osis) ?? 0));
    let x = 0;
    const bars: { book: Book; n: number; x: number; w: number }[] = [];
    const sections: { label: string; x1: number; x2: number }[] = [];
    list.forEach((b, i) => {
      if (starts.has(b.osis)) {
        if (i > 0) x += GAP;
        sections.push({ label: GROUPS[testament].find((g) => g.from === b.osis)!.label, x1: x, x2: x });
      }
      bars.push({ book: b, n: counts.get(b.osis) ?? 0, x, w: band });
      x += band;
      if (sections.length) sections[sections.length - 1]!.x2 = x;
    });
    return { bars, sections, max };
  }, [byBook, books, testament]);

  if (!layout.bars.length) return null;
  const shown = hover ?? picked;
  const shownBar = layout.bars.find((b) => b.book.osis === shown);
  const total = byBook.reduce((s, b) => s + b.n, 0);
  const h = (n: number) => (n / layout.max) * (BASE - TOP);
  const choose = (osis: string) => setPicked(picked === osis ? null : osis);
  const key = (e: KeyboardEvent, osis: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(osis);
    }
  };
  const top = [...byBook].sort((a, b) => b.n - a.n)[0];

  return (
    <div className="word-chart">
      <div className="wc-readout" aria-live="polite">
        {shownBar ? (
          <>
            <strong>{shownBar.book.name}</strong> · {shownBar.n} {shownBar.n === 1 ? "time" : "times"}
            {shownBar.n > 0 && <span className="muted"> · {Math.round((shownBar.n / total) * 100)}% of all</span>}
          </>
        ) : (
          <span className="muted">
            {byBook.length} book{byBook.length === 1 ? "" : "s"}
            {top ? ` · most in ${top.name} (${top.n})` : ""} · click a bar for its verses
          </span>
        )}
      </div>
      <svg
        viewBox={`0 -2 ${W} 122`}
        className="wc-svg"
        role="group"
        aria-label={`Occurrences per book of the ${testament === "NT" ? "New" : "Old"} Testament`}
        onMouseLeave={() => setHover(null)}
      >
        <line x1={0} x2={W} y1={TOP} y2={TOP} className="wc-grid" />
        <text x={0} y={TOP - 4} className="wc-axis">
          {layout.max}
        </text>
        {layout.bars.map((b) => {
          const bh = h(b.n);
          const bw = Math.max(1, b.w - 2);
          const r = Math.min(2, bw / 2, bh);
          const on = b.book.osis === picked;
          const dim = picked && !on;
          return (
            <g
              key={b.book.osis}
              className={`wc-bar${on ? " on" : ""}${dim ? " dim" : ""}${b.n ? "" : " zero"}`}
              role={b.n ? "button" : undefined}
              tabIndex={b.n ? 0 : undefined}
              aria-pressed={b.n ? on : undefined}
              aria-label={`${b.book.name}: ${b.n}`}
              onMouseEnter={() => setHover(b.book.osis)}
              onFocus={() => setHover(b.book.osis)}
              onBlur={() => setHover(null)}
              onClick={() => b.n && choose(b.book.osis)}
              onKeyDown={(e) => b.n && key(e, b.book.osis)}
            >
              <title>{`${b.book.name}: ${b.n}`}</title>
              <rect x={b.x} y={0} width={b.w} height={BASE + 4} className="wc-hit" />
              {b.n > 0 ? (
                <path
                  className="wc-fill"
                  d={`M${b.x + 1},${BASE} V${BASE - bh + r} Q${b.x + 1},${BASE - bh} ${b.x + 1 + r},${BASE - bh} H${b.x + 1 + bw - r} Q${b.x + 1 + bw},${BASE - bh} ${b.x + 1 + bw},${BASE - bh + r} V${BASE} Z`}
                />
              ) : (
                <rect x={b.x + 1} y={BASE - 1} width={bw} height={1} className="wc-zero" />
              )}
            </g>
          );
        })}
        <line x1={0} x2={W} y1={BASE + 0.5} y2={BASE + 0.5} className="wc-base" />
        {layout.sections.map((s) => (
          <g key={s.label}>
            <line x1={s.x1 + 1} x2={s.x2 - 1} y1={BASE + 7} y2={BASE + 7} className="wc-section" />
            <text x={(s.x1 + s.x2) / 2} y={BASE + 19} textAnchor="middle" className="wc-axis">
              {s.label}
            </text>
          </g>
        ))}
      </svg>

      {(chapters.data?.chapters.length ?? 0) > 1 && (
        <div className="wc-clusters">
          <span className="muted small">Clusters in</span>
          {chapters.data!.chapters.slice(0, 6).map((c) => (
            <Link key={`${c.book}.${c.chapter}`} className="tag" to={`/read/${c.book}/${c.chapter}`} title={`${c.n} times in ${c.name} ${c.chapter}`}>
              {c.name} {c.chapter} <span className="muted">{c.n}</span>
            </Link>
          ))}
        </div>
      )}

      {picked && (
        <div className="wc-book">
          <div className="wc-book-head">
            <strong>In {layout.bars.find((b) => b.book.osis === picked)?.book.name}</strong>
            <span className="muted small">{inBook.data ? `${inBook.data.length} times` : "…"}</span>
            <button className="link-btn" onClick={() => setPicked(null)}>
              clear
            </button>
          </div>
          <div className="wc-book-list">
            {inBook.data?.map((o, i) => (
              <div key={`${o.vkey}-${i}`} className="item-head" style={{ padding: "3px 0" }}>
                <Link to={verseUrl(o.osis, strong)}>{osisLabel(o.osis, books)}</Link>
                <span className={hebrew ? "hebrew" : "greek"} style={{ fontSize: 15 }}>
                  {o.surface}
                </span>
                <span className="muted">{o.gloss}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
