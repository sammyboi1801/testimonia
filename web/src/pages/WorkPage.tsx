import { useEffect, useRef } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useSection, useToc } from "../api";
import { Html } from "../components/Html";
import { CATEGORY_LABELS, ERA_LABELS } from "../lib";

/** 'irenaeus.against-heresies@anf01' → 'Ante-Nicene Fathers vol. 1'. */
function volumeLabel(edition: string): string {
  const vol = edition.split("@")[1] ?? "";
  if (vol.startsWith("anf")) return `Ante-Nicene Fathers vol. ${Number(vol.slice(3))}`;
  if (vol.startsWith("npnf1")) return `Nicene & Post-Nicene Fathers, series 1, vol. ${Number(vol.slice(5))}`;
  if (vol.startsWith("npnf2")) return `Nicene & Post-Nicene Fathers, series 2, vol. ${Number(vol.slice(5))}`;
  if (vol.startsWith("catena")) return "Catena Aurea (tr. J. H. Newman, 1841)";
  return vol;
}

export function WorkPage() {
  const { edition = "", ord = "1" } = useParams();
  const navigate = useNavigate();
  const n = Number(ord) || 1;
  const toc = useToc(edition);
  const sec = useSection(edition, n);
  const text = useRef<HTMLDivElement>(null);
  const activeLink = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    text.current?.scrollTo({ top: 0 });
    activeLink.current?.scrollIntoView({ block: "nearest" });
  }, [edition, n]);

  const base = `/library/${encodeURIComponent(edition)}`;
  return (
    <div className="work-layout">
      <nav className="toc" aria-label="Contents">
        <Link to="/library">← Library</Link>
        {toc.data && (
          <>
            <h3 style={{ fontFamily: "var(--font-display)", margin: "12px 6px 2px" }}>{toc.data.edition.title}</h3>
            <div className="muted" style={{ margin: "0 6px 10px" }}>
              {toc.data.edition.author ?? CATEGORY_LABELS[toc.data.edition.category]}
              {toc.data.edition.era ? ` · ${ERA_LABELS[toc.data.edition.era] ?? toc.data.edition.era}` : ""}
            </div>
            {toc.data.sections.map((s) => (
              <Link
                key={s.ord}
                to={`${base}/${s.ord}`}
                className={s.ord === n ? "active" : ""}
                ref={s.ord === n ? activeLink : undefined}
                style={{ paddingLeft: 6 + (s.level - 1) * 10 }}
              >
                {s.title || s.cite}
              </Link>
            ))}
          </>
        )}
      </nav>
      <article className="work-text" ref={text}>
        {sec.isLoading && <div className="loading">Loading…</div>}
        {sec.error && <div className="error">{String(sec.error)}</div>}
        {sec.data && (
          <>
            <div className="muted" style={{ fontSize: 13 }}>
              {toc.data?.edition.title} {sec.data.section.cite} · {volumeLabel(edition)}
            </div>
            <h2 style={{ fontFamily: "var(--font-display)", marginTop: 4 }}>{sec.data.section.title}</h2>
            <Html html={sec.data.section.html} footnotes idPrefix={`s${n}`} />
            {sec.data.citations.length > 0 && (
              <p className="muted" style={{ fontSize: 13 }}>
                Scripture cited here: {sec.data.citations.length}
              </p>
            )}
            <div className="pager">
              <button className="chip" disabled={!sec.data.prev} onClick={() => sec.data.prev && navigate(`${base}/${sec.data.prev}`)}>
                ‹ Previous
              </button>
              <button className="chip" disabled={!sec.data.next} onClick={() => sec.data.next && navigate(`${base}/${sec.data.next}`)}>
                Next ›
              </button>
            </div>
          </>
        )}
      </article>
    </div>
  );
}
