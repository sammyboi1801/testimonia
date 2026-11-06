import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTimeline, useWorks } from "../api";
import { TimelineView } from "../components/Timeline";
import { WikiHover } from "../components/Wiki";
import { CATEGORY_LABELS, ERA_LABELS, formatYear, OUTSIDE, PRE_NICENE } from "../lib";
import type { WorkSummary } from "../types";

type Scope = "pre-nicene" | "all" | "outside";

const SCOPES: { id: Scope; label: string }[] = [
  { id: "pre-nicene", label: "Pre-Nicene" },
  { id: "all", label: "All" },
  { id: "outside", label: "Jewish & Roman writers" },
];

export function LibraryPage() {
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "timeline" ? "timeline" : "list";
  const setView = (v: "list" | "timeline") =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (v === "list") n.delete("view");
        else n.set("view", v);
        return n;
      },
      { replace: true },
    );

  return (
    <div className={view === "timeline" ? "page page-wide" : "page"}>
      <div className="library-head">
        <h1>Library</h1>
        <div className="seg view-switch" role="tablist" aria-label="View">
          <button className={view === "list" ? "on" : ""} onClick={() => setView("list")}>
            List
          </button>
          <button className={view === "timeline" ? "on" : ""} onClick={() => setView("timeline")}>
            Timeline
          </button>
        </div>
      </div>
      {view === "timeline" ? <TimelineView /> : <LibraryList />}
    </div>
  );
}

function LibraryList() {
  const { data, isLoading, error } = useWorks();
  const timeline = useTimeline(); // author Wikipedia titles and life dates for the headings
  const [scope, setScope] = useState<Scope>("pre-nicene");
  const [category, setCategory] = useState<string>("");
  const [q, setQ] = useState("");
  const authors = useMemo(() => new Map((timeline.data?.authors ?? []).map((a) => [a.id, a])), [timeline.data]);

  const groups = useMemo(() => {
    const filtered = (data ?? []).filter(
      (w) =>
        (scope === "all" ||
          (scope === "outside" ? OUTSIDE.has(w.category) : w.era ? PRE_NICENE.has(w.era) : ["nt-apocrypha", "apostolic-father", "ot-pseudepigrapha"].includes(w.category))) &&
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
    <>
      <p className="muted">
        Early Christian writings in English, with every Scripture citation linked to the Bible — and the Jewish and Roman writers who
        mention Jesus and the first Christians. Rest on an author's name for a short introduction from Wikipedia.
      </p>
      <div className="filters">
        <div className="seg">
          {SCOPES.map((s) => (
            <button key={s.id} className={scope === s.id ? "on" : ""} onClick={() => setScope(s.id)}>
              {s.label}
            </button>
          ))}
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
      {groups.map(([author, works]) => {
        const a = works[0]?.author_id ? authors.get(works[0].author_id) : undefined;
        const lived = a ? (a.born !== null && a.died !== null ? `${formatYear(a.born)}–${a.died}` : a.died !== null ? `died ${formatYear(a.died)}` : null) : null;
        return (
          <section key={author} className="author-group">
            <h3>
              <WikiHover title={a?.wikipedia}>{author}</WikiHover>
              {lived ? <span className="when">{lived}</span> : works[0]?.year ? <span className="when">{formatYear(works[0].year)}</span> : null}
              {works[0]?.era ? <span className="when">{ERA_LABELS[works[0].era] ?? works[0].era}</span> : null}
            </h3>
            {a?.summary && <p className="author-summary">{a.summary}</p>}
            <ul className="work-list">
              {works.map((w) => (
                <li key={w.id}>
                  {w.edition_id ? <Link to={`/library/${encodeURIComponent(w.edition_id)}/1`}>{w.title}</Link> : w.title}
                  {w.citations > 0 && <span className="n">{w.citations.toLocaleString()} citations</span>}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
