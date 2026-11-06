import { lazy, Suspense, useState, type ReactNode } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useMeta } from "../api";
import { Html } from "../components/Html";
import type { MapPoint } from "../components/MiniMap";
import { PersonReigns } from "../components/PersonReigns";
import { WikiCard } from "../components/Wiki";
import {
  confidenceBand,
  CONFIDENCE_LABEL,
  KIND_LABEL,
  refLinks,
  useEvent,
  usePerson,
  usePlace,
  yearRange,
  type Dating,
  type EventSummary,
  type FamilyKey,
  type PersonSummary,
  type PlaceSummary,
  type Verses,
} from "../geoApi";
import { formatYear, osisLabel, verseUrl } from "../lib";
import type { Book } from "../types";

// Leaflet only loads when a page actually shows a map.
const MiniMap = lazy(() => import("../components/MiniMap"));

const FAMILY_LABEL: Record<FamilyKey, string> = {
  parents: "Parents",
  spouses: "Married to",
  siblings: "Brothers and sisters",
  half_siblings: "Half-brothers and sisters",
  children: "Children",
};
const ROLE_LABEL: Record<string, string> = { born_at: "born here", died_at: "died here", visited: "was here", event: "events here" };
const PLACE_ROLE: Record<string, string> = { born_at: "born", died_at: "died", visited: "was there", event: "events" };

function Block({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="book-block">
      <h3>
        {title}
        {note !== undefined && <span className="count">{note}</span>}
      </h3>
      {children}
    </section>
  );
}

function Map({ points, zoom }: { points: MapPoint[]; zoom?: number }) {
  if (!points.length) return null;
  return (
    <Suspense fallback={<div className="mini-map loading" />}>
      <MiniMap points={points} zoom={zoom} />
    </Suspense>
  );
}

function located(places: PlaceSummary[]): MapPoint[] {
  return places.filter((p) => p.lat !== null && p.lon !== null).map((p) => ({ id: p.id, name: p.name, kind: p.kind, lat: p.lat!, lon: p.lon! }));
}

/** Every verse that names someone or somewhere, grouped by book; long lists fold. */
function VerseList({ verses, books, what }: { verses: Verses; books: Book[]; what: string }) {
  const [allBooks, setAllBooks] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (!verses.count) return <p className="muted">No verse references recorded.</p>;
  const shown = allBooks ? verses.books : verses.books.slice(0, 12);
  return (
    <>
      {verses.samples.some((s) => s.text) && (
        <div className="ent-samples">
          {verses.samples
            .filter((s) => s.text)
            .slice(0, 3)
            .map((s) => (
              <blockquote key={s.osis}>
                {s.text} <Link to={verseUrl(s.osis)}>{osisLabel(s.osis, books)}</Link>
              </blockquote>
            ))}
        </div>
      )}
      <p className="muted small">
        {what} in {verses.count.toLocaleString()} {verses.count === 1 ? "verse" : "verses"} across {verses.books.length} {verses.books.length === 1 ? "book" : "books"}
      </p>
      <div className="ent-books">
        {shown.map((g) => {
          const refs = open[g.book] ? g.refs : g.refs.slice(0, 30);
          return (
            <div key={g.book} className="ent-book">
              <Link className="ent-book-name" to={`/book/${g.book}`}>
                {g.name}
              </Link>
              <span className="ent-refs">
                {refLinks(g.book, refs).map((r) => (
                  <Link key={r.osis} to={verseUrl(r.osis)}>
                    {r.label}
                  </Link>
                ))}
                {g.refs.length > refs.length && (
                  <button className="link-btn" onClick={() => setOpen({ ...open, [g.book]: true })}>
                    +{g.refs.length - refs.length} more
                  </button>
                )}
              </span>
            </div>
          );
        })}
      </div>
      {!allBooks && verses.books.length > shown.length && (
        <button className="link-btn" onClick={() => setAllBooks(true)}>
          Show all {verses.books.length} books
        </button>
      )}
    </>
  );
}

function EventList({ events }: { events: EventSummary[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? events : events.slice(0, 12);
  return (
    <>
      <ol className="ent-events">
        {shown.map((e) => (
          <li key={e.id}>
            <span className="ent-year">{yearRange(e.year, e.end_year && e.end_year - (e.year ?? 0) < 200 ? e.end_year : null)}</span>
            <Link to={`/event/${encodeURIComponent(e.id)}`}>{e.title}</Link>
          </li>
        ))}
      </ol>
      {!all && events.length > shown.length && (
        <button className="link-btn" onClick={() => setAll(true)}>
          Show all {events.length}
        </button>
      )}
    </>
  );
}

function People({ people, limit = 16 }: { people: PersonSummary[]; limit?: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? people : people.slice(0, limit);
  return (
    <>
      <ul className="ent-people">
        {shown.map((p) => (
          <li key={p.id}>
            <Link to={`/person/${encodeURIComponent(p.id)}`}>{p.name}</Link>
            {p.summary && <span className="muted"> · {p.summary}</span>}
            {p.roles && p.roles.filter((r) => r !== "event").length > 0 && (
              <span className="muted small"> · {p.roles.filter((r) => r !== "event").map((r) => ROLE_LABEL[r] ?? r).join(", ")}</span>
            )}
          </li>
        ))}
      </ul>
      {!all && people.length > shown.length && (
        <button className="link-btn" onClick={() => setAll(true)}>
          Show all {people.length}
        </button>
      )}
    </>
  );
}

function datingLabel(d: Dating): string {
  const range = yearRange(d.start_year, d.end_year);
  return `${d.circa ? "c. " : ""}${d.label ?? range}`;
}

function SourceNote({ source }: { source: string | null }) {
  const credit: Record<string, string> = {
    "openbible-geo": "Place data from OpenBible.info (CC BY 4.0)",
    theographic: "From Theographic Bible Metadata (CC BY-SA 4.0); dictionary text from Easton's Bible Dictionary (1897, public domain)",
    "testimonia-curated": "From Testimonia's curated tables of rulers (CC BY-SA 4.0; each reign cites its source) and Wikidata (CC0)",
  };
  return <p className="muted small ent-credit">{(source && credit[source]) ?? "From the Testimonia database"} · see Credits for every source.</p>;
}

function Loading({ what, error, isLoading }: { what: string; error: unknown; isLoading: boolean }) {
  if (isLoading) return <div className="loading">Loading…</div>;
  return (
    <div className="error">
      Could not load this {what}: {String(error)}
    </div>
  );
}

// ----------------------------------------------------------------------------- place

export function PlacePage() {
  const { id = "" } = useParams();
  const { data, isLoading, error } = usePlace(id);
  const books = useMeta().data?.books ?? [];
  if (!data) return <Loading what="place" error={error} isLoading={isLoading} />;
  const p = data.place;
  const band = confidenceBand(p.confidence);
  const sameSite = data.nearby.filter((n) => (n.km ?? 99) < 1);
  const around = data.nearby.filter((n) => (n.km ?? 99) >= 1);
  const points: MapPoint[] =
    p.lat !== null && p.lon !== null
      ? [{ id: p.id, name: p.name, kind: p.kind, lat: p.lat, lon: p.lon, confidence: p.confidence, main: true }, ...located(around.slice(0, 8))]
      : [];
  const ext = p.external;
  return (
    <div className="page book-page entity-page">
      <Link to={`/atlas?place=${encodeURIComponent(p.id)}`} className="book-back">
        ← Atlas
      </Link>
      <header className="book-hero ent-hero">
        <div>
          <div className="about-label">Place</div>
          <h1>{p.name}</h1>
          <div className="ctx-meta">
            <span>{KIND_LABEL[p.kind ?? "site"] ?? p.kind}</span>
            {p.modern_name && <span>today {p.modern_name}</span>}
            <span>
              {data.verses.count.toLocaleString()} {data.verses.count === 1 ? "verse" : "verses"}
            </span>
          </div>
          {p.lat !== null && <div className={`conf conf-${band}`}>{CONFIDENCE_LABEL[band]}{p.precision === "approximate" ? " · general area" : ""}</div>}
          {p.summary && <p className="ent-summary">{p.summary}</p>}
          {p.alt_names.length > 0 && <p className="muted small">Also called {p.alt_names.slice(0, 8).join(", ")}</p>}
          <p className="ent-ext">
            {ext.openbible && (
              <a href={`https://www.openbible.info/geo/ancient/${ext.openbible}`} target="_blank" rel="noreferrer">
                OpenBible.info ↗
              </a>
            )}
            {ext.pleiades && (
              <a href={`https://pleiades.stoa.org/places/${ext.pleiades}`} target="_blank" rel="noreferrer">
                Pleiades ↗
              </a>
            )}
            {ext.wikidata && (
              <a href={`https://www.wikidata.org/wiki/${ext.wikidata}`} target="_blank" rel="noreferrer">
                Wikidata ↗
              </a>
            )}
          </p>
        </div>
        <div className="ent-hero-side">
          <Map points={points} zoom={band === "uncertain" ? 8 : 9} />
          {ext.wikipedia && <WikiCard title={ext.wikipedia} />}
        </div>
      </header>
      <div className="bk-layout">
        <section className="book-col">
          <h2>In the Bible</h2>
          <VerseList verses={data.verses} books={books} what={`Named`} />
        </section>
        <aside className="book-col side">
          {data.events.length > 0 && (
            <Block title="Events here" note={data.events.length}>
              <EventList events={data.events} />
            </Block>
          )}
          {data.people.length > 0 && (
            <Block title="People" note={data.people.length}>
              <People people={data.people} />
            </Block>
          )}
          {data.routes.length > 0 && (
            <Block title="Paul's journeys">
              <p className="ent-tight">
                A stop on {data.routes.length === 1 ? "one of Paul's journeys" : `${data.routes.length} of Paul's journeys`}.{" "}
                <Link to={`/atlas?place=${encodeURIComponent(p.id)}&paul=1`}>Show the routes →</Link>
              </p>
            </Block>
          )}
          {sameSite.length > 0 && (
            <Block title="At the same site">
              <p className="ent-nearby">
                {sameSite.map((n) => (
                  <Link key={n.id} to={`/place/${encodeURIComponent(n.id)}`}>
                    {n.name}
                  </Link>
                ))}
              </p>
            </Block>
          )}
          {around.length > 0 && (
            <Block title="Nearby">
              <p className="ent-nearby">
                {around.map((n) => (
                  <span key={n.id}>
                    <Link to={`/place/${encodeURIComponent(n.id)}`}>{n.name}</Link>
                    <span className="muted small"> {n.km} km</span>
                  </span>
                ))}
              </p>
            </Block>
          )}
          {p.easton && <Easton html={p.easton} />}
        </aside>
      </div>
      <SourceNote source={p.source_id} />
    </div>
  );
}

function Easton({ html }: { html: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Block title="Easton's Bible Dictionary" note="1897">
      <div className={`ent-easton${open ? " open" : ""}`}>
        <Html html={html} />
      </div>
      {!open && html.length > 700 && (
        <button className="link-btn" onClick={() => setOpen(true)}>
          Read the whole entry
        </button>
      )}
    </Block>
  );
}

// ----------------------------------------------------------------------------- person

export function PersonPage() {
  const { id = "" } = useParams();
  const { data, isLoading, error } = usePerson(id);
  const books = useMeta().data?.books ?? [];
  if (!data) return <Loading what="person" error={error} isLoading={isLoading} />;
  const p = data.person;
  if (p.kind !== "biblical" && p.kind !== "ruler") return <Navigate to={`/library?view=timeline&sel=a:${encodeURIComponent(p.id)}`} replace />;
  const life = [p.born !== null && `born ${formatYear(p.born)}`, p.died !== null && `died ${formatYear(p.died)}`].filter(Boolean).join(" · ");
  const points = located(data.places);
  return (
    <div className="page book-page entity-page">
      <header className="book-hero ent-hero">
        <div>
          <div className="about-label">{p.kind === "ruler" ? "Ruler" : "Person in the Bible"}</div>
          <h1>{p.name}</h1>
          <div className="ctx-meta">
            {p.summary && <span>{p.summary}</span>}
            {p.groups.length > 0 && <span>{p.groups.join(", ")}</span>}
            <span>
              {data.verses.count.toLocaleString()} {data.verses.count === 1 ? "verse" : "verses"}
            </span>
          </div>
          {life && (
            <p className="muted small">
              {life} <span title="Theographic follows Floyd Nolen Jones's chronology">(Jones chronology)</span>
            </p>
          )}
          {p.alt_names.length > 0 && <p className="muted small">Also called {p.alt_names.slice(0, 10).join(", ")}</p>}
          {p.wrote.length > 0 && (
            <p className="ent-tight">
              Traditionally the author of{" "}
              {p.wrote.map((b, i) => (
                <span key={b.osis}>
                  {i > 0 && (i === p.wrote.length - 1 ? " and " : ", ")}
                  <Link to={`/book/${b.osis}`}>{b.name}</Link>
                </span>
              ))}
              .
            </p>
          )}
          {p.external.wikipedia && <WikiCard title={p.external.wikipedia} />}
        </div>
        <div className="ent-hero-side">
          <Family name={p.name} family={data.family} />
        </div>
      </header>
      <div className="bk-layout">
        <section className="book-col">
          <h2>In the Bible</h2>
          <VerseList verses={data.verses} books={books} what="Named" />
        </section>
        <aside className="book-col side">
          <PersonReigns id={p.id} />
          {data.events.length > 0 && (
            <Block title="Events" note={data.events.length}>
              <EventList events={data.events} />
            </Block>
          )}
          {data.places.length > 0 && (
            <Block title="Places" note={data.places.length}>
              <Map points={points} zoom={7} />
              <p className="ent-nearby">
                {data.places.map((pl) => (
                  <span key={pl.id}>
                    <Link to={`/place/${encodeURIComponent(pl.id)}`}>{pl.name}</Link>
                    {pl.roles && pl.roles.some((r) => r !== "event") && (
                      <span className="muted small"> {pl.roles.filter((r) => r !== "event").map((r) => PLACE_ROLE[r] ?? r).join(", ")}</span>
                    )}
                  </span>
                ))}
              </p>
            </Block>
          )}
          {p.bio && <Easton html={p.bio} />}
        </aside>
      </div>
      <SourceNote source={p.source_id} />
    </div>
  );
}

/** Parents above, spouses beside, children below: a small family tree from the relations Theographic records. */
function Family({ name, family }: { name: string; family: Partial<Record<FamilyKey, PersonSummary[]>> }) {
  const row = (key: FamilyKey) => {
    const people = family[key];
    if (!people?.length) return null;
    const shown = people.slice(0, 14);
    return (
      <div className={`fam-row fam-${key}`}>
        <span className="fam-label">{FAMILY_LABEL[key]}</span>
        <span className="fam-people">
          {shown.map((x) => (
            <Link key={x.id} to={`/person/${encodeURIComponent(x.id)}`} title={x.summary ?? undefined}>
              {x.name}
            </Link>
          ))}
          {people.length > shown.length && <span className="muted small">+{people.length - shown.length}</span>}
        </span>
      </div>
    );
  };
  if (!Object.values(family).some((v) => v?.length)) return null;
  return (
    <div className="family" aria-label="Family">
      {row("parents")}
      <div className="fam-self">
        <strong>{name}</strong>
      </div>
      {row("spouses")}
      {row("siblings")}
      {row("half_siblings")}
      {row("children")}
    </div>
  );
}

// ----------------------------------------------------------------------------- event

export function EventPage() {
  const { id = "" } = useParams();
  const { data, isLoading, error } = useEvent(id);
  const books = useMeta().data?.books ?? [];
  if (!data) return <Loading what="event" error={error} isLoading={isLoading} />;
  const e = data.event;
  const when = e.dating.find((d) => d.aspect === "when");
  const points = located(data.places);
  const first = data.refs[0];
  const passageLabel = data.refs
    .slice(0, 4)
    .map((r) => (r.end_osis !== r.osis ? `${osisLabel(r.osis, books)}–${r.end_osis.split(".").slice(r.end_osis.split(".")[1] === r.osis.split(".")[1] ? 2 : 1).join(":")}` : osisLabel(r.osis, books)))
    .join("; ");
  return (
    <div className="page book-page entity-page">
      <header className="book-hero ent-hero">
        <div>
          <div className="about-label">{e.kind === "biblical" ? "Event in the Bible" : "Event"}</div>
          <h1>{e.title}</h1>
          <div className="ctx-meta">
            {when && (
              <span>
                {datingLabel(when)}
                {when.system && <span className="muted"> ({when.system_id === "jones" ? "Jones chronology" : when.system})</span>}
              </span>
            )}
            {data.places.length === 1 && data.places[0] && (
              <span>
                at <Link to={`/place/${encodeURIComponent(data.places[0].id)}`}>{data.places[0].name}</Link>
              </span>
            )}
            {passageLabel && <span>{passageLabel}{data.refs.length > 4 ? " …" : ""}</span>}
          </div>
          {e.description && <p className="ent-summary">{e.description}</p>}
          {e.external.wikipedia && <WikiCard title={e.external.wikipedia} />}
        </div>
        <div className="ent-hero-side">
          <Map points={points} zoom={7} />
        </div>
      </header>
      <div className="bk-layout">
        <section className="book-col">
          {data.passage.length > 0 && (
            <>
              <h2>The passage</h2>
              <div className="ent-passage">
                {data.passage.map((v) => (
                  <p key={v.osis}>
                    <Link className="ent-vnum" to={verseUrl(v.osis)}>
                      {v.osis.split(".").slice(1).join(":")}
                    </Link>{" "}
                    {v.text}
                  </p>
                ))}
              </div>
              {first && (
                <Link className="btn" to={verseUrl(first.osis)}>
                  Read in context →
                </Link>
              )}
            </>
          )}
        </section>
        <aside className="book-col side">
          {data.people.length > 0 && (
            <Block title="People" note={data.people.length}>
              <People people={data.people} />
            </Block>
          )}
          {data.places.length > 1 && (
            <Block title="Where" note={data.places.length}>
              <p className="ent-nearby">
                {data.places.map((pl) => (
                  <Link key={pl.id} to={`/place/${encodeURIComponent(pl.id)}`}>
                    {pl.name}
                  </Link>
                ))}
              </p>
            </Block>
          )}
          {data.related.part_of && (
            <Block title="Part of">
              <EventList events={data.related.part_of} />
            </Block>
          )}
          {data.related.parts && (
            <Block title="Within it" note={data.related.parts.length}>
              <EventList events={data.related.parts} />
            </Block>
          )}
          {(data.related.after || data.related.before) && (
            <Block title="Before and after">
              {data.related.after && (
                <>
                  <p className="muted small">After</p>
                  <EventList events={data.related.after} />
                </>
              )}
              {data.related.before && (
                <>
                  <p className="muted small">Followed by</p>
                  <EventList events={data.related.before} />
                </>
              )}
            </Block>
          )}
          {e.dating.length > 1 && (
            <Block title="Dates">
              <ul className="ent-dates">
                {e.dating.map((d, i) => (
                  <li key={i}>
                    {datingLabel(d)} <span className="muted small">{d.system ?? d.system_id}</span>
                  </li>
                ))}
              </ul>
            </Block>
          )}
        </aside>
      </div>
      <SourceNote source={e.source_id} />
    </div>
  );
}
