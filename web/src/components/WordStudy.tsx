import { useState } from "react";
import { Link } from "react-router-dom";
import { useWord } from "../api";
import { osisLabel, verseUrl } from "../lib";
import type { Book } from "../types";
import { Html } from "./Html";

export function WordStudy({ strong, books, onBack, onWord }: { strong: string; books: Book[]; onBack: () => void; onWord: (s: string) => void }) {
  const { data, isLoading, error } = useWord(strong);
  const [tab, setTab] = useState(0);
  const [limit, setLimit] = useState(40);
  if (isLoading) return <div className="loading">Loading {strong}…</div>;
  if (error || !data) return <div className="error">Could not load {strong}: {String(error)}</div>;
  const hebrew = strong.startsWith("H");
  const max = Math.max(1, ...data.by_book.map((b) => b.n));
  const lex = data.lexicons[Math.min(tab, data.lexicons.length - 1)];

  return (
    <div className="guide-inner">
      <button className="back" onClick={onBack}>
        ← back to the verse
      </button>
      <div className="lemma-head">
        <span className={`lemma ${hebrew ? "hebrew" : "greek"}`} dir={hebrew ? "rtl" : undefined}>
          {data.lemma?.lemma ?? strong}
        </span>
        <span className="muted">{data.lemma?.translit}</span>
        <span className="pill">{strong}</span>
      </div>
      {data.lemma?.gloss && <div style={{ fontSize: 16, margin: "4px 0 8px" }}>{data.lemma.gloss}</div>}

      <details className="section" open>
        <summary>
          Used <span className="count">{data.total} times</span>
        </summary>
        <div className="section-body">
          <div style={{ marginBottom: 8 }}>
            {data.glosses.slice(0, 12).map((g) => (
              <span key={g.gloss} className="pill">
                {g.gloss} <span className="muted">{g.n}</span>
              </span>
            ))}
          </div>
          <div className="bars">
            {data.by_book.map((b) => (
              <FragmentRow key={b.book} label={b.name} n={b.n} max={max} />
            ))}
          </div>
        </div>
      </details>

      {data.lexicons.length > 0 && lex && (
        <details className="section" open>
          <summary>Lexicons</summary>
          <div className="section-body">
            <div className="tabs">
              {data.lexicons.map((l, i) => (
                <button key={l.lexicon_id} className={i === tab ? "on" : ""} onClick={() => setTab(i)} title={l.title}>
                  {LEX_SHORT[l.lexicon_id] ?? l.lexicon_id}
                </button>
              ))}
            </div>
            <Html html={lex.body} className="lexicon-body" onWord={onWord} />
          </div>
        </details>
      )}

      <details className="section" open>
        <summary>
          Occurrences <span className="count">{data.occurrences.length}</span>
        </summary>
        <div className="section-body">
          {data.occurrences.slice(0, limit).map((o) => (
            <div key={`${o.vkey}-${o.surface}`} className="item-head" style={{ padding: "3px 0" }}>
              <Link to={verseUrl(o.osis, strong)}>{osisLabel(o.osis, books)}</Link>
              <span className={hebrew ? "hebrew" : "greek"} style={{ fontSize: 15 }}>
                {o.surface}
              </span>
              <span className="muted">{o.gloss}</span>
            </div>
          ))}
          {data.occurrences.length > limit && (
            <button className="more" onClick={() => setLimit(limit + 80)}>
              Show more
            </button>
          )}
        </div>
      </details>
    </div>
  );
}

const LEX_SHORT: Record<string, string> = {
  tbesg: "STEP brief",
  tbesh: "STEP brief",
  "abbott-smith": "Abbott-Smith",
  lsj: "LSJ",
  bdb: "BDB",
};

function FragmentRow({ label, n, max }: { label: string; n: number; max: number }) {
  return (
    <>
      <span>{label}</span>
      <div className="bar" style={{ width: `${Math.max(4, (n / max) * 100)}%` }} />
      <span className="muted">{n}</span>
    </>
  );
}
