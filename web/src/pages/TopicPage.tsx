import { useMemo, useState, type MouseEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMeta } from "../api";
import { Html } from "../components/Html";
import { formatYear, osisLabel, verseUrl } from "../lib";
import { preferredTranslation, topicUrl, useTopic, type TopicDetail } from "../readingApi";
import { useSettings } from "../settings";
import type { Book } from "../types";

const MAX_CHIPS = 10; // more books than this: a drop-down instead of a row of buttons

/** One topic: its verses book by book, related topics, the fathers who cited them, and how the verses connect. */
export function TopicPage() {
  const { id = "" } = useParams();
  const { settings } = useSettings();
  const edition = preferredTranslation(settings.editions);
  const [book, setBook] = useState<string | null>(null);
  const [current, setCurrent] = useState(id);
  if (current !== id) {
    setCurrent(id);
    setBook(null);
  }
  const { data, isLoading, error } = useTopic(id, edition, book);
  const meta = useMeta();
  const books = meta.data?.books ?? [];

  if (isLoading && !data) return <div className="loading">Loading…</div>;
  if (error || !data) return <div className="error">Could not load this topic: {String(error)}</div>;
  return <Topic data={data} books={books} book={book} onBook={setBook} />;
}

function Topic({ data, books, book, onBook }: { data: TopicDetail; books: Book[]; book: string | null; onBook: (b: string | null) => void }) {
  const navigate = useNavigate();
  const grouped = useMemo(() => {
    const by = new Map<string, TopicDetail["verses"]>();
    for (const v of data.verses) {
      const b = v.osis.split(".")[0]!;
      by.set(b, [...(by.get(b) ?? []), v]);
    }
    return [...by.entries()];
  }, [data.verses]);
  const paged = data.truncated || !!book; // big topics are read one book at a time
  const nameOf = (b: string) => books.find((x) => x.osis === b)?.name ?? data.books.find((x) => x.book === b)?.name ?? b;

  function chooseBook(b: string) {
    if (paged) {
      onBook(b === book ? null : b);
      return;
    }
    document.getElementById(`tb-${b}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  // links between topics in the concordance entry ("See NEBO")
  function onEntryClick(e: MouseEvent<HTMLDivElement>) {
    const t = (e.target as HTMLElement).closest("a")?.getAttribute("data-t");
    if (t?.startsWith("topic ")) {
      e.preventDefault();
      navigate(topicUrl(`btb:${t.slice(6)}`));
    }
  }

  const seeAlso = data.related.filter((r) => r.kind === "see");
  const shared = data.related.filter((r) => r.kind === "shared");
  return (
    <div className="page rd-page">
      <Link to="/topics" className="rd-back">
        ← All topics
      </Link>
      <header className="rd-head">
        <h1>{data.topic.name}</h1>
        <p className="rd-meta">
          {data.total ? (
            <>
              {data.total.toLocaleString()} verse{data.total === 1 ? "" : "s"} in {data.books.length} book{data.books.length === 1 ? "" : "s"}
            </>
          ) : (
            "A cross-reference entry"
          )}
        </p>
      </header>

      <div className="rd-layout">
        <main className="rd-main">
          {data.books.length > MAX_CHIPS && (
            <div className="rd-book-select">
              <select
                className="design-select rd-select"
                value={book ?? ""}
                onChange={(e) => (e.target.value ? chooseBook(e.target.value) : onBook(null))}
                aria-label="Book"
              >
                <option value="">{paged ? "From the start" : "Jump to a book"}</option>
                {data.books.map((b) => (
                  <option key={b.book} value={b.book}>
                    {b.name} ({b.verses})
                  </option>
                ))}
              </select>
              {paged && <span className="muted small"> verses are shown a book at a time</span>}
            </div>
          )}
          {data.books.length > 1 && data.books.length <= MAX_CHIPS && (
            <nav className="rd-books" aria-label="Books">
              {paged && (
                <button className={!book ? "on" : ""} onClick={() => onBook(null)}>
                  From the start
                </button>
              )}
              {data.books.map((b) => (
                <button key={b.book} className={book === b.book ? "on" : ""} onClick={() => chooseBook(b.book)} title={`${b.verses} verses`}>
                  {b.name} <span className="count">{b.verses}</span>
                </button>
              ))}
            </nav>
          )}
          {data.total === 0 && data.topic.body && (
            <div onClick={onEntryClick}>
              <Html html={data.topic.body} className="rd-entry" />
            </div>
          )}
          {grouped.map(([b, verses]) => (
            <section key={b} id={`tb-${b}`} className="rd-book">
              <h2>{nameOf(b)}</h2>
              {verses.map((v) => (
                <p key={v.osis} className="rd-verse">
                  <Link to={verseUrl(v.osis)} className="rd-ref">
                    {osisLabel(v.osis, books).replace(`${nameOf(b)} `, "")}
                  </Link>{" "}
                  {v.text ?? <span className="muted">—</span>}
                </p>
              ))}
            </section>
          ))}
          {data.truncated && (
            <p className="muted small rd-note">
              The first {data.verses.length} verses{book ? ` of ${nameOf(book)}` : ""} are shown. Choose a book above to read the rest.
            </p>
          )}
        </main>

        <aside className="rd-side">
          {(seeAlso.length > 0 || shared.length > 0) && (
            <section className="rd-box">
              <h3>Related topics</h3>
              <div className="rd-chips">
                {[...seeAlso, ...shared].map((r) => (
                  <Link key={r.id} to={topicUrl(r.id)} title={r.kind === "see" ? "Named in this entry" : `${r.shared} verses in common`}>
                    {r.name}
                  </Link>
                ))}
              </div>
            </section>
          )}
          {data.fathers.length > 0 && (
            <section className="rd-box">
              <h3>Read by the fathers</h3>
              <p className="muted small">Writers who quote these verses, those before Nicaea (325) first.</p>
              <ol className="rd-fathers">
                {data.fathers.map((f) => (
                  <li key={f.id}>
                    <div className="rd-father-head">
                      <strong>{f.name}</strong>
                      <span className="muted small">
                        {formatYear(f.year)} · {f.n} citation{f.n === 1 ? "" : "s"}
                      </span>
                    </div>
                    {f.sample && (
                      <div className="small rd-father-sample">
                        <Link to={verseUrl(f.sample.osis)}>{osisLabel(f.sample.osis, books)}</Link> in{" "}
                        {f.sample.edition_id && f.sample.section_ord ? (
                          <Link to={`/library/${encodeURIComponent(f.sample.edition_id)}/${f.sample.section_ord}`}>
                            <i>{f.sample.work_title}</i> {f.sample.cite}
                          </Link>
                        ) : (
                          <i>{f.sample.work_title}</i>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )}
          {data.connections.length > 0 && (
            <section className="rd-box">
              <h3>How the verses connect</h3>
              <p className="muted small">Cross references between verses of this topic.</p>
              <ul className="rd-pairs">
                {data.connections.map((c) => (
                  <li key={`${c.a}-${c.b}`}>
                    <Link to={verseUrl(c.a)}>{osisLabel(c.a, books)}</Link>
                    <span className="muted" aria-label="and">
                      {" "}
                      ↔{" "}
                    </span>
                    <Link to={verseUrl(c.b)}>{osisLabel(c.b, books)}</Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {data.total > 0 && data.topic.body && (
            <details className="rd-box rd-entry-box">
              <summary>Concordance entry</summary>
              <div onClick={onEntryClick}>
                <Html html={data.topic.body} className="rd-entry" />
              </div>
            </details>
          )}
          <p className="muted small rd-credit">Topics from the Bruhman Translator's Bible concordance (CC BY-SA 4.0).</p>
        </aside>
      </div>
    </div>
  );
}
