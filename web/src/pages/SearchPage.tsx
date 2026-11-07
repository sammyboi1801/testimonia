import DOMPurify from "dompurify";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMeta, useSearch } from "../api";
import { GrammarSearch } from "../components/GrammarSearch";
import { ReadingLinks } from "../components/ReadingLinks";
import { osisLabel, verseUrl } from "../lib";
import type { Book, SearchResults } from "../types";

const snip = (html: string) => ({ __html: DOMPurify.sanitize(html, { ALLOWED_TAGS: ["mark"] }) });

type Scope = "all" | "bible" | "works" | "lexicon" | "grammar";
const SCOPES: { id: Scope; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "bible", label: "Bible" },
  { id: "works", label: "Early Christian writings" },
  { id: "lexicon", label: "Greek & Hebrew words" },
  { id: "grammar", label: "Grammar" },
];
const EXAMPLES = ["only begotten", "λόγος", "Melchizedek", "rule of faith", "בְּרֵאשִׁית", "the eighth day", "Isa 53", "logos spermatikos"];
const LIMIT = 40;

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const scopeParam = params.get("in") as Scope | null;
  const scope: Scope = scopeParam && SCOPES.some((s) => s.id === scopeParam) ? scopeParam : "all";
  const [text, setText] = useState(q);
  useEffect(() => {
    setText(q);
  }, [q]);
  const { data, isFetching, error } = useSearch(scope === "grammar" ? "" : q, scope);
  const meta = useMeta();
  const books = meta.data?.books ?? [];

  function go(query: string, s: Scope = scope) {
    const next = new URLSearchParams();
    if (query.trim()) next.set("q", query.trim());
    if (s !== "all") next.set("in", s);
    setParams(next);
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    go(text);
  }

  const counts: Record<Scope, number | null> = {
    all: null,
    bible: data?.bible?.length ?? null,
    works: data?.works?.length ?? null,
    lexicon: data?.lexicon?.length ?? null,
    grammar: null,
  };
  const none = data && !data.reference && !data.bible?.length && !data.works?.length && !data.lexicon?.length;

  return (
    <div className="page search-page">
      <form onSubmit={submit} className="search-hero" role="search">
        <h1>Search</h1>
        <div className="search-box" hidden={scope === "grammar"}>
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
            <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M13 13l4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="A word, a phrase, a name, a reference — in English, Greek or Hebrew"
            aria-label="Search"
            autoFocus
          />
          {isFetching && <span className="search-busy">Searching…</span>}
          <button className="btn" type="submit">
            Search
          </button>
        </div>
        <nav className="search-scopes" aria-label="Search in">
          {SCOPES.map((s) => (
            <button key={s.id} type="button" className={scope === s.id ? "on" : ""} onClick={() => go(q, s.id)}>
              {s.label}
              {q && counts[s.id] !== null && <span className="count">{counts[s.id] === LIMIT ? `${LIMIT}+` : counts[s.id]}</span>}
            </button>
          ))}
        </nav>
      </form>

      {scope === "grammar" && <GrammarSearch />}

      {error && <div className="error">{String(error)}</div>}

      {!q && scope !== "grammar" && (
        <div className="search-start">
          <p className="muted">Try one of these:</p>
          <div className="search-examples">
            {EXAMPLES.map((ex) => (
              <button key={ex} className={`chip ${/[Ͱ-Ͽἀ-῿]/.test(ex) ? "greek" : /[֐-׿]/.test(ex) ? "hebrew" : ""}`} onClick={() => go(ex)}>
                {ex}
              </button>
            ))}
          </div>
          {meta.data && (
            <div className="search-scope-cards">
              <div>
                <strong>{meta.data.editions.length}</strong>
                <span>Bible editions — English, Greek, Hebrew and Latin</span>
              </div>
              <div>
                <strong>{meta.data.counts.works.toLocaleString()}</strong>
                <span>early Christian, Jewish and Roman writings</span>
              </div>
              <div>
                <strong>{meta.data.counts.commentary.toLocaleString()}</strong>
                <span>comments of the fathers on particular verses</span>
              </div>
            </div>
          )}
          <p className="muted small">Greek and Hebrew match without accents or vowel points: λογος finds λόγος, λόγου, λόγῳ…</p>
          <ReadingLinks className="rd-links-search" />
        </div>
      )}

      {data?.reference && (
        <Link className="search-ref" to={verseUrl(data.reference.osis, undefined, data.reference.to)}>
          <span className="muted small">Go to the passage</span>
          <strong>{data.reference.label}</strong>
          <span aria-hidden>→</span>
        </Link>
      )}
      {!!data?.suggestions?.length && (
        <p className="search-alts muted small">
          or did you mean{" "}
          {data.suggestions.map((r, i) => (
            <span key={r.osis}>
              {i > 0 && ", "}
              <Link to={verseUrl(r.osis, undefined, r.to)}>{r.label}</Link>
            </span>
          ))}
          ?
        </p>
      )}

      {none && <div className="empty-state">Nothing found for “{q}”. Try fewer words, or another spelling.</div>}

      {data && (scope === "all" || scope === "bible") && (data.bible?.length ?? 0) > 0 && (
        <ResultSection title="Bible" count={data.bible!.length} more={scope === "all" && data.bible!.length > 6 ? () => go(q, "bible") : undefined}>
          <BibleResults rows={data.bible!} books={books} max={scope === "all" ? 6 : LIMIT} />
        </ResultSection>
      )}

      {data && (scope === "all" || scope === "works") && (data.works?.length ?? 0) > 0 && (
        <ResultSection title="Early Christian writings" count={data.works!.length} more={scope === "all" && data.works!.length > 5 ? () => go(q, "works") : undefined}>
          {data.works!.slice(0, scope === "all" ? 5 : LIMIT).map((r) => (
            <Link key={`${r.edition_id}-${r.ord}`} className="hit" to={`/library/${encodeURIComponent(r.edition_id)}/${r.ord}`}>
              <div className="hit-head">
                <strong>{r.work_title}</strong>
                <span className="muted small">
                  {r.author ?? "Anonymous"}
                  {r.cite && r.cite !== "1" ? ` · ${r.cite}` : ""}
                </span>
              </div>
              <div className="hit-snip" dangerouslySetInnerHTML={snip(r.snippet)} />
            </Link>
          ))}
        </ResultSection>
      )}

      {data && (scope === "all" || scope === "lexicon") && (data.lexicon?.length ?? 0) > 0 && (
        <ResultSection title="Greek & Hebrew words" count={data.lexicon!.length} more={scope === "all" && data.lexicon!.length > 8 ? () => go(q, "lexicon") : undefined}>
          <div className="lex-hits">
            {data.lexicon!.slice(0, scope === "all" ? 8 : LIMIT).map((l) => (
              <Link key={l.id} className="lex-hit" to={l.id.startsWith("H") ? `/read/Gen/1?v=Gen.1.1&w=${l.id}&t=words` : `/read/John/1?v=John.1.1&w=${l.id}&t=words`}>
                <span className={l.id.startsWith("H") ? "hebrew" : "greek"}>{l.lemma}</span>
                <span className="muted small">
                  {l.translit} · {l.id}
                </span>
                <span>{l.gloss}</span>
              </Link>
            ))}
          </div>
        </ResultSection>
      )}
    </div>
  );
}

function ResultSection({ title, count, more, children }: { title: string; count: number; more?: () => void; children: React.ReactNode }) {
  return (
    <section className="hits">
      <header>
        <h2>{title}</h2>
        <span className="muted small">{count === LIMIT ? `${LIMIT}+ results` : `${count} result${count === 1 ? "" : "s"}`}</span>
        {more && (
          <button className="link-btn" onClick={more}>
            See all →
          </button>
        )}
      </header>
      {children}
    </section>
  );
}

/** Bible hits grouped by verse: one card per verse, with every edition that matched. */
function BibleResults({ rows, books, max }: { rows: NonNullable<SearchResults["bible"]>; books: Book[]; max: number }) {
  const verses = useMemo(() => {
    const by = new Map<string, typeof rows>();
    for (const r of rows) by.set(r.osis, [...(by.get(r.osis) ?? []), r]);
    return [...by.entries()];
  }, [rows]);
  return (
    <>
      {verses.slice(0, max).map(([osis, hits]) => (
        <Link key={osis} className="hit" to={verseUrl(osis)}>
          <div className="hit-head">
            <strong>{osisLabel(osis, books)}</strong>
            <span className="hit-eds">
              {hits.map((h) => (
                <span key={h.edition_id} className="tag">
                  {h.abbrev ?? h.edition_id}
                </span>
              ))}
            </span>
          </div>
          <div className="hit-snip" dangerouslySetInnerHTML={snip(hits[0]!.snippet)} />
        </Link>
      ))}
    </>
  );
}
