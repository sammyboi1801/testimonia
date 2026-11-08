import { useState } from "react";
import { Link } from "react-router-dom";
import { useWord } from "../api";
import { osisLabel, verseUrl } from "../lib";
import type { Book } from "../types";
import { Html } from "./Html";
import { Speak } from "./Speak";
import { WordChart } from "./WordChart";
import { WordDomains } from "./WordDomains";

export function WordStudy({ strong, books, onBack, onWord }: { strong: string; books: Book[]; onBack: () => void; onWord: (s: string) => void }) {
  const { data, isLoading, error } = useWord(strong);
  const [tab, setTab] = useState(0);
  const [limit, setLimit] = useState(40);
  if (isLoading) return <div className="loading">Loading {strong}…</div>;
  if (error || !data) return <div className="error">Could not load {strong}: {String(error)}</div>;
  const hebrew = strong.startsWith("H");
  const lex = data.lexicons[Math.min(tab, data.lexicons.length - 1)];

  return (
    <div className="guide-inner">
      <button className="back" onClick={onBack}>
        ← all words in this verse
      </button>
      <div className="lemma-head">
        <span className={`lemma ${hebrew ? "hebrew" : "greek"}`} dir={hebrew ? "rtl" : undefined}>
          {data.lemma?.lemma ?? strong}
        </span>
        {data.lemma?.lemma && <Speak text={data.lemma.lemma} lang={hebrew ? "hbo" : "grc"} />}
        <span className="muted">{data.lemma?.translit}</span>
        <span className="tag">{strong}</span>
      </div>
      {data.lemma?.gloss && <div className="ws-gloss">{data.lemma.gloss}</div>}
      <p className="ws-summary">
        Appears <b>{data.total.toLocaleString()}</b> {data.total === 1 ? "time" : "times"} in the {hebrew ? "Hebrew Bible" : "New Testament"}
        {data.glosses.length > 0 && (
          <>
            , most often translated{" "}
            {data.glosses.slice(0, 3).map((g, i, a) => (
              <span key={g.gloss}>
                {i > 0 && (i === a.length - 1 ? " or " : ", ")}“{g.gloss}”
              </span>
            ))}
          </>
        )}
        .
      </p>

      <details className="section" open>
        <summary>
          How it is translated <span className="count">and where</span>
        </summary>
        <div className="section-body">
          <div style={{ marginBottom: 8 }}>
            {data.glosses.slice(0, 12).map((g) => (
              <span key={g.gloss} className="tag">
                {g.gloss} <span className="muted">{g.n}</span>
              </span>
            ))}
          </div>
          <WordChart strong={strong} byBook={data.by_book} books={books} />
          <Link className="link-btn find-forms" to={`/search?in=grammar&lemma=${encodeURIComponent(strong)}`}>
            Find all forms like this →
          </Link>
        </div>
      </details>

      <details className="section">
        <summary>
          Every verse it is in <span className="count">{data.occurrences.length}</span>
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
      <h4 className="ws-deeper">Go deeper</h4>
      <WordDomains strong={strong} onWord={onWord} />

      {data.lexicons.length > 0 && lex && (
        <details className="section">
          <summary>
            Dictionary entries <span className="count">{data.lexicons.length}</span>
          </summary>
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
