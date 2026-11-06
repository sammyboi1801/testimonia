import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useWorks } from "../api";
import { CATEGORY_LABELS, ERA_LABELS, formatYear, PRE_NICENE } from "../lib";
import type { WorkSummary } from "../types";

type Scope = "pre-nicene" | "all";

export function LibraryPage() {
  const { data, isLoading, error } = useWorks();
  const [scope, setScope] = useState<Scope>("pre-nicene");
  const [category, setCategory] = useState<string>("");
  const [q, setQ] = useState("");

  const groups = useMemo(() => {
    const filtered = (data ?? []).filter(
      (w) =>
        (scope === "all" || (w.era ? PRE_NICENE.has(w.era) : ["nt-apocrypha", "apostolic-father", "ot-pseudepigrapha"].includes(w.category))) &&
        (!category || w.category === category) &&
        (!q || `${w.title} ${w.author ?? ""}`.toLowerCase().includes(q.toLowerCase())),
    );
    const by = new Map<string, WorkSummary[]>();
    for (const w of filtered) {
      const key = w.author ?? CATEGORY_LABELS[w.category] ?? "Anonymous";
      by.set(key, [...(by.get(key) ?? []), w]);
    }
    return [...by.entries()];
  }, [data, scope, category, q]);

  const categories = useMemo(() => [...new Set((data ?? []).map((w) => w.category))], [data]);

  return (
    <div className="page">
      <h1>Library</h1>
      <p className="muted">
        Early Christian writings in English, with every Scripture citation linked to the Bible. Pre-Nicene writers (to AD 325)
        are shown first; switch to “All” for the later fathers, councils and the Catena Aurea.
      </p>
      <div className="filters">
        <div className="seg">
          <button className={scope === "pre-nicene" ? "on" : ""} onClick={() => setScope("pre-nicene")}>
            Pre-Nicene
          </button>
          <button className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>
            All
          </button>
        </div>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="chip">
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c] ?? c}
            </option>
          ))}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by title or author…" />
      </div>
      {isLoading && <div className="loading">Loading library…</div>}
      {error && <div className="error">{String(error)}</div>}
      {groups.length === 0 && data && <div className="empty-state">No works match these filters.</div>}
      {groups.map(([author, works]) => (
        <section key={author} className="author-group">
          <h3>
            {author}
            {works[0]?.year ? <span className="when">{formatYear(works[0].year)}</span> : null}
            {works[0]?.era ? <span className="when">{ERA_LABELS[works[0].era] ?? works[0].era}</span> : null}
          </h3>
          <ul className="work-list">
            {works.map((w) => (
              <li key={w.id}>
                {w.edition_id ? <Link to={`/library/${encodeURIComponent(w.edition_id)}/1`}>{w.title}</Link> : w.title}
                {w.citations > 0 && <span className="n">{w.citations.toLocaleString()} citations</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
