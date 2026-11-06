import { Link } from "react-router-dom";
import { GOSPELS, parallelUrl, useParallels } from "../readingApi";

/** A quiet row of links to the reading aids (topics, plans, Gospel parallels). */
export function ReadingLinks({ className = "" }: { className?: string }) {
  return (
    <nav className={`rd-links ${className}`} aria-label="Reading aids">
      <Link to="/topics">Topics</Link>
      <Link to="/plans">Reading plans</Link>
      <Link to="/parallels">Gospel parallels</Link>
    </nav>
  );
}

/** For a verse in the Gospels: the synopsis sections it belongs to, with the parallel passages. */
export function GospelParallels({ osis }: { osis: string }) {
  const book = osis.split(".")[0];
  const inGospels = GOSPELS.some((g) => g.osis === book);
  const { data } = useParallels(osis, inGospels);
  if (!inGospels || !data?.sections.length) return null;
  return (
    <section className="block rd-in-panel">
      <h3>
        Parallels in other Gospels <span className="count">{data.sections.length}</span>
      </h3>
      {data.sections.map((s) => {
        const others = GOSPELS.filter((g) => g.osis !== book).flatMap((g) => (s.passages[g.osis] ?? []).map((p) => p.label));
        return (
          <div key={s.id} className="item">
            <Link to={parallelUrl(s.id)} className="who">
              {s.title}
            </Link>
            {others.length > 0 && <div className="muted small">{others.join(" · ")}</div>}
          </div>
        );
      })}
    </section>
  );
}
