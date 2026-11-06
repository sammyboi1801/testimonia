import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useBookGuide, useMeta } from "../api";
import { PassageLink } from "../components/PassageLink";
import { WikiCard } from "../components/Wiki";
import { formatYear, osisLabel, verseUrl } from "../lib";
import type { Book, BookGuide } from "../types";

const TESTAMENT: Record<string, string> = { OT: "Old Testament", NT: "New Testament", DC: "Deuterocanon / Apocrypha" };
const SIGNIFICANCE: Record<string, string> = {
  meaning: "change the meaning",
  omission: "add or leave out words",
  "ketiv-qere": "written vs. read (Ketiv/Qere)",
  order: "change the word order",
  spelling: "spelling only",
};

/** A book of the Bible as a whole: introduction, outline, how the early church read it, links and text history. */
export function BookPage() {
  const { book = "John" } = useParams();
  const { data, isLoading, error } = useBookGuide(book);
  const meta = useMeta();
  const books = meta.data?.books ?? [];

  if (isLoading) return <div className="loading">Loading…</div>;
  if (error || !data) return <div className="error">Could not load {book}: {String(error)}</div>;
  const b = data.book;
  const names = [
    b.hebrew_name && ["Hebrew", b.hebrew_name, "hebrew"],
    b.greek_name && ["Greek", b.greek_name, "greek"],
    b.latin_name && ["Latin", b.latin_name, ""],
  ].filter(Boolean) as [string, string, string][];

  return (
    <div className="page book-page">
      <Link to={`/read/${b.osis}/1`} className="book-back">
        ← Read {b.name}
      </Link>
      <header className="book-hero">
        <div>
          <div className="about-label">About this book</div>
          <h1>{b.name}</h1>
          <div className="ctx-meta">
            <span>{TESTAMENT[b.testament] ?? b.testament}</span>
            {b.genre && <span>{b.genre}</span>}
            <span>{data.stats.chapters} chapters</span>
            <span>{data.stats.verses.toLocaleString()} verses</span>
            {data.stats.words > 0 && <span>{data.stats.words.toLocaleString()} {b.testament === "NT" ? "Greek" : "Hebrew"} words</span>}
          </div>
          {names.length > 0 && (
            <dl className="book-names">
              {names.map(([label, value, cls]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd className={cls}>{value}</dd>
                </div>
              ))}
            </dl>
          )}
          <Link className="btn" to={`/read/${b.osis}/1`}>
            Start reading →
          </Link>
          {["Matt", "Mark", "Luke", "John"].includes(b.osis) && <Link className="rd-book-parallels" to={`/parallels?order=${b.osis}`}>Parallels in the other Gospels →</Link>}
        </div>
        {b.wikipedia && <WikiCard title={b.wikipedia} />}
      </header>

      <div className="bk-layout">
        <section className="book-col">
          <h2>Outline</h2>
          <Outline data={data} />
        </section>

        <aside className="book-col side">
          {data.periods.length > 0 && (
            <Block title="When it happens" note={data.chronology?.start != null ? chronLabel(data.chronology.start, data.chronology.end) : undefined}>
              <ol className="book-periods">
                {data.periods.map((p) => (
                  <li key={p.id}>
                    <Link to={verseUrl(p.osis)}>{p.name.replace(/^The Life of Christ: /, "")}</Link>
                    <span className="muted small"> · {p.verses} verses</span>
                  </li>
                ))}
              </ol>
            </Block>
          )}

          {data.quoted.length > 0 && (
            <Block title="Most quoted by the early church" note={`${data.stats.citations.toLocaleString()} citations in the fathers`}>
              <ol className="book-quoted">
                {data.quoted.map((q) => (
                  <li key={q.vkey}>
                    <div className="bq-head">
                      <Link to={verseUrl(q.osis).replace("?", "?t=fathers&")}>{osisLabel(q.osis, books)}</Link>
                      <span className="muted small">
                        {q.n}× · {q.pre_nicene} before Nicaea
                      </span>
                    </div>
                    {q.text && <p>{q.text}</p>}
                  </li>
                ))}
              </ol>
            </Block>
          )}

          {data.readers.length > 0 && (
            <Block title="Who quoted it most">
              <Readers data={data} />
            </Block>
          )}

          {data.quotations.length > 0 && (
            <Block title="Old ↔ New Testament" note={`${data.quotations.length} links`}>
              <Quotations data={data} books={books} />
            </Block>
          )}

          {data.stats.variants > 0 && (
            <Block title="Text and manuscripts" note={`${data.stats.variants.toLocaleString()} places where editions differ`}>
              <ul className="book-variants">
                {data.variants.map((v) => (
                  <li key={v.significance}>
                    <strong>{v.n.toLocaleString()}</strong> {SIGNIFICANCE[v.significance] ?? v.significance}
                  </li>
                ))}
              </ul>
              {data.notable_variants.length > 0 && (
                <p className="book-notable">
                  {data.notable_variants.slice(0, 16).map((v) => (
                    <Link key={v.start_vkey} to={verseUrl(v.osis)} title={v.label}>
                      {osisLabel(v.osis, books).replace(`${b.name} `, "")}
                    </Link>
                  ))}
                </p>
              )}
            </Block>
          )}

          {data.witnesses.length > 0 && (
            <Block title="Jewish & Roman writers" note={`${data.witnesses.length}`}>
              {data.witnesses.map((w, i) => (
                <div key={i} className="item">
                  <Link to={verseUrl(w.osis)}>{osisLabel(w.osis, books)}</Link> — <strong>{w.author}</strong>,{" "}
                  {w.edition_id && w.section_ord ? (
                    <Link to={`/library/${encodeURIComponent(w.edition_id)}/${w.section_ord}`}>
                      <i>{w.work_title}</i> {w.cite}
                    </Link>
                  ) : (
                    <i>{w.work_title}</i>
                  )}
                  {w.snippet && <p className="note-text">{w.snippet}</p>}
                </div>
              ))}
            </Block>
          )}
        </aside>
      </div>
    </div>
  );
}

function chronLabel(start: number, end: number | null): string {
  return end === null || end === start ? `c. ${formatYear(start)}` : `c. ${formatYear(start)} – ${end <= 0 ? formatYear(end) : `AD ${end}`}`;
}

function Block({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="book-block">
      <h3>
        {title}
        {note && <span className="count">{note}</span>}
      </h3>
      {children}
    </section>
  );
}

function Outline({ data }: { data: BookGuide }) {
  const chapters = useMemo(() => {
    const by = new Map<number, BookGuide["outline"]>();
    for (const h of data.outline) by.set(h.chapter, [...(by.get(h.chapter) ?? []), h]);
    return Array.from({ length: data.stats.chapters }, (_, i) => ({ n: i + 1, headings: by.get(i + 1) ?? [] }));
  }, [data]);
  const b = data.book;
  return (
    <ol className="book-outline">
      {chapters.map((c) => (
        <li key={c.n}>
          <Link className="bo-num" to={`/read/${b.osis}/${c.n}`} title={`${b.name} ${c.n}`}>
            {c.n}
          </Link>
          <div className="bo-heads">
            {c.headings.length ? (
              c.headings.map((h) => (
                <span key={h.start_vkey} className="bo-head">
                  <Link to={verseUrl(h.osis)}>
                    {h.title}
                    <span className="muted small"> {h.osis.split(".").slice(1).join(":")}</span>
                  </Link>
                  <PassageLink osis={h.osis} title={h.title} variant="outline" />
                </span>
              ))
            ) : (
              <Link to={`/read/${b.osis}/${c.n}`} className="muted">
                Chapter {c.n}
              </Link>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Readers({ data }: { data: BookGuide }) {
  const max = Math.max(1, ...data.readers.map((r) => r.n));
  return (
    <div className="book-readers">
      {data.readers.map((r) => (
        <Link key={r.id} to={`/library?view=timeline&sel=a:${r.id}`} className="br-row" title={`${r.n} citations`}>
          <span className="br-name">{r.name}</span>
          <span className="br-bar">
            <i style={{ width: `${(r.n / max) * 100}%` }} />
          </span>
          <span className="br-n">{r.n.toLocaleString()}</span>
        </Link>
      ))}
    </div>
  );
}

function Quotations({ data, books }: { data: BookGuide; books: Book[] }) {
  const [all, setAll] = useState(false);
  const quotes = data.quotations.filter((q) => q.direction === "quotes");
  const quotedBy = data.quotations.filter((q) => q.direction === "quoted_by");
  const list = (rows: BookGuide["quotations"]) => (all ? rows : rows.slice(0, 8));
  const label = (o: string) => osisLabel(o, books);
  return (
    <>
      {quotes.length > 0 && <p className="muted small">{data.book.name} quotes</p>}
      {list(quotes).map((q, i) => (
        <div key={`q${i}`} className="bq-link">
          <Link to={verseUrl(q.here)}>{label(q.here)}</Link> ← <Link to={verseUrl(q.other)}>{label(q.other)}</Link>
        </div>
      ))}
      {quotedBy.length > 0 && <p className="muted small">Quoted in</p>}
      {list(quotedBy).map((q, i) => (
        <div key={`b${i}`} className="bq-link">
          <Link to={verseUrl(q.here)}>{label(q.here)}</Link> → <Link to={verseUrl(q.other)}>{label(q.other)}</Link>
        </div>
      ))}
      {!all && (quotes.length > 8 || quotedBy.length > 8) && (
        <button className="link-btn" onClick={() => setAll(true)}>
          Show all {data.quotations.length}
        </button>
      )}
    </>
  );
}
