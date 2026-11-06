import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useMeta } from "../api";
import { CopyMenu } from "../components/CopyCitation";
import { Html } from "../components/Html";
import { Variant } from "../components/StudyPanel";
import { formatYear, osisLabel, verseUrl } from "../lib";
import { useSettings } from "../settings";
import { usePassage, type PassageGuide, type PassageWriter } from "../studyApi";
import { passageUrl } from "../studyLib";
import type { Book } from "../types";

const SIGNIFICANT = new Set(["meaning", "omission", "ketiv-qere"]);

/** The study panel for a whole section: e.g. /passage/John.1.1-John.1.18 (a single verse opens its section). */
export function PassagePage() {
  const { ref = "John.1.1-John.1.18" } = useParams();
  const meta = useMeta();
  const { settings } = useSettings();
  const textEditions = (meta.data?.editions ?? []).filter((e) => e.language === "eng");
  const [chosen, setChosen] = useState<string | null>(null);
  const edition = chosen ?? settings.editions.find((e) => textEditions.some((t) => t.id === e)) ?? "bsb";
  const { data, isLoading, error } = usePassage(ref, edition);
  const books = meta.data?.books ?? [];

  if (isLoading) return <div className="loading">Loading the passage…</div>;
  if (error || !data) return <div className="error">Could not load {ref}: {String(error)}</div>;
  return <Guide g={data} books={books} editions={textEditions.map((e) => ({ id: e.id, abbrev: e.abbrev ?? e.id }))} onEdition={setChosen} />;
}

function Guide({ g, books, editions, onEdition }: { g: PassageGuide; books: Book[]; editions: { id: string; abbrev: string }[]; onEdition: (id: string) => void }) {
  const r = g.range;
  const verseNo = (osis: string) => osis.split(".").slice(1).join(":");
  // within this book: "1:18"; elsewhere: "Genesis 1:1"
  const short = (osis: string) => (osis.startsWith(`${r.book}.`) ? verseNo(osis) : osisLabel(osis, books));
  const era = g.periods.find((p) => !p.parent_id)?.name;
  const period = g.periods.find((p) => p.parent_id)?.name.replace(/^The Life of Christ: /, "");
  const copyable = {
    label: r.label,
    edition: g.edition.abbrev ?? g.edition.id,
    verses: g.verses.filter((v) => v.text).map((v) => ({ verse: v.verse, text: v.text! })),
  };

  return (
    <div className="page passage-page">
      <div className="pg-top">
        <Link to={verseUrl(r.start)} className="book-back">
          ← Read {r.name} {r.chapter}
        </Link>
        <nav className="pg-nav" aria-label="Neighbouring sections">
          {g.prev && (
            <Link to={passageUrl(g.prev.ref)} title={g.prev.title}>
              ‹ {g.prev.title}
            </Link>
          )}
          {g.next && (
            <Link to={passageUrl(g.next.ref)} title={g.next.title}>
              {g.next.title} ›
            </Link>
          )}
        </nav>
      </div>

      <header className="pg-hero">
        <div className="about-label">Passage guide</div>
        <h1>{r.label}</h1>
        <div className="ctx-meta">
          {g.headings.map((h) => (
            <span key={h.start_vkey}>{h.title}</span>
          ))}
          {g.chronology?.labels.length ? <span>{g.chronology.labels.join(" → ")}</span> : null}
          {era && <span>{period ? `${era} — ${period}` : era}</span>}
        </div>
      </header>

      <div className="bk-layout pg-layout">
        <div className="book-col pg-main">
          <section className="pg-text">
            <div className="pg-text-head">
              <span className="muted small">{g.edition.abbrev ?? g.edition.id}</span>
              <CopyMenu passage={copyable.verses.length ? copyable : null} editions={editions} onEdition={onEdition} className="va-btn" />
            </div>
            <PassageText g={g} />
          </section>

          <Variants g={g} short={short} />
          <Fathers fathers={g.fathers} short={short} />
        </div>

        <aside className="book-col side pg-side">
          {g.quotations.length > 0 && (
            <Block title="Old ↔ New Testament" note={g.quotations.length}>
              {g.quotations.map((q, i) => (
                <div key={i} className="item">
                  <div className="item-head">
                    <span>
                      <span className="muted">{q.direction === "quotes" ? `v. ${verseNo(q.here).split(":")[1]} quotes ` : `v. ${verseNo(q.here).split(":")[1]} is quoted in `}</span>
                      <Link to={verseUrl(q.other)} className="who">
                        {osisLabel(q.other, books)}
                      </Link>
                    </span>
                    {q.via && <span className="when">via {q.via}</span>}
                  </div>
                  {q.text && <div className="text">{q.text}</div>}
                </div>
              ))}
            </Block>
          )}
          <CrossRefs g={g} books={books} short={short} />
          <Notes g={g} short={short} />
          {g.topics.length > 0 && (
            <Block title="Topics" note={g.topics.length}>
              <div className="topic-list">
                {g.topics.map((t) => (
                  <Link key={t.id} to={`/search?q=${encodeURIComponent(t.name)}`} title={`${t.n} verse${t.n === 1 ? "" : "s"} here`}>
                    {t.name}
                  </Link>
                ))}
              </div>
            </Block>
          )}
          {g.witnesses.length > 0 && (
            <Block title="Jewish & Roman writers" note={g.witnesses.length}>
              {g.witnesses.map((w) => (
                <Writer key={w.id} w={w} short={short} />
              ))}
            </Block>
          )}
        </aside>
      </div>
    </div>
  );
}

function Block({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="book-block">
      <h3>
        {title}
        {note !== undefined && <span className="count">{note}</span>}
      </h3>
      {children}
    </section>
  );
}

/** The passage itself, in paragraphs that break at the section headings. */
function PassageText({ g }: { g: PassageGuide }) {
  const starts = new Map(g.headings.map((h) => [h.osis, h.title]));
  const paragraphs: { title?: string; verses: PassageGuide["verses"] }[] = [];
  for (const v of g.verses) {
    const title = starts.get(v.osis);
    if (title || !paragraphs.length) paragraphs.push({ title: g.headings.length > 1 ? title : undefined, verses: [] });
    paragraphs[paragraphs.length - 1]!.verses.push(v);
  }
  let chapter = g.range.chapter;
  return (
    <div className="pg-reading">
      {paragraphs.map((p, i) => (
        <Fragment key={i}>
          {p.title && <h2 className="pericope">{p.title}</h2>}
          <p>
            {p.verses.map((v) => {
              const newChapter = v.chapter !== chapter;
              chapter = v.chapter;
              return (
                <span key={v.vkey}>
                  <Link to={verseUrl(v.osis)} className="pg-vnum" title={`Study ${v.osis.replace(/\./, " ").replace(".", ":")} in the reader`}>
                    {newChapter ? `${v.chapter}:${v.verse}` : v.verse}
                  </Link>
                  {v.text ?? "—"}{" "}
                </span>
              );
            })}
          </p>
        </Fragment>
      ))}
    </div>
  );
}

function Variants({ g, short }: { g: PassageGuide; short: (o: string) => string }) {
  const hebrew = g.range.testament !== "NT";
  const major = g.variants.filter((v) => SIGNIFICANT.has(v.significance));
  const minor = g.variants.filter((v) => !SIGNIFICANT.has(v.significance));
  const byVerse = (list: PassageGuide["variants"]) => {
    const out: [string, PassageGuide["variants"]][] = [];
    for (const v of list) {
      if (out[out.length - 1]?.[0] !== v.osis) out.push([v.osis, []]);
      out[out.length - 1]![1].push(v);
    }
    return out;
  };
  return (
    <Block title="Where the editions differ" note={g.variants.length ? `${major.length} significant · ${minor.length} minor` : undefined}>
      {g.variants.length === 0 && <p className="muted">The printed editions agree throughout this passage.</p>}
      {byVerse(major).map(([osis, list]) => (
        <div key={osis} className="pg-verse-group">
          <Link to={verseUrl(osis)} className="pg-verse-ref">
            {short(osis)}
          </Link>
          {list.map((v) => (
            <Variant key={v.id} v={{ ...v, source_id: "" }} hebrew={hebrew} />
          ))}
        </div>
      ))}
      {minor.length > 0 && (
        <details className="pg-more">
          <summary>
            {minor.length} minor difference{minor.length === 1 ? "" : "s"} — spelling and word order
          </summary>
          {byVerse(minor).map(([osis, list]) => (
            <div key={osis} className="pg-verse-group">
              <Link to={verseUrl(osis)} className="pg-verse-ref">
                {short(osis)}
              </Link>
              {list.map((v) => (
                <Variant key={v.id} v={{ ...v, source_id: "" }} hebrew={hebrew} />
              ))}
            </div>
          ))}
        </details>
      )}
    </Block>
  );
}

function Fathers({ fathers, short }: { fathers: PassageWriter[]; short: (o: string) => string }) {
  const pre = fathers.filter((f) => f.pre_nicene);
  const later = fathers.filter((f) => !f.pre_nicene);
  const total = fathers.reduce((s, f) => s + f.n, 0);
  return (
    <Block title="Quoted by the church fathers" note={fathers.length ? `${fathers.length} writers · ${total.toLocaleString()} citations` : undefined}>
      {fathers.length === 0 && <p className="muted">No early Christian writer is recorded quoting these verses.</p>}
      {pre.length > 0 && <p className="pg-sub">Before Nicaea (to AD 325)</p>}
      {pre.map((w) => (
        <Writer key={w.id} w={w} short={short} />
      ))}
      {later.length > 0 &&
        (pre.length > 0 ? (
          <details className="pg-more">
            <summary>
              {later.length} later writer{later.length === 1 ? "" : "s"}
            </summary>
            {later.map((w) => (
              <Writer key={w.id} w={w} short={short} />
            ))}
          </details>
        ) : (
          later.map((w) => <Writer key={w.id} w={w} short={short} />)
        ))}
    </Block>
  );
}

function Writer({ w, short }: { w: PassageWriter; short: (o: string) => string }) {
  const verses = w.verses.map(short);
  return (
    <details className="pg-writer">
      <summary>
        <span className="pw-name">{w.name}</span>
        <span className="pw-meta">
          {formatYear(w.year)}
          <span className="muted">
            {" "}
            · {w.n}× · {verses.length === 1 ? "v." : "vv."} {verses.join(", ")}
          </span>
        </span>
      </summary>
      <div className="pw-works">
        {w.works.map((x, i) => (
          <div key={i} className="item">
            <div className="item-head">
              <span>
                {x.edition_id && x.section_ord ? (
                  <Link to={`/library/${encodeURIComponent(x.edition_id)}/${x.section_ord}`}>
                    <i>{x.work_title}</i> {x.cite}
                  </Link>
                ) : (
                  <>
                    <i>{x.work_title}</i> {x.cite}
                  </>
                )}
              </span>
              <span className="when">
                {short(x.osis)}
                {x.times > 1 ? ` · ${x.times}×` : ""}
              </span>
            </div>
            {x.snippet && <div className="text">{x.snippet}</div>}
          </div>
        ))}
        {w.places > w.works.length && <p className="muted small">and {w.places - w.works.length} more places in their writings</p>}
      </div>
    </details>
  );
}

function CrossRefs({ g, books, short }: { g: PassageGuide; books: Book[]; short: (o: string) => string }) {
  const [limit, setLimit] = useState(10);
  if (!g.crossrefs.length) return null;
  return (
    <Block title="Cross references" note={g.crossrefs.length}>
      {g.crossrefs.slice(0, limit).map((x) => (
        <div key={`${x.osis}-${x.end_osis}`} className="item">
          <div className="item-head">
            <Link to={verseUrl(x.osis)} className="who">
              {osisLabel(x.osis, books)}
              {x.end_osis ? `–${x.end_osis.split(".").slice(-1)[0]}` : ""}
            </Link>
            <span className="when" title={`${x.votes} votes (OpenBible.info)`}>
              from {x.from.map(short).join(", ")}
            </span>
          </div>
          {x.text && <div className="text">{x.text}</div>}
        </div>
      ))}
      {g.crossrefs.length > limit && (
        <button className="more" onClick={() => setLimit(limit + 15)}>
          Show more ({g.crossrefs.length - limit})
        </button>
      )}
    </Block>
  );
}

function Notes({ g, short }: { g: PassageGuide; short: (o: string) => string }) {
  const english = useMemo(() => g.footnotes.filter((f) => f.language === "eng"), [g.footnotes]);
  const [open, setOpen] = useState(false);
  if (!english.length) return null;
  const shown = open ? english : english.slice(0, 6);
  return (
    <Block title="Translators' notes" note={english.length}>
      {shown.map((f, i) => (
        <div key={`${f.osis}-${f.edition_id}-${f.n}-${i}`} className="fn-item">
          <div className="fn-head">
            <span className="who">
              {short(f.osis)} · {f.abbrev ?? f.edition_id}
            </span>
            {f.anchor && <span className="fn-anchor">at “…{f.anchor.split(" ").slice(-3).join(" ")}”</span>}
          </div>
          <Html html={f.body} className="fn-text" />
        </div>
      ))}
      {english.length > shown.length && (
        <button className="more" onClick={() => setOpen(true)}>
          Show all {english.length}
        </button>
      )}
    </Block>
  );
}
