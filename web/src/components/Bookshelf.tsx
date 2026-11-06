import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTimeline, useWiki, useWorks } from "../api";
import { CATEGORY_LABELS, formatYear, OUTSIDE } from "../lib";
import type { TimelineAuthor, WorkSummary } from "../types";
import { AuthorDetail } from "./Timeline";

type Scope = "pre-nicene" | "all" | "outside";

const SCOPES: { id: Scope; label: string }[] = [
  { id: "pre-nicene", label: "Before Nicaea" },
  { id: "all", label: "All" },
  { id: "outside", label: "Jewish & Roman writers" },
];

const ERAS: { id: string; title: string; note: string; preNicene: boolean }[] = [
  { id: "apostolic", title: "The apostolic age", note: "to AD 150 — the apostles' generation and those who knew them", preNicene: true },
  { id: "ante-nicene", title: "Before Nicaea", note: "AD 150–325 — apologists, martyrs and the first theologians", preNicene: true },
  { id: "nicene", title: "Nicene & post-Nicene", note: "AD 325–451 — the great councils and the golden age of the fathers", preNicene: false },
  { id: "late-patristic", title: "Late patristic", note: "AD 451–750", preNicene: false },
  { id: "medieval", title: "Medieval", note: "after 750", preNicene: false },
];

const SHELVES: { category: string; title: string; note: string; preNicene: boolean }[] = [
  { category: "apostolic-father", title: "Apostolic Fathers (anonymous)", note: "The Didache and Second Clement", preNicene: true },
  { category: "nt-apocrypha", title: "New Testament Apocrypha", note: "Gospels, acts and apocalypses outside the canon", preNicene: true },
  { category: "ot-pseudepigrapha", title: "Old Testament Pseudepigrapha", note: "Testaments and apocalypses ascribed to biblical figures", preNicene: true },
  { category: "church-father", title: "Anonymous & early Syriac writings", note: "Martyr acts, early bishops, the Syriac documents", preNicene: true },
  { category: "liturgical", title: "Liturgies & church orders", note: "Apostolic Constitutions and early liturgies", preNicene: false },
  { category: "council", title: "Councils & canons", note: "The seven ecumenical councils and their canons", preNicene: false },
];

function lived(a: TimelineAuthor): string {
  const c = (aspect: string) => (a.circa.includes(aspect) ? "c. " : "");
  if (a.born !== null && a.died !== null) return `${c("birth")}${formatYear(a.born)} – ${c("death")}${a.died}`;
  if (a.died !== null) return `died ${c("death")}${formatYear(a.died)}`;
  return `active ${c("floruit")}${formatYear(a.floruit_to ?? a.floruit_from)}`;
}

export function Bookshelf() {
  const timeline = useTimeline();
  const works = useWorks();
  const [scope, setScope] = useState<Scope>("pre-nicene");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<{ kind: "author"; a: TimelineAuthor } | { kind: "shelf"; title: string; works: WorkSummary[] } | null>(null);

  const query = q.trim().toLowerCase();
  const matches = (text: string) => !query || text.toLowerCase().includes(query);

  const sections = useMemo(() => {
    const authors = (timeline.data?.authors ?? []).filter((a) => {
      const outside = a.tradition === "jewish" || a.tradition === "pagan";
      if (scope === "outside" && !outside) return false;
      if (scope === "pre-nicene" && !ERAS.find((e) => e.id === a.era)?.preNicene) return false;
      return matches(a.name) || a.works.some((w) => matches(w.title));
    });
    return ERAS.map((era) => ({ ...era, authors: authors.filter((a) => a.era === era.id) })).filter((s) => s.authors.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline.data, scope, query]);

  const shelves = useMemo(() => {
    if (scope === "outside") return [];
    const anonymous = (works.data ?? []).filter((w) => !w.author_id && !OUTSIDE.has(w.category));
    return SHELVES.filter((s) => scope === "all" || s.preNicene)
      .map((s) => ({ ...s, works: anonymous.filter((w) => w.category === s.category && matches(w.title)) }))
      .filter((s) => s.works.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [works.data, scope, query]);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  if (timeline.isLoading || works.isLoading) return <div className="loading">Loading the library…</div>;
  if (timeline.error || works.error) return <div className="error">{String(timeline.error ?? works.error)}</div>;

  return (
    <>
      <div className="shelf-filters">
        <div className="seg">
          {SCOPES.map((s) => (
            <button key={s.id} className={scope === s.id ? "on" : ""} onClick={() => setScope(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
        <input className="shelf-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an author or a book…" aria-label="Find an author or a book" />
      </div>

      {sections.length === 0 && shelves.length === 0 && <div className="empty-state">Nothing on the shelves matches “{q}”.</div>}

      {sections.map((s) => (
        <section key={s.id} className="shelf">
          <header className="shelf-head">
            <h2>{s.title}</h2>
            <span>{s.note}</span>
          </header>
          <div className="shelf-grid">
            {s.authors.map((a) => (
              <AuthorCard key={a.id} a={a} query={query} onOpen={() => setOpen({ kind: "author", a })} />
            ))}
          </div>
        </section>
      ))}

      {shelves.length > 0 && (
        <section className="shelf">
          <header className="shelf-head">
            <h2>Anonymous writings</h2>
            <span>works without a named author, gathered by kind</span>
          </header>
          <div className="shelf-grid">
            {shelves.map((s) => (
              <ShelfCard key={s.category} title={s.title} note={s.note} works={s.works} onOpen={() => setOpen({ kind: "shelf", title: s.title, works: s.works })} />
            ))}
          </div>
        </section>
      )}

      {open && (
        <div className="shelf-layer" onMouseDown={(e) => e.target === e.currentTarget && setOpen(null)}>
          <aside className="shelf-drawer" role="dialog" aria-modal="true">
            <button className="icon-btn tl-close" onClick={() => setOpen(null)} aria-label="Close">
              ✕
            </button>
            {open.kind === "author" ? (
              <AuthorDetail a={open.a} />
            ) : (
              <>
                <h2>{open.title}</h2>
                <ul className="tl-works">
                  {[...open.works]
                    .sort((x, y) => (x.date_from ?? 9999) - (y.date_from ?? 9999) || x.title.localeCompare(y.title))
                    .map((w) => (
                      <li key={w.id}>
                        {w.edition_id ? <Link to={`/library/${encodeURIComponent(w.edition_id)}/1`}>{w.title}</Link> : w.title}
                        {w.date_from !== null && <span className="muted small"> · c. {formatYear(w.date_from)}</span>}
                      </li>
                    ))}
                </ul>
              </>
            )}
          </aside>
        </div>
      )}
    </>
  );
}

/** Loads the Wikipedia portrait only once the card scrolls into view. */
function Portrait({ title, name }: { title: string | null; name: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setSeen(true), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  const wiki = useWiki(title, seen);
  const src = wiki.data?.thumbnail?.source;
  const initials = name
    .replace(/\(.*?\)/g, "")
    .split(/\s+/)
    .filter((w) => /^[A-Z]/.test(w) && !["Of", "The"].includes(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join("");
  return (
    <div className="card-portrait" ref={ref}>
      {src ? <img src={src} alt="" loading="lazy" /> : <span>{initials}</span>}
    </div>
  );
}

function AuthorCard({ a, query, onOpen }: { a: TimelineAuthor; query: string; onOpen: () => void }) {
  const byWeight = [...a.works].sort((x, y) => y.citations - x.citations || x.title.localeCompare(y.title));
  const hits = query ? byWeight.filter((w) => w.title.toLowerCase().includes(query)) : [];
  const shown = (hits.length ? hits : byWeight).slice(0, 3);
  const more = a.works.length - shown.length;
  const tag = a.tradition === "jewish" ? "Jewish" : a.tradition === "pagan" ? "Greek & Roman" : null;
  return (
    <article className={`author-card trad-${a.tradition ?? "x"}`}>
      <button className="card-hit" onClick={onOpen} aria-label={`About ${a.name}`} />
      <div className="card-top">
        <Portrait title={a.wikipedia} name={a.name} />
        <div>
          <h3>{a.name}</h3>
          <div className="card-dates">
            {lived(a)}
            {tag && <span className="card-tag">{tag}</span>}
          </div>
        </div>
      </div>
      {a.summary && <p className="card-summary">{a.summary}</p>}
      <ul className="card-works">
        {shown.map((w) => (
          <li key={w.id}>
            {w.edition_id ? <Link to={`/library/${encodeURIComponent(w.edition_id)}/1`}>{w.title}</Link> : w.title}
          </li>
        ))}
      </ul>
      <div className="card-foot">
        {more > 0 ? (
          <button className="link-btn" onClick={onOpen}>
            + {more} more work{more === 1 ? "" : "s"}
          </button>
        ) : (
          <span />
        )}
        <button className="link-btn" onClick={onOpen}>
          About →
        </button>
      </div>
    </article>
  );
}

function ShelfCard({ title, note, works, onOpen }: { title: string; note: string; works: WorkSummary[]; onOpen: () => void }) {
  const shown = [...works].sort((x, y) => y.citations - x.citations).slice(0, 4);
  return (
    <article className="author-card shelf-card">
      <button className="card-hit" onClick={onOpen} aria-label={`Open ${title}`} />
      <div className="card-top">
        <div className="card-portrait book">
          <span>{works.length}</span>
        </div>
        <div>
          <h3>{title}</h3>
          <div className="card-dates">{note}</div>
        </div>
      </div>
      <ul className="card-works">
        {shown.map((w) => (
          <li key={w.id}>
            {w.edition_id ? <Link to={`/library/${encodeURIComponent(w.edition_id)}/1`}>{w.title}</Link> : w.title}
          </li>
        ))}
      </ul>
      <div className="card-foot">
        {works.length > shown.length ? (
          <button className="link-btn" onClick={onOpen}>
            + {works.length - shown.length} more
          </button>
        ) : (
          <span />
        )}
        <span className="muted small">{CATEGORY_LABELS[works[0]?.category ?? ""] ?? ""}</span>
      </div>
    </article>
  );
}
