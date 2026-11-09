import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useChapter, useMeta, useVerse } from "../api";
import { openAsk } from "../components/AskDrawer";
import { HIGHLIGHTS, useNotes } from "../notes";
import { openMap, usePins } from "../pins";
import { isoDate, loadProgress, usePlans, type PlanSummary } from "../readingApi";
import { ACTIVITY, PROFILE, formatYear, lastReadingPath, osisLabel, verseUrl } from "../lib";
import { syncAvailable, useSync } from "../sync";
import "../landing.css";
import "../home.css";

/** The study desk, built like the daily home of a Bible app: one verse for today, your reading and your plans,
 *  then what you have kept. Sections with nothing in them give way to suggestions instead of empty boxes. */

// a verse for each day of the year, chosen from passages the early church quoted often
const DAILY = [
  "John.1.1", "Ps.23.1", "Isa.53.5", "Rom.8.28", "Matt.5.3", "John.3.16", "Phil.4.13", "Prov.3.5", "Gen.1.1", "Ps.46.10",
  "Isa.40.31", "Matt.11.28", "John.14.6", "Rom.12.2", "Heb.11.1", "1Cor.13.4", "Gal.2.20", "Eph.2.8", "Ps.119.105", "Mic.6.8",
  "John.1.14", "Lam.3.22", "Ps.51.10", "Isa.9.6", "Matt.6.33", "John.8.12", "Rom.5.8", "2Cor.5.17", "Col.1.15", "Heb.4.12",
  "Ps.27.1", "Isa.43.2", "Jer.29.11", "Matt.28.19", "John.15.5", "Rom.10.9", "1John.4.8", "Rev.21.4", "Deut.6.4", "Ps.139.14",
  "Isa.55.8", "Luke.1.37", "John.11.25", "Acts.2.38", "Phil.2.5", "Jas.1.5", "1Pet.5.7", "Ps.90.2", "Wis.7.26", "Sir.2.1",
];
const IMAGES = ["p66", "sinaiticus", "leningrad", "ignatius", "nicaea", "jerome", "kjv", "titus", "p52"];
const COVERS = ["sinaiticus", "p66", "jerome", "leningrad", "ignatius", "nicaea", "kjv", "titus"];

function dayOfYear(d = new Date()): number {
  return Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 0).getTime()) / 86_400_000);
}
function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
function ago(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days < 1 ? "today" : days === 1 ? "yesterday" : days < 7 ? `${days} days ago` : new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" });
}
function read<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? "null") as T) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Days in a row with some reading, counting back from today (or yesterday, so a streak survives until bedtime). */
function streak(days: string[]): { count: number; week: boolean[] } {
  const set = new Set(days);
  const d = new Date();
  if (!set.has(isoDate(d))) d.setDate(d.getDate() - 1);
  let count = 0;
  while (set.has(isoDate(d))) {
    count++;
    d.setDate(d.getDate() - 1);
  }
  const week = Array.from({ length: 7 }, (_, i) => {
    const x = new Date();
    x.setDate(x.getDate() - (6 - i));
    return set.has(isoDate(x));
  });
  return { count, week };
}

// ----------------------------------------------------------------------------- verse of the day

function VerseOfTheDay({ name }: { name: string }) {
  const osis = DAILY[dayOfYear() % DAILY.length]!;
  const img = IMAGES[dayOfYear() % IMAGES.length]!;
  const { data } = useVerse(osis);
  const meta = useMeta();
  const books = meta.data?.books ?? [];
  const text = data?.texts.find((t) => t.edition_id === "bsb")?.text ?? data?.texts.find((t) => t.edition_id === "web")?.text ?? data?.texts[0]?.text;
  // the earliest writer who quoted it
  const early = [...(data?.fathers ?? [])].filter((f) => f.year !== null && f.snippet && f.author).sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999))[0];
  const key = data?.words.tagnt?.[0] ?? data?.words.tahot?.[0];
  const label = osisLabel(osis, books);
  return (
    <section className="hm-votd" style={{ ["--votd-img" as string]: `url(/landing/${img}.jpg)` }}>
      <div className="hm-votd-shade" />
      <div className="hm-votd-inner">
        <div className="hm-votd-top">
          <span className="hm-eyebrow">
            {greeting()}
            {name ? `, ${name}` : ""} · Verse of the day
          </span>
          <span className="hm-date">{new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}</span>
        </div>
        <blockquote className="hm-votd-text">{text ? `“${text}”` : "…"}</blockquote>
        <div className="hm-votd-ref">{label}</div>
        {early && (
          <Link className="hm-votd-father" to={`${verseUrl(osis)}&t=fathers`}>
            <span className="hm-eyebrow">Quoted by {early.author ?? "an early writer"}, {early.year !== null ? formatYear(early.year) : ""}</span>
            <span className="hm-father-snip">{early.snippet!.replace(/<[^>]+>/g, "").slice(0, 170)}…</span>
          </Link>
        )}
        <div className="hm-votd-actions">
          <Link className="lp-btn primary" to={verseUrl(osis)}>
            Read in context
          </Link>
          <button className="lp-btn glass" onClick={() => openAsk(label, `What did the early church make of ${label}?`)}>
            ✦ Ask about it
          </button>
          {key && (
            <Link className="lp-btn glass" to={`${verseUrl(osis)}&t=words`}>
              The {data?.words.tagnt?.length ? "Greek" : "Hebrew"} words
            </Link>
          )}
          <button
            className="lp-btn glass"
            onClick={() => {
              const share = { title: label, text: `${text ?? ""} — ${label}`, url: `${window.location.origin}${verseUrl(osis)}` };
              if (navigator.share) void navigator.share(share).catch(() => undefined);
              else void navigator.clipboard?.writeText(`${share.text}\n${share.url}`);
            }}
          >
            Share
          </button>
        </div>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------- today: reading, plan, streak

function ContinueCard({ path }: { path: string }) {
  const m = /^\/read\/([^/]+)\/(\d+)/.exec(path);
  const book = m?.[1] ?? "John";
  const ch = Number(m?.[2] ?? 1);
  const meta = useMeta();
  const { data } = useChapter(book, ch, ["kjva", "web", "bsb"]);
  const info = meta.data?.books.find((b) => b.osis === book);
  const first = data?.verses.find((v) => v.verse >= 1);
  const text = first ? (first.texts.bsb ?? first.texts.web ?? first.texts.kjva)?.text : undefined;
  const of = info?.chapters ?? 1;
  return (
    <Link className="hm-card hm-continue" to={path}>
      <span className="hm-eyebrow accent">Continue reading</span>
      <strong className="hm-title">
        {info?.name ?? book} {ch}
      </strong>
      {data?.headings[0]?.title && <span className="hm-sub">{data.headings[0].title}</span>}
      {text && <p className="hm-quote">{text.length > 200 ? `${text.slice(0, 200)}…` : text}</p>}
      <div className="hm-progress">
        <div className="hm-bar">
          <i style={{ width: `${Math.round((100 * ch) / of)}%` }} />
        </div>
        <span>
          Chapter {ch} of {of}
        </span>
      </div>
    </Link>
  );
}

function StreakCard() {
  const { count, week } = streak(read<string[]>(ACTIVITY, []));
  const labels = Array.from({ length: 7 }, (_, i) => {
    const x = new Date();
    x.setDate(x.getDate() - (6 - i));
    return x.toLocaleDateString([], { weekday: "narrow" });
  });
  return (
    <div className="hm-card hm-streak">
      <span className="hm-eyebrow accent">Reading streak</span>
      <strong className="hm-big">
        {count}
        <small>{count === 1 ? " day" : " days"}</small>
      </strong>
      <div className="hm-week">
        {week.map((on, i) => (
          <span key={i} className={on ? "on" : ""}>
            <i />
            {labels[i]}
          </span>
        ))}
      </div>
      <span className="hm-sub">{count ? "Read a chapter today to keep it going." : "Read a chapter today to start a streak."}</span>
    </div>
  );
}

function activePlan(plans: PlanSummary[]) {
  for (const p of plans) {
    const prog = loadProgress(p.id);
    if (prog.start) {
      const total = p.days || 1;
      const day = Math.min(total, Math.max(1, Math.floor((new Date(isoDate(new Date())).getTime() - new Date(prog.start).getTime()) / 86_400_000) + 1));
      return { plan: p, done: prog.done.length, day, total };
    }
  }
  return null;
}

function PlanToday({ plans }: { plans: PlanSummary[] }) {
  const a = activePlan(plans);
  if (!a) return null;
  const pct = Math.round((100 * a.done) / a.total);
  return (
    <Link className="hm-card hm-plan" to={`/plans/${encodeURIComponent(a.plan.id)}`}>
      <span className="hm-eyebrow accent">Today’s reading · day {a.day}</span>
      <strong className="hm-title">{a.plan.title}</strong>
      <div className="hm-progress">
        <div className="hm-bar">
          <i style={{ width: `${pct}%` }} />
        </div>
        <span>
          {a.done} of {a.total} days
        </span>
      </div>
      <span className="lp-link">Read today’s portion →</span>
    </Link>
  );
}

// ----------------------------------------------------------------------------- plans gallery

function PlanGallery({ plans, title }: { plans: PlanSummary[]; title: string }) {
  if (!plans.length) return null;
  return (
    <section className="hm-section">
      <div className="hm-section-head">
        <h2>{title}</h2>
        <Link to="/plans">See all →</Link>
      </div>
      <div className="hm-shelf">
        {plans.slice(0, 10).map((p, i) => (
          <Link key={p.id} className="hm-cover" to={`/plans/${encodeURIComponent(p.id)}`}>
            <div className="hm-cover-img" style={{ backgroundImage: `url(/landing/${COVERS[i % COVERS.length]}.jpg)` }}>
              <span>{p.days} days</span>
            </div>
            <strong>{p.title}</strong>
            <span className="hm-sub">{p.description}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------- the page

function NamePrompt({ fallback, onSave }: { fallback: string; onSave: (n: string) => void }) {
  const [v, setV] = useState(fallback);
  return (
    <form
      className="hm-name"
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim()) onSave(v.trim());
      }}
    >
      <span>What should we call you?</span>
      <input value={v} onChange={(e) => setV(e.target.value)} maxLength={40} aria-label="Your name" />
      <button className="lp-btn primary" type="submit">
        Save
      </button>
    </form>
  );
}

export default function HomePage() {
  const sync = useSync();
  const { notes } = useNotes();
  const { pinned, sets } = usePins();
  const meta = useMeta();
  const plans = usePlans();
  const books = meta.data?.books ?? [];
  const [profile, setProfile] = useState(() => read<{ name?: string }>(PROFILE, {}));
  const chats = useMemo(() => read<{ id: string; title: string; updated: string; model?: string }[]>("testimonia.ai.chats.v1", []).slice(0, 4), []);
  const kept = useMemo(
    () =>
      Object.values(notes)
        .filter((n) => n.text || n.highlight)
        .sort((a, b) => b.updated.localeCompare(a.updated)),
    [notes],
  );

  // ?preview shows the desk with this browser's own data (for checking the design); it reads nothing from any account
  const preview = new URLSearchParams(window.location.search).has("preview");
  if (!syncAvailable && !preview) return <Navigate to={lastReadingPath()} replace />;
  if (!sync.ready && !preview) return <div className="page loading">Opening your desk…</div>;
  if (!sync.user && !preview) return <Navigate to="/" replace />;
  const user = sync.user ?? { name: null, email: "reader@example.com", photo: null };

  // Google gives a name; an email account gets asked once
  const name = profile.name ?? (user.name ? user.name.split(" ")[0]! : "");
  const askName = !profile.name && !user.name;
  const saveName = (n: string) => {
    const p = { name: n };
    localStorage.setItem(PROFILE, JSON.stringify(p));
    setProfile(p);
  };
  const plan = activePlan(plans.data ?? []);
  const empty = kept.length === 0 && chats.length === 0 && pinned.length === 0 && sets.length === 0;

  return (
    <div className="hm2">
      {askName && <NamePrompt fallback={(user.email ?? "").split("@")[0]!.replace(/[._\d]+/g, " ").trim()} onSave={saveName} />}

      <VerseOfTheDay name={name} />

      <section className={`hm-today${plan ? " with-plan" : ""}`}>
        <ContinueCard path={lastReadingPath()} />
        {plan && <PlanToday plans={plans.data ?? []} />}
        <StreakCard />
      </section>

      <nav className="hm-go" aria-label="Go to">
        {[
          ["/search", "Search", "Words, people, verses"],
          ["/library", "Library", "The early church"],
          ["/atlas", "Atlas", "The places"],
          ["/library?view=timeline", "Timeline", "Who ruled when"],
          ["/notes", "Notes", `${kept.length} kept`],
        ].map(([to, t, s]) => (
          <Link key={to} to={to!}>
            <strong>{t}</strong>
            <span>{s}</span>
          </Link>
        ))}
      </nav>

      <PlanGallery plans={(plans.data ?? []).filter((p) => p.id !== plan?.plan.id)} title={plan ? "More reading plans" : "Start a reading plan"} />

      {empty ? (
        <section className="hm-section">
          <div className="hm-section-head">
            <h2>Get started</h2>
          </div>
          <div className="hm-steps">
            <Link className="hm-step" to="/read/John/1?v=John.1.1">
              <b>1</b>
              <strong>Tap a verse</strong>
              <span>Highlight it, write a note — it syncs to your account.</span>
            </Link>
            <Link className="hm-step" to="/read/John/1?v=John.1.1&t=words&w=G3056">
              <b>2</b>
              <strong>Open the Greek</strong>
              <span>Tap λόγος and see every place it occurs.</span>
            </Link>
            <Link className="hm-step" to="/read/John/1?v=John.1.18&t=text">
              <b>3</b>
              <strong>Compare manuscripts</strong>
              <span>“God” or “Son”? See how the oldest copies read John 1:18.</span>
            </Link>
            <button className="hm-step" onClick={() => openAsk(null, "Where did Paul go on his first journey? Show it on the map.")}>
              <b>4</b>
              <strong>Ask the assistant</strong>
              <span>It reads the library, opens the map and cites its sources.</span>
            </button>
          </div>
        </section>
      ) : (
        <section className="hm-section">
          <div className="hm-section-head">
            <h2>Your study</h2>
            <Link to="/notes">All notes →</Link>
          </div>
          <div className="hm-study">
            {kept.length > 0 && (
              <div className="hm-card">
                <span className="hm-eyebrow accent">Notes &amp; highlights</span>
                <ul className="hm-list">
                  {kept.slice(0, 5).map((n) => (
                    <li key={n.osis}>
                      <Link to={verseUrl(n.osis)}>
                        {n.highlight && <i className={`hm-dot hl-${n.highlight}`} />}
                        <b>{osisLabel(n.osis, books)}</b>
                        <span className="hm-snip">{n.text}</span>
                        <span className="hm-when">{ago(n.updated)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <div className="hm-colours">
                  {HIGHLIGHTS.map((h) => {
                    const c = kept.filter((n) => n.highlight === h.id).length;
                    return c ? (
                      <span key={h.id} className={`hm-chip hl-${h.id}`}>
                        <i className="hm-dot" /> {c}
                      </span>
                    ) : null;
                  })}
                </div>
              </div>
            )}
            {chats.length > 0 && (
              <div className="hm-card">
                <span className="hm-eyebrow accent">Conversations</span>
                <ul className="hm-list">
                  {chats.map((c) => (
                    <li key={c.id}>
                      <button className="hm-row" onClick={() => openAsk(null)}>
                        <b>{c.title}</b>
                        <span className="hm-when">{c.model ? `${c.model} · ` : ""}{ago(c.updated)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(pinned.length > 0 || sets.length > 0) && (
              <div className="hm-card">
                <span className="hm-eyebrow accent">Places</span>
                <ul className="hm-list">
                  {pinned.length > 0 && (
                    <li>
                      <button className="hm-row" onClick={() => openMap({ places: pinned, title: "Pinned places" })}>
                        <b>★ Pinned places</b>
                        <span className="hm-when">{pinned.length}</span>
                      </button>
                    </li>
                  )}
                  {sets.slice(0, 4).map((s) => (
                    <li key={s.id}>
                      <button className="hm-row" onClick={() => openMap({ places: s.places, title: s.name })}>
                        <b>{s.name}</b>
                        <span className="hm-when">{s.places.length} places</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}

      <section className="hm-section">
        <div className="hm-section-head">
          <h2>Explore</h2>
        </div>
        <div className="hm-explore">
          {[
            ["/read/John/1?v=John.1.18&t=text", "sinaiticus", "Manuscripts", "“God” or “Son” at John 1:18"],
            ["/read/John/1?v=John.1.1&t=fathers", "ignatius", "The church fathers", "Who quoted John 1:1 first"],
            ["/read/Acts/13", "titus", "Paul’s journeys", "Acts 13 on the map"],
            ["/parallels", "jerome", "Gospel parallels", "One story, four tellings"],
            ["/read/Tob/1", "leningrad", "The deuterocanon", "Tobit, Judith, Wisdom, Maccabees"],
            ["/library?view=story", "nicaea", "The story", "From the Temple to Nicaea"],
          ].map(([to, img, t, s]) => (
            <Link key={to} className="hm-tile" to={to!} style={{ backgroundImage: `url(/landing/${img}.jpg)` }}>
              <div>
                <strong>{t}</strong>
                <span>{s}</span>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
