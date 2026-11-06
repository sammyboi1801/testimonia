import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { NtvmrNote, Siglum } from "../components/Manuscripts";
import { WikiCard, wikiUrl } from "../components/Wiki";
import { formatYear, verseUrl } from "../lib";
import { KINDS, KIND_OF, msDate, useManuscript, type ManuscriptDetail } from "../manuscriptsApi";

const LANGUAGE: Record<string, string> = { grc: "Greek", hbo: "Hebrew", arc: "Aramaic", lat: "Latin", nbat: "Nabataean" };

function windowLabel(d: ManuscriptDetail["dating"][number]): string {
  if (d.start_year == null) return "";
  if (d.end_year == null || d.end_year === d.start_year) return `${d.circa ? "c. " : ""}${formatYear(d.start_year)}`;
  return `between ${formatYear(d.start_year)} and ${formatYear(d.end_year)}`;
}

/** One manuscript: date, contents (linked into the reader), where it is kept, and where to see it. */
export function ManuscriptPage() {
  const { id = "" } = useParams();
  const { data, isLoading, error } = useManuscript(id);
  if (isLoading) return <div className="loading">Loading…</div>;
  if (error || !data) return <div className="error">Could not load manuscript {id}: {String(error)}</div>;
  const m = data.manuscript;
  const kind = KINDS.find((k) => k.collection === m.collection);
  const facts = [
    msDate(m),
    m.language && (LANGUAGE[m.language] ?? m.language),
    m.material,
    m.format,
    m.script,
  ].filter(Boolean) as string[];
  const place = [m.city, m.country].filter(Boolean).join(", ");

  return (
    <div className="page ms-page ms-detail">
      <Link to={kind ? `/manuscripts?kind=${kind.id}` : "/manuscripts"} className="book-back">
        ← {kind ? kind.label : "Manuscripts"}
      </Link>
      <header className="book-hero ms-hero">
        <div>
          <div className="about-label">{KIND_OF[m.collection] ?? m.collection}</div>
          <h1>
            <Siglum m={m} />
            {m.name && m.name !== m.sigla && <span className="ms-hero-name">{m.name}</span>}
          </h1>
          <div className="ctx-meta">
            {facts.map((f) => (
              <span key={f}>{f}</span>
            ))}
          </div>
          {m.description && <p className="ms-desc">{m.description}</p>}
          <Links data={data} />
        </div>
        {data.wikipedia && <WikiCard title={data.wikipedia} />}
      </header>

      <div className="bk-layout">
        <section className="book-col">
          <h2>Contents</h2>
          {m.contents && !onlyReferences(m.contents, data.passages) && <p className="ms-contents">{m.contents}</p>}
          <Passages passages={data.passages} />
        </section>
        <aside className="book-col side">
          <section className="block">
            <h3>Date</h3>
            {data.dating.length === 0 && <p className="muted">{m.date_label || "Not dated in the list."}</p>}
            {data.dating.map((d, i) => (
              <div key={i} className="ms-fact">
                <div>{windowLabel(d)}</div>
                <div className="muted small">
                  {d.label && d.label !== windowLabel(d) && <>as listed: “{d.label}” · </>}
                  {d.basis ?? "estimate"}
                  {d.system && <> · {d.system.toLowerCase()}</>}
                </div>
              </div>
            ))}
          </section>
          {(m.institution || place || m.shelfmark) && (
            <section className="block">
              <h3>Where it is kept</h3>
              {m.institution && <div className="ms-fact">{m.institution}</div>}
              {place && <div className="ms-fact muted">{place}</div>}
              {m.shelfmark && <div className="ms-fact small">Shelfmark: {m.shelfmark}</div>}
            </section>
          )}
          {m.discovered && (
            <section className="block">
              <h3>Found</h3>
              <div className="ms-fact">{m.discovered}</div>
            </section>
          )}
          {(data.ids.ga || data.ids.rahlfs || data.ids.dss) && (
            <section className="block">
              <h3>Numbers</h3>
              {data.ids.ga && <div className="ms-fact small">Gregory–Aland {data.ids.ga.join(", ")}</div>}
              {data.ids.rahlfs && <div className="ms-fact small">Rahlfs {data.ids.rahlfs.join(", ")}</div>}
              {data.ids.dss && <div className="ms-fact small">{data.ids.dss.join(", ")}</div>}
            </section>
          )}
          <p className="ms-credit muted small">
            Catalogue entry from{" "}
            {data.wikipedia ? (
              <a href={wikiUrl(data.wikipedia)} target="_blank" rel="noreferrer">
                Wikipedia
              </a>
            ) : (
              "Wikipedia"
            )}
            ’s lists ({licence(m.license)}).
          </p>
        </aside>
      </div>
    </div>
  );
}

/** 'CC-BY-SA-4.0' → 'CC BY-SA 4.0'. */
function licence(id: string | null): string {
  return (id ?? "CC-BY-SA-4.0").replace(/^CC-/, "CC ").replace(/-(\d)/, " $1");
}

/** True when the contents text is just the passages listed below it ('John 18:31-33, 18:37-38'). */
function onlyReferences(contents: string, passages: ManuscriptDetail["passages"]): boolean {
  if (passages.length === 0) return false;
  const known = new Set([...passages.flatMap((p) => p.label.match(/[A-Za-z]+/g) ?? []), "end"]);
  // single letters are half verses ('5:3a', '6:35b'), not words
  return (contents.match(/[A-Za-z]{2,}/g) ?? []).every((w) => known.has(w));
}

function Links({ data }: { data: ManuscriptDetail }) {
  const m = data.manuscript;
  const links: { href: string; label: string }[] = [];
  let note: ReactNode = null;
  if (data.ntvmr) {
    links.push({ href: data.ntvmr.images, label: "View images (NTVMR)" });
    links.push({ href: data.ntvmr.catalogue, label: "INTF catalogue entry" });
    note = <NtvmrNote />;
  }
  if (m.image_url) {
    links.push({ href: m.image_url, label: "View images (Leon Levy DSS Library)" });
    note = <span className="ms-note">images © Israel Antiquities Authority, on the Leon Levy library</span>;
  }
  if (links.length === 0) return null;
  return (
    <div className="ms-links">
      <div className="ms-links-row">
        {links.map((l) => (
          <a key={l.href} href={l.href} target="_blank" rel="noreferrer">
            {l.label} ↗
          </a>
        ))}
      </div>
      {note}
    </div>
  );
}

function Passages({ passages }: { passages: ManuscriptDetail["passages"] }) {
  const [all, setAll] = useState(false);
  if (passages.length === 0) return <p className="muted">The list gives no passages that can be linked.</p>;
  const both = passages.some((p) => p.testament === "OT") && passages.some((p) => p.testament === "NT");
  const limit = 60;
  const visible = all ? passages : passages.slice(0, limit);
  const groups = both ? (["OT", "NT"] as const) : ([null] as const);
  return (
    <>
      {groups.map((t) => {
        const rows = visible.filter((p) => t === null || p.testament === t);
        if (rows.length === 0) return null;
        return (
          <div key={t ?? "all"}>
            {t && <h3 className="ms-testament">{t === "OT" ? "Old Testament" : "New Testament"}</h3>}
            <ul className="ms-passages">
              {rows.map((p) => (
                <li key={p.osis + p.label}>
                  <Link to={verseUrl(p.osis)}>{p.label}</Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {passages.length > limit && !all && (
        <button className="more" onClick={() => setAll(true)}>
          Show all {passages.length} passages
        </button>
      )}
    </>
  );
}
