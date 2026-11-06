import { Link, useParams } from "react-router-dom";
import { verseUrl } from "../lib";
import { useDomain } from "../wordsApi";

/** A semantic domain (Louw–Nida / SDBG for Greek, SDBH for Hebrew): every word with a sense in it. */
export function DomainPage() {
  const { id = "" } = useParams();
  const { data, isLoading, error } = useDomain(id);
  if (isLoading) return <div className="loading">Loading…</div>;
  if (error || !data) return <div className="error">Could not load the domain {id}: {String(error)}</div>;
  const hebrew = data.system === "sdbh";
  const greekEntries = data.system === "sdbg";
  return (
    <div className="page domain-page">
      <nav className="domain-crumbs" aria-label="Domain hierarchy">
        <span>{data.system_name}</span>
        {data.path.map((p) => (
          <span key={p.id}>
            › <Link to={`/domains/${p.id}`}>{p.label}</Link>
          </span>
        ))}
      </nav>
      <h1>{data.label}</h1>
      <p className="domain-sub">
        {data.words.length > 0
          ? `${data.words.length} ${hebrew ? "Hebrew" : "Greek"} word${data.words.length === 1 ? "" : "s"} with a sense in this domain`
          : "No words are assigned directly to this domain; see its subdomains."}
      </p>
      {data.children.length > 0 && (
        <ul className="domain-children">
          {data.children.map((c) => (
            <li key={c.id}>
              <Link to={`/domains/${c.id}`}>{c.label}</Link>
            </li>
          ))}
        </ul>
      )}
      {data.words.length > 0 && (
        <table className="domain-words">
          <thead>
            <tr>
              <th>Word</th>
              <th className="translit-col">Transliteration</th>
              <th>{greekEntries ? "Louw–Nida sense" : "Gloss"}</th>
              <th style={{ textAlign: "right" }} title="Uses in this domain, of all uses">Uses</th>
            </tr>
          </thead>
          <tbody>
            {data.words.map((w) => (
              <tr key={w.id}>
                <td className={`lemma-cell ${hebrew ? "hebrew" : "greek"}`} dir={hebrew ? "rtl" : undefined}>
                  {w.first ? <Link to={verseUrl(w.first, w.id)}>{w.lemma ?? w.id}</Link> : (w.lemma ?? w.id)}
                </td>
                <td className="translit translit-col">{w.translit}</td>
                <td className="senses">
                  {greekEntries
                    ? w.senses.map((s) => (
                        <div key={s.id}>
                          <span className="wd-code">LN {s.code}</span> {s.gloss}
                        </div>
                      ))
                    : w.gloss}
                </td>
                <td className="num">
                  {w.n_field.toLocaleString()}
                  {w.n > w.n_field && <span className="of"> / {w.n.toLocaleString()}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
