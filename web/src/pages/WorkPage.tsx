import { useEffect, useMemo, useRef } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMeta, useSection, useTimeline, useToc } from "../api";
import { Html } from "../components/Html";
import { Splitter } from "../components/Splitter";
import { useSettings } from "../settings";
import { WikiCard } from "../components/Wiki";
import { CATEGORY_LABELS, ERA_LABELS, formatYear, osisLabel, verseUrl } from "../lib";
import type { Book, SectionView, Toc } from "../types";

/** 'irenaeus.against-heresies@anf01' → 'Ante-Nicene Fathers vol. 1'. */
function volumeLabel(edition: string): string {
  const vol = edition.split("@")[1] ?? "";
  if (vol.startsWith("anf")) return `Ante-Nicene Fathers vol. ${Number(vol.slice(3))}`;
  if (vol.startsWith("npnf1")) return `Nicene & Post-Nicene Fathers, series 1, vol. ${Number(vol.slice(5))}`;
  if (vol.startsWith("npnf2")) return `Nicene & Post-Nicene Fathers, series 2, vol. ${Number(vol.slice(5))}`;
  if (vol.startsWith("catena")) return "Catena Aurea (tr. J. H. Newman, 1841)";
  return "";
}

export function WorkPage() {
  const { edition = "", ord = "1" } = useParams();
  const navigate = useNavigate();
  const n = Number(ord) || 1;
  const toc = useToc(edition);
  const sec = useSection(edition, n);
  const meta = useMeta();
  const { settings, update } = useSettings();
  const layout = settings.layout;
  const text = useRef<HTMLDivElement>(null);
  const activeLink = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    text.current?.scrollTo({ top: 0 });
    activeLink.current?.scrollIntoView({ block: "nearest" });
  }, [edition, n]);

  const base = `/library/${encodeURIComponent(edition)}`;
  const e = toc.data?.edition;
  return (
    <div className="work-layout" style={{ ["--toc-w" as string]: `${layout.toc}px`, ["--ctx-w" as string]: `${layout.context}px` }}>
      <nav className="toc" aria-label="Contents">
        <Link to="/library">← Library</Link>
        {toc.data && e && (
          <>
            <h3 className="toc-title">{e.title}</h3>
            <div className="toc-sub">
              {e.author ?? CATEGORY_LABELS[e.category]}
              {e.era ? ` · ${ERA_LABELS[e.era] ?? e.era}` : ""}
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

      <Splitter label="Contents width" side="left" value={layout.toc} min={180} max={520} reset={260} onChange={(toc) => update({ layout: { ...layout, toc } })} />
      <article className="work-text" ref={text}>
        <div className="work-inner">
          {sec.isLoading && <div className="loading">Loading…</div>}
          {sec.error && <div className="error">{String(sec.error)}</div>}
          {sec.data && (
            <>
              <div className="work-crumb">
                {e?.title} {sec.data.section.cite !== "1" && sec.data.section.cite}
                {volumeLabel(edition) && ` · ${volumeLabel(edition)}`}
              </div>
              <h2 className="work-section-title">{sec.data.section.title}</h2>
              <Html html={sec.data.section.html} footnotes idPrefix={`s${n}`} />
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
        </div>
      </article>

      <Splitter
        label="About panel width"
        side="right"
        value={layout.context}
        min={260}
        max={720}
        reset={360}
        onChange={(context) => update({ layout: { ...layout, context } })}
      />
      <aside className="work-context" aria-label="About this work">
        {toc.data && <Context toc={toc.data} section={sec.data} books={meta.data?.books ?? []} base={base} />}
      </aside>
    </div>
  );
}

/** Beside the text: what the work is, who wrote it, the Scripture on this page and more by the same author. */
function Context({ toc, section, books, base }: { toc: Toc; section?: SectionView; books: Book[]; base: string }) {
  const e = toc.edition;
  const timeline = useTimeline();
  const author = timeline.data?.authors.find((a) => a.id === e.author_id);
  const written = e.date_from !== null ? (e.date_from === e.date_to ? `c. ${formatYear(e.date_from)}` : `c. ${formatYear(e.date_from)}–${e.date_to}`) : null;
  const lived =
    e.author_born !== null && e.author_died !== null
      ? `${formatYear(e.author_born)}–${e.author_died}`
      : e.author_died !== null
        ? `died ${formatYear(e.author_died)}`
        : e.author_to !== null
          ? `active ${formatYear(e.author_to)}`
          : null;
  // the year is only meaningful with a named translator (CCEL volumes carry a placeholder)
  const translation = [e.translator && `tr. ${e.translator}`, e.translator && e.year && String(e.year), volumeLabel(e.id)].filter(Boolean).join(", ");
  const scripture = useMemo(() => {
    const seen = new Map<string, number>();
    for (const c of section?.citations ?? []) seen.set(c.osis, (seen.get(c.osis) ?? 0) + 1);
    return [...seen.entries()];
  }, [section]);
  const others = (author?.works ?? []).filter((w) => w.id !== e.work_id).sort((a, b) => b.citations - a.citations);

  return (
    <div className="ctx">
      <section className="ctx-block">
        <div className="about-label">About this work</div>
        <h2>{e.title}</h2>
        <div className="ctx-meta">
          {written && <span>written {written}</span>}
          <span>{CATEGORY_LABELS[e.category] ?? e.category}</span>
          {e.era && <span>{ERA_LABELS[e.era] ?? e.era}</span>}
        </div>
        {e.summary && <p className="ctx-summary">{e.summary}</p>}
        {e.attribution && <p className="ctx-summary muted">{e.attribution}</p>}
        {e.wikipedia && <WikiCard title={e.wikipedia} />}
        {translation && <p className="ctx-small">English: {translation}</p>}
        {toc.intro_ord && <Link to={`${base}/${toc.intro_ord}`}>Read the editor's introduction →</Link>}
      </section>

      {e.author && (
        <section className="ctx-block">
          <div className="about-label">The author</div>
          <h3>
            {e.author}
            {lived && <span className="muted"> · {lived}</span>}
          </h3>
          {e.author_summary && <p className="ctx-summary">{e.author_summary}</p>}
          {e.author_wikipedia && e.author_wikipedia !== e.wikipedia && <WikiCard title={e.author_wikipedia} compact />}
          {e.author_id && <Link to={`/library?view=timeline&sel=a:${e.author_id}`}>See on the timeline →</Link>}
        </section>
      )}

      {scripture.length > 0 && (
        <section className="ctx-block">
          <div className="about-label">
            Scripture on this page <span className="count">{scripture.length}</span>
          </div>
          <div className="ctx-refs">
            {scripture.map(([osis, times]) => (
              <Link key={osis} to={verseUrl(osis)} title={times > 1 ? `cited ${times} times on this page` : undefined}>
                {osisLabel(osis, books)}
                {times > 1 && <sup>×{times}</sup>}
              </Link>
            ))}
          </div>
        </section>
      )}

      {others.length > 0 && (
        <section className="ctx-block">
          <div className="about-label">
            More by {e.author} <span className="count">{others.length}</span>
          </div>
          <ul className="ctx-works">
            {others.slice(0, 12).map((w) => (
              <li key={w.id}>{w.edition_id ? <Link to={`/library/${encodeURIComponent(w.edition_id)}/1`}>{w.title}</Link> : w.title}</li>
            ))}
          </ul>
          {others.length > 12 && <Link to={`/library?view=timeline&sel=a:${e.author_id}`}>All {others.length} works →</Link>}
        </section>
      )}
    </div>
  );
}
