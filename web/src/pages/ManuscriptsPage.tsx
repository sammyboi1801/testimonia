import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Siglum } from "../components/Manuscripts";
import { KINDS, KIND_OF, manuscriptUrl, msDate, useManuscripts, type ManuscriptSummary } from "../manuscriptsApi";

type Sort = "date" | "siglum";
const PAGE = 120;

/** Natural order of sigla: P1 < P2 < P10, 01 < 02 < 046, 1QIsaᵃ < 4QGen. */
function siglumKey(m: ManuscriptSummary): string {
  const s = (m.sigla ?? m.id).replace(/^GA:/, "");
  return s.replace(/\d+/g, (d) => d.padStart(5, "0"));
}

/** A name that says more than the siglum ('Codex Sinaiticus', 'Great Isaiah Scroll'; not 'Papyrus 52'). */
function telling(m: ManuscriptSummary): boolean {
  return !!m.name && m.name !== m.sigla && !/^(Papyrus|Uncial|Minuscule|Rahlfs) \S+$/.test(m.name);
}

function matches(m: ManuscriptSummary, q: string): boolean {
  if (!q) return true;
  const hay = [m.sigla, m.id, m.name, m.contents, m.institution, m.city, m.country, m.date_label, m.script]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");
  return q
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/𝔓/g, "p")
    .split(/\s+/)
    .every((w) => hay.includes(w));
}

/** Browse the manuscripts: papyri, majuscules, minuscules, the Septuagint and the Dead Sea Scrolls. */
export function ManuscriptsPage() {
  const { data, isLoading, error } = useManuscripts();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const kind = params.get("kind") ?? "";
  const sort: Sort = params.get("sort") === "siglum" ? "siglum" : "date";
  const [q, setQ] = useState(params.get("q") ?? "");
  const [shown, setShown] = useState(PAGE);
  const set = (key: string, value: string) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (value) n.set(key, value);
        else n.delete(key);
        return n;
      },
      { replace: true },
    );

  const collection = KINDS.find((k) => k.id === kind)?.collection;
  const list = useMemo(() => {
    const rows = (data?.manuscripts ?? []).filter((m) => (!collection || m.collection === collection) && matches(m, q.trim()));
    if (sort === "siglum") return [...rows].sort((a, b) => a.collection.localeCompare(b.collection) || siglumKey(a).localeCompare(siglumKey(b)));
    return rows; // the API returns them earliest first
  }, [data, collection, q, sort]);
  const counts = useMemo(() => Object.fromEntries((data?.collections ?? []).map((c) => [c.collection, c.n])), [data]);
  const total = data?.manuscripts.length ?? 0;
  const inKind = collection ? (counts[collection] ?? 0) : total; // what the count line compares against

  return (
    <div className="page ms-page">
      <Link to="/library" className="book-back">
        ← Library
      </Link>
      <header className="ms-head">
        <h1>Manuscripts</h1>
        <p className="ms-intro">
          The copies behind the text: New Testament papyri and codices, the Greek Old Testament, and the scrolls from the Judaean Desert — when they were
          written, what they contain and where they are kept.
        </p>
      </header>

      <div className="ms-controls">
        <div className="seg ms-kinds" role="tablist" aria-label="Kind of manuscript">
          <button className={!kind ? "on" : ""} onClick={() => set("kind", "")}>
            All <span className="ms-n">{total}</span>
          </button>
          {KINDS.map((k) => (
            <button key={k.id} className={kind === k.id ? "on" : ""} title={k.hint} onClick={() => set("kind", k.id)}>
              {k.label} <span className="ms-n">{counts[k.collection] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="ms-tools">
          <input
            type="search"
            className="ms-search"
            placeholder="Search: P66, Sinaiticus, Isaiah, Dublin…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setShown(PAGE);
              set("q", e.target.value);
            }}
            aria-label="Search manuscripts"
          />
          <label className="ms-sort">
            <span className="muted">Order</span>
            <select value={sort} onChange={(e) => set("sort", e.target.value === "siglum" ? "siglum" : "")}>
              <option value="date">Earliest first</option>
              <option value="siglum">By number</option>
            </select>
          </label>
        </div>
      </div>

      {isLoading && <div className="loading">Loading…</div>}
      {error && <div className="error">Could not load the manuscripts: {String(error)}</div>}
      {data && (
        <>
          <div className="ms-count muted">
            {list.length === inKind ? `${inKind.toLocaleString()} manuscripts` : `${list.length.toLocaleString()} of ${inKind.toLocaleString()}`}
          </div>
          <ol className="ms-list">
            {list.slice(0, shown).map((m) => (
              <li key={m.id} className="ms-row" onClick={() => navigate(manuscriptUrl(m.id))}>
                <Link to={manuscriptUrl(m.id)} className="ms-row-sig" onClick={(e) => e.stopPropagation()}>
                  <Siglum m={m} />
                </Link>
                <div className="ms-row-main">
                  <div className="ms-row-name">
                    {telling(m) ? <span className="ms-row-title">{m.name}</span> : <span className="ms-row-generic">{m.contents || KIND_OF[m.collection]}</span>}
                    {!kind && <span className="ms-kind">{KIND_OF[m.collection]}</span>}
                  </div>
                  {telling(m) && m.contents && <div className="ms-row-contents">{m.contents}</div>}
                </div>
                <div className="ms-row-date">{msDate(m)}</div>
                <div className="ms-row-place">{[m.institution, m.city].filter(Boolean).join(", ")}</div>
              </li>
            ))}
          </ol>
          {list.length > shown && (
            <button className="more" onClick={() => setShown(shown + PAGE * 2)}>
              Show more ({(list.length - shown).toLocaleString()})
            </button>
          )}
          {list.length === 0 && <p className="muted">No manuscripts match “{q}”.</p>}
          <p className="ms-credit muted">
            Catalogue from Wikipedia’s lists of New Testament papyri, uncials and minuscules, Septuagint manuscripts and Dead Sea Scrolls (CC BY-SA 4.0). Dates
            are scholarly estimates, mostly palaeographic.
          </p>
        </>
      )}
    </div>
  );
}
