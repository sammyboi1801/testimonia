import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { topicUrl, useTopics, type TopicSummary } from "../readingApi";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/** The topical index: every topic A–Z, with a filter and a letter bar. */
export function TopicsPage() {
  const { data, isLoading, error } = useTopics();
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const groups = useMemo(() => {
    const by = new Map<string, TopicSummary[]>();
    for (const t of data?.topics ?? []) {
      if (needle && !t.name.toLowerCase().includes(needle)) continue;
      const letter = t.name[0]?.toUpperCase() ?? "#";
      by.set(letter, [...(by.get(letter) ?? []), t]);
    }
    return by;
  }, [data, needle]);
  const shown = [...groups.values()].reduce((n, g) => n + g.length, 0);

  return (
    <div className="page rd-page">
      <header className="rd-head">
        <h1>Topics</h1>
        <p className="rd-lede">
          A concordance of {data ? data.total.toLocaleString() : "five thousand"} subjects — people, places, doctrines and themes — each gathering the
          verses that speak of it.
        </p>
        <input className="rd-filter" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a topic: grace, Melchizedek, Sabbath…" aria-label="Find a topic" />
        <nav className="rd-letters" aria-label="Jump to letter">
          {LETTERS.map((l) =>
            groups.has(l) ? (
              <a key={l} href={`#topics-${l}`} onClick={(e) => jump(e, l)}>
                {l}
              </a>
            ) : (
              <span key={l} aria-hidden>
                {l}
              </span>
            ),
          )}
        </nav>
      </header>
      {isLoading && <div className="loading">Loading topics…</div>}
      {error && <div className="error">{String(error)}</div>}
      {data && shown === 0 && <div className="empty-state">No topic matches “{q}”.</div>}
      {[...groups.entries()].map(([letter, list]) => (
        <section key={letter} id={`topics-${letter}`} className="rd-letter-group">
          <h2>{letter}</h2>
          <ul className="rd-topic-list">
            {list.map((t) => (
              <li key={t.id}>
                <Link to={topicUrl(t.id)}>{t.name}</Link>
                {t.verses > 0 && <span className="muted small"> {t.verses}</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function jump(e: React.MouseEvent, letter: string) {
  e.preventDefault();
  document.getElementById(`topics-${letter}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
}
