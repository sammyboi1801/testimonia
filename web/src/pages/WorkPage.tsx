import { useEffect, useMemo, useRef, useState } from "react";
import { useBackClose } from "../backClose";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMeta, useSection, useTimeline, useToc } from "../api";
import { Html } from "../components/Html";
import { Splitter } from "../components/Splitter";
import { useSettings } from "../settings";
import { WikiCard, WikiHover } from "../components/Wiki";
import { CATEGORY_LABELS, ERA_LABELS, formatYear, osisLabel, verseUrl } from "../lib";
import type { Book, SectionView, Toc } from "../types";

/** The CCEL book a text comes from ('…@anf01' → 'schaff/anf01'), for the credit line; null if not from CCEL. */
function ccelVolume(edition: string): string | null {
  const vol = edition.split("@")[1] ?? "";
  if (/^(anf|npnf)\d+$/.test(vol)) return `schaff/${vol}`;
  if (/^catena\d+$/.test(vol)) return `aquinas/${vol}`;
  return null;
}

/** 'irenaeus.against-heresies@anf01' → 'Ante-Nicene Fathers vol. 1'. */
function volumeLabel(edition: string): string {
  const vol = edition.split("@")[1] ?? "";
  if (vol.startsWith("anf")) return `Ante-Nicene Fathers vol. ${Number(vol.slice(3))}`;
  if (vol.startsWith("npnf1")) return `Nicene & Post-Nicene Fathers, series 1, vol. ${Number(vol.slice(5))}`;
  if (vol.startsWith("npnf2")) return `Nicene & Post-Nicene Fathers, series 2, vol. ${Number(vol.slice(5))}`;
  if (vol.startsWith("catena")) return "Catena Aurea (tr. J. H. Newman, 1841)";
  return "";
}

/** The source text often opens with the section's own title, already shown above it: drop that repeat. */
function withoutRepeatedTitle(html: string, title: string | null | undefined): string {
  if (!title) return html;
  const flat = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&[a-z#0-9]+;/gi, " ").replace(/[\s.]+/g, " ").trim().toLowerCase();
  const m = /^\s*(?:<div[^>]*>\s*)?<(h[1-6]|p)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(html);
  if (m && flat(m[2]!) === flat(title)) return html.replace(m[0].replace(/^\s*(?:<div[^>]*>\s*)?/, ""), "");
  return html;
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
  const [sheet, setSheet] = useState<"toc" | "about" | null>(null);
  useBackClose(sheet !== null, () => setSheet(null));
  const [find, setFind] = useState("");
  const swipe = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    text.current?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
    setFind("");
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
      <article
        className="work-text"
        ref={text}
        onTouchStart={(ev) => {
          const t = ev.touches[0]!;
          swipe.current = { x: t.clientX, y: t.clientY };
        }}
        onTouchEnd={(ev) => {
          const from = swipe.current;
          swipe.current = null;
          if (!from || !sec.data || window.innerWidth > 760 || window.getSelection()?.isCollapsed === false) return;
          const t = ev.changedTouches[0]!;
          const dx = t.clientX - from.x;
          if (Math.abs(dx) < 80 || Math.abs(dx) < 2 * Math.abs(t.clientY - from.y)) return; // a deliberate sideways swipe
          const to = dx < 0 ? sec.data.next : sec.data.prev;
          if (to) navigate(`${base}/${to}`);
        }}
      >
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
              {ccelVolume(edition) && (
                <p className="work-credit">
                  Text from the{" "}
                  <a href={`https://www.ccel.org/ccel/${ccelVolume(edition)}`} target="_blank" rel="noreferrer">
                    Christian Classics Ethereal Library
                  </a>{" "}
                  (ccel.org), used for free, non-profit study.
                </p>
              )}
              <Html html={withoutRepeatedTitle(sec.data.section.html, sec.data.section.title)} footnotes idPrefix={`s${n}`} />
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

      {/* phones: a bar under the thumb (previous, contents, about, next) and sheets that rise from it */}
      <nav className="wm-bar" aria-label="Book navigation">
        <button className="wm-step" disabled={!sec.data?.prev} onClick={() => sec.data?.prev && navigate(`${base}/${sec.data.prev}`)} aria-label="Previous section">
          ‹
        </button>
        <button className="wm-where" onClick={() => setSheet("toc")}>
          <span className="wm-title">{e?.title ?? "Contents"}</span>
          <span className="wm-sub">
            {sec.data?.section.title || sec.data?.section.cite}
            {toc.data && ` · ${toc.data.sections.findIndex((s) => s.ord === n) + 1}/${toc.data.sections.length}`}
          </span>
        </button>
        <button className="wm-icon" onClick={() => setSheet("about")} aria-label="About this work">
          ⓘ
        </button>
        <button className="wm-step" disabled={!sec.data?.next} onClick={() => sec.data?.next && navigate(`${base}/${sec.data.next}`)} aria-label="Next section">
          ›
        </button>
      </nav>
      {sheet && (
        <div className="wm-layer" onClick={(ev) => ev.target === ev.currentTarget && setSheet(null)}>
          <div className="wm-sheet" role="dialog" aria-label={sheet === "toc" ? "Contents" : "About this work"}>
            <div className="wm-grip" aria-hidden />
            <div className="wm-head">
              <strong>{sheet === "toc" ? "Contents" : "About"}</strong>
              <Link to="/library" className="wm-lib">
                ← Library
              </Link>
              <button className="icon-btn" onClick={() => setSheet(null)} aria-label="Close">
                ✕
              </button>
            </div>
            {sheet === "toc" && toc.data && (
              <>
                {toc.data.sections.length > 12 && (
                  <input className="wm-find" placeholder="Find a chapter…" value={find} onChange={(ev) => setFind(ev.target.value)} />
                )}
                <div className="wm-toc">
                  {toc.data.sections
                    .filter((s) => !find || `${s.title} ${s.cite}`.toLowerCase().includes(find.toLowerCase()))
                    .map((s) => (
                      <Link
                        key={s.ord}
                        to={`${base}/${s.ord}`}
                        className={s.ord === n ? "active" : ""}
                        ref={s.ord === n ? (el) => el?.scrollIntoView({ block: "center" }) : undefined}
                        style={{ paddingLeft: 18 + (s.level - 1) * 14 }}
                        replace
                        onClick={() => setSheet(null)}
                      >
                        {s.title || s.cite}
                      </Link>
                    ))}
                </div>
              </>
            )}
            {sheet === "about" && toc.data && (
              <div className="wm-about" onClick={(ev) => (ev.target as HTMLElement).closest("a") && setSheet(null)}>
                <Context toc={toc.data} section={sec.data} books={meta.data?.books ?? []} base={base} />
              </div>
            )}
          </div>
        </div>
      )}
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
            <WikiHover title={e.author_wikipedia}>{e.author}</WikiHover>
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
