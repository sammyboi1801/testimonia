import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMeta } from "../api";
import { osisLabel, verseUrl } from "../lib";
import { useSettings } from "../settings";
import { useGrammar, type GrammarResults } from "../studyApi";
import { featureLabel, GRAMMAR_FEATURES } from "../studyLib";
import type { Book } from "../types";

type Lang = "grc" | "hbo";
const FIELDS = ["lemma", "lang", "book", "article", ...new Set(Object.values(GRAMMAR_FEATURES).flatMap((f) => f.map((x) => x.key)))];
const EXAMPLES: { label: string; q: Record<string, string> }[] = [
  { label: "aorist passives of λύω", q: { lemma: "λύω", tense: "aorist", voice: "passive" } },
  { label: "θεός without the article in John", q: { lemma: "θεός", book: "John", article: "without" } },
  { label: "aorist passive imperatives", q: { tense: "aorist", voice: "passive", mood: "imperative" } },
  { label: "hiphil imperatives of שׁוּב", q: { lemma: "H7725", stem: "hiphil", form: "imperative" } },
];
const SIZE = 25;

/** Search the Greek NT / Hebrew OT by dictionary form and grammatical form (the "Grammar" tab of Search). */
export function GrammarSearch() {
  const [params, setParams] = useSearchParams();
  const meta = useMeta();
  const books = meta.data?.books ?? [];
  const { settings } = useSettings();
  const query = useMemo(() => {
    const q: Record<string, string> = {};
    for (const k of FIELDS) {
      const v = params.get(k);
      if (v) q[k] = v;
    }
    if (params.get("strong") && !q.lemma) q.lemma = params.get("strong")!;
    return q;
  }, [params]);
  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
  const english = settings.editions.find((e) => meta.data?.editions.some((x) => x.id === e && x.language === "eng")) ?? "bsb";
  const { data, isFetching, error } = useGrammar({ ...query, page: String(page), size: String(SIZE), edition: english });

  // the form: a draft of the query, applied on submit
  const [draft, setDraft] = useState<Record<string, string>>(query);
  useEffect(() => {
    setDraft(query);
  }, [query]);
  const guessed: Lang = /^H\d/i.test(draft.lemma ?? "") || /[֐-׿]/.test(draft.lemma ?? "") ? "hbo" : /^G\d/i.test(draft.lemma ?? "") || /[Ͱ-Ͽἀ-῿]/.test(draft.lemma ?? "") ? "grc" : ((draft.lang as Lang) ?? "grc");
  const unchanged = (draft.lemma ?? "") === (query.lemma ?? "") && (draft.lang ?? "") === (query.lang ?? "");
  const lang: Lang = data && unchanged ? data.language : guessed;
  const features = GRAMMAR_FEATURES[lang];
  const testamentBooks = books.filter((b) => b.testament === (lang === "grc" ? "NT" : "OT"));

  function apply(q: Record<string, string>, p = 1) {
    const next = new URLSearchParams({ in: "grammar" });
    for (const [k, v] of Object.entries(q)) if (v) next.set(k, v);
    if (p > 1) next.set("page", String(p));
    setParams(next);
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    // features the other language does not have are dropped
    const keep = new Set(["lemma", "lang", "book", "article", ...features.map((f) => f.key)]);
    apply(Object.fromEntries(Object.entries({ ...draft, lang }).filter(([k]) => keep.has(k))));
  }
  const set = (k: string, v: string) => setDraft((d) => ({ ...d, [k]: v }));
  const setLang = (l: Lang) => setDraft({ lang: l }); // a word or book of the other Testament would not match
  const empty = Object.keys(query).filter((k) => k !== "lang").length === 0;

  return (
    <div className="grammar">
      <form className="gr-form" onSubmit={submit} aria-label="Grammar search">
        <div className="gr-row">
          <label className="gr-field gr-word">
            <span>Word</span>
            <input
              value={draft.lemma ?? ""}
              onChange={(e) => set("lemma", e.target.value)}
              placeholder={lang === "grc" ? "λύω · luo · G3089 — or leave empty" : "שׁוּב · shuv · H7725 — or leave empty"}
              aria-label="Dictionary form, transliteration or Strong's number"
            />
          </label>
          <div className="gr-field">
            <span>Language</span>
            <div className="seg gr-lang" role="radiogroup" aria-label="Language">
              {(["grc", "hbo"] as Lang[]).map((l) => (
                <button key={l} type="button" role="radio" aria-checked={lang === l} className={lang === l ? "on" : ""} onClick={() => setLang(l)}>
                  {l === "grc" ? "Greek NT" : "Hebrew OT"}
                </button>
              ))}
            </div>
          </div>
          <label className="gr-field">
            <span>Book</span>
            <select value={draft.book ?? ""} onChange={(e) => set("book", e.target.value)}>
              <option value="">All books</option>
              {testamentBooks.map((b) => (
                <option key={b.osis} value={b.osis}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="gr-row gr-features">
          {features.map((f) => (
            <label key={f.key} className="gr-field">
              <span>{f.label}</span>
              <select value={draft[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)}>
                <option value="">any</option>
                {f.values.map((v) => (
                  <option key={v} value={v}>
                    {featureLabel(v)}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label className="gr-field">
            <span>Article</span>
            <select value={draft.article ?? ""} onChange={(e) => set("article", e.target.value)}>
              <option value="">either</option>
              <option value="with">with the article</option>
              <option value="without">without</option>
            </select>
          </label>
        </div>
        <div className="gr-actions">
          <button className="btn" type="submit">
            Find
          </button>
          {Object.keys(draft).some((k) => draft[k] && k !== "lang") && (
            <button type="button" className="link-btn" onClick={() => setDraft({ lang })}>
              Clear
            </button>
          )}
          {isFetching && <span className="muted small">Searching…</span>}
        </div>
      </form>

      {empty && (
        <div className="search-start">
          <p className="muted">
            Find every word of a given form — by dictionary form, transliteration or Strong's number, and any of its grammar. For example:
          </p>
          <div className="search-examples">
            {EXAMPLES.map((ex) => (
              <button key={ex.label} className="chip" onClick={() => apply(ex.q)}>
                {ex.label}
              </button>
            ))}
          </div>
          <p className="muted small">
            Greek from the Tyndale House tagged Greek New Testament (TAGNT), Hebrew from the tagged Hebrew Old Testament (TAHOT). “Without the article” in Greek means
            no article right before the word (or before a particle or adjective in front of it).
          </p>
        </div>
      )}

      {error && <div className="error">{String(error)}</div>}
      {data && !empty && <Results data={data} books={books} page={page} onPage={(p) => apply(query, p)} onBook={(b) => apply({ ...query, book: b })} />}
    </div>
  );
}

function Results({ data, books, page, onPage, onBook }: { data: GrammarResults; books: Book[]; page: number; onPage: (p: number) => void; onBook: (b: string) => void }) {
  const pages = Math.max(1, Math.ceil(data.verses / data.size));
  const hebrew = data.language === "hbo";
  const groups = useMemo(() => {
    const by: { book: string; rows: GrammarResults["results"] }[] = [];
    for (const r of data.results) {
      if (by[by.length - 1]?.book !== r.book) by.push({ book: r.book, rows: [] });
      by[by.length - 1]!.rows.push(r);
    }
    return by;
  }, [data.results]);
  const name = (osis: string) => books.find((b) => b.osis === osis)?.name ?? osis;
  const filters = Object.entries(data.query).filter(([k, v]) => v && k !== "word" && k !== "book");

  if (data.message) return <div className="empty-state">{data.message}</div>;
  return (
    <section className="gr-results">
      <header className="gr-summary">
        <div>
          <strong>{data.total.toLocaleString()}</strong> {data.total === 1 ? "word" : "words"} in <strong>{data.verses.toLocaleString()}</strong>{" "}
          {data.verses === 1 ? "verse" : "verses"}
          {data.lemmas.length > 0 && (
            <>
              {" · "}
              {data.lemmas.map((l) => (
                <span key={l.id} className="gr-lemma">
                  <span className={hebrew ? "hebrew" : "greek"}>{l.lemma}</span> <span className="muted">{l.translit} “{l.gloss}”</span>
                </span>
              ))}
            </>
          )}
          {filters.length > 0 && <span className="muted"> · {filters.map(([k, v]) => (k === "article" ? `${v} article` : featureLabel(v!))).join(" ")}</span>}
        </div>
        {data.by_book.length > 1 && (
          <div className="gr-books" aria-label="By book">
            {data.by_book.map((b) => (
              <button key={b.book} className="tag" onClick={() => onBook(b.book)} title={`Only ${b.name}`}>
                {b.name} <span className="muted">{b.n}</span>
              </button>
            ))}
          </div>
        )}
      </header>
      {data.total === 0 && <div className="empty-state">No words of this form{data.query.book ? ` in ${name(data.query.book)}` : ""}.</div>}
      {groups.map((g) => (
        <div key={g.book} className="gr-group">
          <h3>{name(g.book)}</h3>
          {g.rows.map((r) => {
            const hits = r.words.filter((w) => w.hit);
            return (
              <div key={r.osis} className="gr-hit">
                <Link className="gr-ref" to={verseUrl(r.osis, hits[0]?.lemma_id ?? undefined)}>
                  {osisLabel(r.osis, books).replace(`${name(g.book)} `, "")}
                </Link>
                <div className="gr-body">
                  <p className={`gr-orig ${hebrew ? "hebrew" : "greek"}`} dir={hebrew ? "rtl" : undefined}>
                    {r.words.map((w) => (
                      <span key={w.pos}>
                        {w.hit ? <mark className="gr-mark">{w.surface}</mark> : w.surface}{" "}
                      </span>
                    ))}
                  </p>
                  <p className="gr-parse">
                    {hits.map((w, i) => (
                      <span key={w.pos}>
                        {i > 0 && " · "}
                        <span className={hebrew ? "hebrew" : "greek"}>{w.surface.replace(/[.,;·:]+$/u, "")}</span> {w.parse}
                        {w.gloss && <span className="muted"> “{w.gloss}”</span>}
                        {w.only_in && <span className="tag" title="Not in the Nestle–Aland text">only {w.only_in}</span>}
                      </span>
                    ))}
                  </p>
                  {r.text && <p className="gr-text">{r.text}</p>}
                </div>
              </div>
            );
          })}
        </div>
      ))}
      {pages > 1 && (
        <nav className="pager gr-pager" aria-label="Pages">
          <button className="btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            ‹ Previous
          </button>
          <span className="muted small">
            Page {page} of {pages}
          </span>
          <button className="btn" disabled={page >= pages} onClick={() => onPage(page + 1)}>
            Next ›
          </button>
        </nav>
      )}
    </section>
  );
}
