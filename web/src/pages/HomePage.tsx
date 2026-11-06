import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useMeta, useVerse } from "../api";
import { formatYear, osisLabel } from "../lib";
import { Mark } from "../components/Marks";

export const GITHUB_URL = "https://github.com/sammyboi1801/testimonia";
const LAST_READ = "testimonia.lastRead";

/** Remember the chapter being read, so the front page can offer to continue there. */
export function rememberReading(book: string, chapter: number): void {
  try {
    localStorage.setItem(LAST_READ, JSON.stringify({ book, chapter }));
  } catch {
    /* private mode: nothing to remember */
  }
}

function lastReading(): { book: string; chapter: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_READ) ?? "null") as { book?: string; chapter?: number } | null;
    return v?.book && v.chapter ? { book: v.book, chapter: v.chapter } : null;
  } catch {
    return null;
  }
}

const FEATURES: { mark: string; title: string; text: string; to: string; cta: string }[] = [
  {
    mark: "Αα",
    title: "Read in the original",
    text: "Thirteen historic and modern translations side by side, with an interlinear of every Greek and Hebrew word, its lexicon entry and its grammar.",
    to: "/read/John/1?mode=interlinear",
    cta: "John 1, interlinear",
  },
  {
    mark: "◆",
    title: "See where manuscripts differ",
    text: "About 15,000 places where the printed Greek editions or the Hebrew tradition disagree, explained in plain words: meaning, omission, word order or spelling.",
    to: "/read/John/1?v=John.1.18&t=text",
    cta: "“God” or “Son” in John 1:18",
  },
  {
    mark: "✝",
    title: "Hear the early church",
    text: "Which writers of the first centuries quoted each verse, when, and what they said, with the pre-Nicene fathers (before AD 325) first.",
    to: "/read/John/3?v=John.3.16&t=fathers",
    cta: "Who quoted John 3:16",
  },
  {
    mark: "⟶",
    title: "Walk through history",
    text: "A library of early Christian, Jewish and Roman writings on a timeline, from the apostolic fathers to Augustine, beside the events that shaped them.",
    to: "/library?view=timeline",
    cta: "Open the timeline",
  },
  {
    mark: "✎",
    title: "Keep your own notes",
    text: "Highlight verses or single words and write notes. They stay in your browser: no account, nothing sent anywhere, and you can export them any time.",
    to: "/notes",
    cta: "Your notes",
  },
  {
    mark: "✦",
    title: "Ask with your own AI",
    text: "An assistant that searches this library and cites what it finds. Bring a key from any provider, or connect a model running on your own computer.",
    to: "/ask",
    cta: "Ask a question",
  },
];

const SOURCES = [
  "STEPBible (Tyndale House)",
  "eBible.org translations",
  "OpenBible.info cross references",
  "Treasury of Scripture Knowledge",
  "BibleTimeline",
  "Perseus Digital Library",
  "Project Gutenberg",
  "Wikipedia summaries",
];

/** The front page: what Testimonia is, a live sample, and ways in. */
export function HomePage() {
  const meta = useMeta();
  const last = useMemo(lastReading, []);
  const counts = meta.data?.counts;
  const stats: [string, string][] = counts
    ? [
        [String(meta.data!.editions.length), "texts & translations"],
        [counts.works.toLocaleString(), "early writings"],
        [counts.citations.toLocaleString(), "quotations of Scripture"],
        [counts.commentary.toLocaleString(), "verse comments"],
      ]
    : [];
  const books = meta.data?.books ?? [];

  return (
    <div className="home">
      <section className="home-hero">
        <div className="home-hero-text">
          <p className="home-eyebrow">Free · open source · no account</p>
          <h1>
            Read the Bible with <em>its earliest witnesses.</em>
          </h1>
          <p className="home-lede">
            Testimonia puts the Hebrew and Greek texts, their ancient translations, the places where manuscripts
            disagree, and the first Christian writers who quoted every verse side by side in one study library.
          </p>
          <div className="home-cta">
            {last ? (
              <>
                <Link className="btn primary" to={`/read/${last.book}/${last.chapter}`}>
                  Continue {osisLabel(`${last.book}.${last.chapter}`, books)} →
                </Link>
                <Link className="btn" to="/read/John/1">
                  Start at John 1
                </Link>
              </>
            ) : (
              <>
                <Link className="btn primary" to="/read/John/1">
                  Start reading →
                </Link>
                <Link className="btn" to="/library">
                  Browse the library
                </Link>
              </>
            )}
          </div>
          <p className="home-small">
            Works on your phone. <a href={GITHUB_URL}>Source code on GitHub</a>.
          </p>
        </div>
        <Specimen />
      </section>

      {stats.length > 0 && (
        <section className="home-stats" aria-label="What is inside">
          {stats.map(([n, label]) => (
            <div key={label}>
              <strong>{n}</strong>
              <span>{label}</span>
            </div>
          ))}
        </section>
      )}

      <section className="home-features">
        {FEATURES.map((f) => (
          <Link key={f.title} to={f.to} className="home-feature">
            <span className="home-feature-mark" aria-hidden>
              {f.mark}
            </span>
            <h2>{f.title}</h2>
            <p>{f.text}</p>
            <span className="home-feature-cta">{f.cta} →</span>
          </Link>
        ))}
      </section>

      <section className="home-open">
        <div>
          <h2>Built entirely on open data</h2>
          <p>
            Every text, lexicon, variant and date comes from openly licensed or public-domain sources, credited one by
            one. The code is MIT licensed: read it, run it on your own computer, or help build it.
          </p>
          <p className="home-links">
            <a href={`${GITHUB_URL}/blob/main/CREDITS.md`}>Sources & credits</a>
            <a href={GITHUB_URL}>GitHub</a>
            <a href={`${GITHUB_URL}/blob/main/docs/DEPLOY.md`}>Run it yourself</a>
          </p>
        </div>
        <ul className="home-sources">
          {SOURCES.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>

      <footer className="home-foot">
        <span>Testimonia: the scriptural “witnesses” gathered by the first Christians.</span>
        <span>
          <a href={GITHUB_URL}>GitHub</a> · Notes stay in your browser · No tracking
        </span>
      </footer>
    </div>
  );
}

/** A live sample: John 1:1 with its Greek, a translation, and who quoted it first. */
function Specimen() {
  const g = useVerse("John.1.1").data;
  const greek = g?.words.tagnt?.map((w) => w.surface).join(" ");
  const kjv = g?.texts.find((t) => t.edition_id === "kjva") ?? g?.texts[0];
  const fathers = (g?.fathers ?? []).filter((f) => f.year != null).sort((a, b) => a.year! - b.year!);
  const writers = new Set(fathers.map((f) => f.author ?? f.work_title));
  const first = fathers[0];
  return (
    <Link to="/read/John/1?v=John.1.1" className="home-specimen" aria-label="Open John 1:1">
      <div className="spec-ref">John 1:1</div>
      {greek ? <p className="spec-greek greek">{greek}</p> : <p className="spec-greek spec-skeleton" />}
      {kjv ? <p className="spec-text">{kjv.text}</p> : <p className="spec-text spec-skeleton" />}
      {g && (
        <ul className="spec-facts">
          {g.variants.length > 0 && (
            <li>
              <Mark kind="var" /> {g.variants.length} place{g.variants.length > 1 ? "s" : ""} where the Greek editions
              differ
            </li>
          )}
          {writers.size > 0 && (
            <li>
              <Mark kind="fat" /> quoted by {writers.size} early writers
              {first ? `, first by ${first.author ?? first.work_title} (${formatYear(first.year!)})` : ""}
            </li>
          )}
          {g.crossrefs.length > 0 && (
            <li>
              <Mark kind="quo" /> {g.crossrefs.length} cross references
            </li>
          )}
        </ul>
      )}
      <span className="spec-open">Open this verse →</span>
    </Link>
  );
}
