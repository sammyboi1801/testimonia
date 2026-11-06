import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTimeline } from "../api";
import { formatYear } from "../lib";
import type { TimelineAuthor, TimelineEvent, TimelineWork } from "../types";
import { AuthorDetail, EventDetail, WorkDetail } from "./Timeline";
import { WikiHover } from "./Wiki";

interface Chapter {
  id: string;
  title: string;
  span: string;
  from: number;
  to: number;
}

const CHAPTERS: Chapter[] = [
  { id: "bc", title: "Before Christ", span: "from the Maccabees to Herod", from: -400, to: 0 },
  ...["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"].map((n, i) => ({
    id: `c${i + 1}`,
    title: `The ${n} century`,
    span: `AD ${i * 100 + 1}–${(i + 1) * 100}`,
    from: i * 100 + 1,
    to: (i + 1) * 100,
  })),
  { id: "later", title: "The Middle Ages", span: "after AD 800", from: 801, to: 3000 },
];

const ORDINAL = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];

type Open = { kind: "author"; a: TimelineAuthor } | { kind: "event"; e: TimelineEvent } | { kind: "work"; w: TimelineWork } | null;

const anchor = (a: TimelineAuthor) => a.floruit_to ?? a.died ?? a.floruit_from ?? a.born ?? 0;
const inChapter = (c: Chapter, y: number) => y >= c.from && y <= c.to;

function dates(a: TimelineAuthor): string {
  const c = (aspect: string) => (a.circa.includes(aspect) ? "c. " : "");
  if (a.born !== null && a.died !== null) return `${c("birth")}${formatYear(a.born)}–${a.died}`;
  if (a.died !== null) return `d. ${c("death")}${formatYear(a.died)}`;
  return `fl. ${c("floruit")}${formatYear(a.floruit_to ?? a.floruit_from)}`;
}

/** The library as a story: century by century, the events that shaped it and the people who wrote in it. */
export function StoryView() {
  const { data, isLoading, error } = useTimeline();
  const [open, setOpen] = useState<Open>(null);

  const chapters = useMemo(() => {
    if (!data) return [];
    return CHAPTERS.map((c) => ({
      ...c,
      events: data.events.filter((e) => inChapter(c, e.start)).sort((a, b) => a.start - b.start),
      authors: data.authors.filter((a) => inChapter(c, anchor(a))).sort((a, b) => anchor(a) - anchor(b)),
      works: data.works.filter((w) => inChapter(c, Math.round(((w.date_from ?? 0) + (w.date_to ?? w.date_from ?? 0)) / 2))),
    })).filter((c) => c.events.length || c.authors.length || c.works.length);
  }, [data]);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  if (isLoading) return <div className="loading">Loading…</div>;
  if (error || !data) return <div className="error">Could not load the story: {String(error)}</div>;

  return (
    <div className="story">
      <nav className="story-index" aria-label="Centuries">
        {chapters.map((c) => (
          <a key={c.id} href={`#${c.id}`} onClick={(e) => (e.preventDefault(), document.getElementById(c.id)?.scrollIntoView({ behavior: "smooth" }))}>
            {c.id === "bc" ? "BC" : c.id === "later" ? "800+" : `${ORDINAL[Number(c.id.slice(1)) - 1]} c.`}
          </a>
        ))}
      </nav>

      {chapters.map((c) => (
        <section key={c.id} id={c.id} className="story-chapter">
          <header className="story-head">
            <h2>{c.title}</h2>
            <span>{c.span}</span>
          </header>

          {c.events.length > 0 && (
            <ol className="story-events">
              {c.events.map((e) => (
                <li key={e.id} className={`${e.major ? "major" : ""} ev-${e.kind}`}>
                  <span className="story-year">{e.circa ? "c. " : ""}{formatYear(e.start)}</span>
                  <div className="story-event-row">
                    <button className="story-event" onClick={() => setOpen({ kind: "event", e })}>
                      <strong>{e.title}</strong>
                      {e.description && <span>{e.description}</span>}
                    </button>
                    <WikiHover title={e.wikipedia}>
                      <span />
                    </WikiHover>
                  </div>
                </li>
              ))}
            </ol>
          )}

          {c.authors.length > 0 && (
            <>
              <h3 className="story-sub">Writers</h3>
              <div className="story-people">
                {c.authors.map((a) => {
                  const top = [...a.works].sort((x, y) => y.citations - x.citations)[0];
                  return (
                    <div key={a.id} className={`story-person trad-${a.tradition ?? "x"}`}>
                      <WikiHover title={a.wikipedia}>
                        <button className="story-name" onClick={() => setOpen({ kind: "author", a })}>
                          {a.name}
                        </button>
                      </WikiHover>
                      <span className="story-dates">{dates(a)}</span>
                      {top?.edition_id && (
                        <Link className="story-work" to={`/library/${encodeURIComponent(top.edition_id)}/1`}>
                          {top.title}
                          {a.works.length > 1 && <span> +{a.works.length - 1}</span>}
                        </Link>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {c.works.length > 0 && (
            <>
              <h3 className="story-sub">Anonymous writings</h3>
              <p className="story-works">
                {c.works.map((w, i) => (
                  <span key={w.id}>
                    {i > 0 && " · "}
                    <button className="link-btn" onClick={() => setOpen({ kind: "work", w })}>
                      {w.title}
                    </button>
                  </span>
                ))}
              </p>
            </>
          )}
        </section>
      ))}

      {open && (
        <div className="shelf-layer" onMouseDown={(e) => e.target === e.currentTarget && setOpen(null)}>
          <aside className="shelf-drawer" role="dialog" aria-modal="true">
            <button className="icon-btn tl-close" onClick={() => setOpen(null)} aria-label="Close">
              ✕
            </button>
            {open.kind === "author" && <AuthorDetail a={open.a} />}
            {open.kind === "event" && <EventDetail e={open.e} />}
            {open.kind === "work" && <WorkDetail w={open.w} />}
          </aside>
        </div>
      )}
    </div>
  );
}
