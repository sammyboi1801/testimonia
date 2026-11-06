import DOMPurify from "dompurify";
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMeta, useSearch } from "../api";
import { osisLabel, verseUrl } from "../lib";

const snip = (html: string) => ({ __html: DOMPurify.sanitize(html, { ALLOWED_TAGS: ["mark"] }) });

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [text, setText] = useState(q);
  const { data, isFetching, error } = useSearch(q);
  const books = useMeta().data?.books ?? [];

  function submit(e: FormEvent) {
    e.preventDefault();
    setParams({ q: text.trim() });
  }

  return (
    <div className="page">
      <h1>Search</h1>
      <form onSubmit={submit} className="filters">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Words in any translation, the fathers, or the lexicons…" autoFocus />
        <button className="chip" type="submit">
          Search
        </button>
        {isFetching && <span className="muted">Searching…</span>}
      </form>
      {error && <div className="error">{String(error)}</div>}
      {data?.reference && (
        <p>
          Go to <Link to={verseUrl(data.reference.osis)}>{data.reference.label}</Link>
        </p>
      )}
      {data && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)", gap: 32 }}>
          <section>
            <h3>Bible ({data.bible?.length ?? 0})</h3>
            {data.bible?.map((r) => (
              <div key={`${r.edition_id}-${r.vkey}`} className="result">
                <div className="meta">
                  <Link to={verseUrl(r.osis)}>{osisLabel(r.osis, books)}</Link> · {r.abbrev ?? r.edition_id}
                </div>
                <div className="snip" dangerouslySetInnerHTML={snip(r.snippet)} />
              </div>
            ))}
          </section>
          <section>
            <h3>Early Christian writings ({data.works?.length ?? 0})</h3>
            {data.works?.map((r) => (
              <div key={`${r.edition_id}-${r.ord}`} className="result">
                <div className="meta">
                  {r.author ?? "Anonymous"} ·{" "}
                  <Link to={`/library/${encodeURIComponent(r.edition_id)}/${r.ord}`}>
                    {r.work_title} {r.cite}
                  </Link>
                </div>
                <div className="snip" dangerouslySetInnerHTML={snip(r.snippet)} />
              </div>
            ))}
            <h3>Lexicon ({data.lexicon?.length ?? 0})</h3>
            {data.lexicon?.map((l) => (
              <div key={l.id} className="result">
                <span className={l.id.startsWith("H") ? "hebrew" : "greek"} style={{ fontSize: 18 }}>
                  {l.lemma}
                </span>{" "}
                <span className="muted">
                  {l.translit} · {l.id}
                </span>{" "}
                — {l.gloss}
              </div>
            ))}
          </section>
        </div>
      )}
      {!q && <div className="empty-state">Type a word or phrase. Greek and Hebrew work without accents or vowel points (λογος, בראשית).</div>}
    </div>
  );
}
