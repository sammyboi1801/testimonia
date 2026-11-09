import { useMemo } from "react";
import { Link, Navigate } from "react-router-dom";
import { useChapter, useMeta } from "../api";
import { openAsk } from "../components/AskDrawer";
import { HIGHLIGHTS, useNotes } from "../notes";
import { openMap, usePins } from "../pins";
import { isoDate, loadProgress, usePlans } from "../readingApi";
import { lastReadingPath, osisLabel, verseUrl } from "../lib";
import { syncAvailable, useSync } from "../sync";
import "../landing.css";

/** The study desk, for a signed-in reader: back to the reading, today's plan, and everything you have kept. */

interface Chat {
  id: string;
  title: string;
  updated: string;
  model?: string;
  messages: { role: string }[];
}
function loadChats(): Chat[] {
  try {
    return (JSON.parse(localStorage.getItem("testimonia.ai.chats.v1") ?? "[]") as Chat[]).slice(0, 4);
  } catch {
    return [];
  }
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function ago(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days < 1 ? "today" : days === 1 ? "yesterday" : days < 7 ? `${days} days ago` : new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" });
}

/** The first verse of the chapter you were reading, as a preview card. */
function ContinueCard({ path }: { path: string }) {
  const m = /^\/read\/([^/]+)\/(\d+)/.exec(path);
  const book = m?.[1] ?? "John";
  const ch = Number(m?.[2] ?? 1);
  const meta = useMeta();
  const { data } = useChapter(book, ch, ["kjva", "web"]);
  const name = meta.data?.books.find((b) => b.osis === book)?.name ?? book;
  const first = data?.verses.find((v) => v.verse >= 1);
  const text = first?.texts.kjva?.text ?? first?.texts.web?.text;
  return (
    <Link className="hm-card hm-continue" to={path}>
      <span className="lp-kicker">Continue reading</span>
      <strong>
        {name} {ch}
      </strong>
      {data?.headings[0]?.title && <span className="hm-sub">{data.headings[0].title}</span>}
      {text && <p className="hm-quote">“{text.length > 180 ? `${text.slice(0, 180)}…` : text}”</p>}
      <span className="lp-link">Open {name} {ch} →</span>
    </Link>
  );
}

/** The reading plan you are on: today's portion and how far you are. */
function PlanCard() {
  const plans = usePlans();
  const active = useMemo(() => {
    for (const p of plans.data ?? []) {
      const prog = loadProgress(p.id);
      if (prog.start) return { plan: p, prog };
    }
    return null;
  }, [plans.data]);
  if (!active)
    return (
      <Link className="hm-card" to="/plans">
        <span className="lp-kicker">Reading plan</span>
        <strong>Start a reading plan</strong>
        <p className="hm-sub">A Gospel in a month, the Bible in a year, the Psalms — with your progress kept on every device.</p>
        <span className="lp-link">Choose a plan →</span>
      </Link>
    );
  const { plan, prog } = active;
  const total = plan.days || 1;
  const done = prog.done.length;
  const day = Math.min(total, Math.max(1, Math.floor((new Date(isoDate(new Date())).getTime() - new Date(prog.start!).getTime()) / 86_400_000) + 1));
  const pct = Math.round((100 * done) / total);
  return (
    <Link className="hm-card hm-plan" to={`/plans/${encodeURIComponent(plan.id)}`}>
      <span className="lp-kicker">Today’s reading</span>
      <div className="hm-plan-row">
        <svg viewBox="0 0 36 36" width="64" height="64" aria-hidden>
          <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--rule)" strokeWidth="3" />
          <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${(pct / 100) * 97.4} 97.4`} transform="rotate(-90 18 18)" />
          <text x="18" y="21" textAnchor="middle" fontSize="9" fill="var(--ink)">
            {pct}%
          </text>
        </svg>
        <div>
          <strong>{plan.title}</strong>
          <p className="hm-sub">
            Day {day} of {total} · {done} {done === 1 ? "day" : "days"} done
          </p>
        </div>
      </div>
      <span className="lp-link">Read day {day} →</span>
    </Link>
  );
}

export default function HomePage() {
  const sync = useSync();
  const { notes } = useNotes();
  const { pinned, sets } = usePins();
  const meta = useMeta();
  const books = meta.data?.books ?? [];
  const chats = useMemo(loadChats, []);

  const recent = useMemo(
    () =>
      Object.values(notes)
        .filter((n) => n.text || n.highlight)
        .sort((a, b) => b.updated.localeCompare(a.updated))
        .slice(0, 6),
    [notes],
  );
  const byColour = useMemo(() => {
    const c: Record<string, number> = {};
    for (const n of Object.values(notes)) if (n.highlight) c[n.highlight] = (c[n.highlight] ?? 0) + 1;
    return c;
  }, [notes]);
  const noteCount = Object.values(notes).filter((n) => n.text).length;
  const highlightCount = Object.values(notes).filter((n) => n.highlight).length;

  // the desk is for signed-in readers; wait for the sign-in check before deciding
  if (!syncAvailable) return <Navigate to={lastReadingPath()} replace />;
  if (!sync.ready) return <div className="page loading">Opening your desk…</div>;
  if (!sync.user) return <Navigate to="/" replace />;
  const first = (sync.user.name ?? sync.user.email ?? "").split(/[\s@]/)[0];

  return (
    <div className="lp hm">
      <section className="lp-section hm-head">
        <p className="lp-kicker">Your study desk</p>
        <h1>
          {greeting()}
          {first ? `, ${first}` : ""}.
        </h1>
        <p className="hm-sub">
          {noteCount} {noteCount === 1 ? "note" : "notes"} · {highlightCount} highlighted {highlightCount === 1 ? "verse" : "verses"} · {pinned.length} pinned{" "}
          {pinned.length === 1 ? "place" : "places"} — synced to your account
        </p>
        <div className="hm-quick">
          <Link className="lp-btn" to="/search">
            Search
          </Link>
          <button className="lp-btn" onClick={() => openAsk(null)}>
            ✦ Ask
          </button>
          <Link className="lp-btn" to="/library">
            Library
          </Link>
          <Link className="lp-btn" to="/atlas">
            Atlas
          </Link>
          <Link className="lp-btn" to="/library?view=timeline">
            Timeline
          </Link>
        </div>
      </section>

      <section className="lp-section hm-grid">
        <ContinueCard path={lastReadingPath()} />
        <PlanCard />
      </section>

      <section className="lp-section hm-grid three">
        {/* notes and highlights */}
        <div className="hm-card">
          <div className="hm-card-head">
            <span className="lp-kicker">Recent notes &amp; highlights</span>
            <Link to="/notes">All →</Link>
          </div>
          {recent.length === 0 ? (
            <p className="hm-sub">Tap a verse and choose a colour or Note — what you keep shows up here.</p>
          ) : (
            <ul className="hm-list">
              {recent.map((n) => (
                <li key={n.osis}>
                  <Link to={verseUrl(n.osis)}>
                    {n.highlight && <i className={`hm-dot hl-${n.highlight}`} />}
                    <b>{osisLabel(n.osis, books)}</b>
                    {n.text && <span className="hm-snip"> — {n.text.slice(0, 70)}</span>}
                    <span className="hm-when">{ago(n.updated)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {highlightCount > 0 && (
            <div className="hm-colours">
              {HIGHLIGHTS.filter((h) => byColour[h.id]).map((h) => (
                <span key={h.id} className={`hm-chip hl-${h.id}`}>
                  <i className="hm-dot" /> {byColour[h.id]}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* conversations */}
        <div className="hm-card">
          <div className="hm-card-head">
            <span className="lp-kicker">Your conversations</span>
            <button className="link-btn" onClick={() => openAsk(null)}>
              New →
            </button>
          </div>
          {chats.length === 0 ? (
            <p className="hm-sub">Ask the assistant about any passage — it reads the library and shows its sources.</p>
          ) : (
            <ul className="hm-list">
              {chats.map((c) => (
                <li key={c.id}>
                  <button className="hm-row" onClick={() => openAsk(null)}>
                    <b>{c.title}</b>
                    <span className="hm-when">
                      {c.model ? `${c.model} · ` : ""}
                      {ago(c.updated)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* places */}
        <div className="hm-card">
          <div className="hm-card-head">
            <span className="lp-kicker">Your places</span>
            <Link to="/atlas?pinned=1">Atlas →</Link>
          </div>
          {pinned.length === 0 && sets.length === 0 ? (
            <p className="hm-sub">Pin places on the map with ☆, or save a chapter’s places as a set, and they gather here.</p>
          ) : (
            <ul className="hm-list">
              {pinned.length > 0 && (
                <li>
                  <button className="hm-row" onClick={() => openMap({ places: pinned, title: "Pinned places" })}>
                    <b>★ Pinned places</b>
                    <span className="hm-when">{pinned.length}</span>
                  </button>
                </li>
              )}
              {sets.slice(0, 5).map((s) => (
                <li key={s.id}>
                  <button className="hm-row" onClick={() => openMap({ places: s.places, title: s.name })}>
                    <b>{s.name}</b>
                    <span className="hm-when">{s.places.length} places</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="lp-section hm-explore">
        <span className="lp-kicker">Keep exploring</span>
        <div className="hm-explore-row">
          <Link className="hm-tile" to="/read/John/1?v=John.1.18&t=text">
            <strong>Manuscripts</strong>
            <span>“God” or “Son” at John 1:18</span>
          </Link>
          <Link className="hm-tile" to="/read/John/1?v=John.1.1&t=fathers">
            <strong>The fathers</strong>
            <span>Who quoted John 1:1 first</span>
          </Link>
          <Link className="hm-tile" to="/read/Acts/13">
            <strong>Paul’s journeys</strong>
            <span>Acts 13 on the map</span>
          </Link>
          <Link className="hm-tile" to="/parallels">
            <strong>Gospel parallels</strong>
            <span>One story, four tellings</span>
          </Link>
          <Link className="hm-tile" to="/read/Tob/1">
            <strong>The deuterocanon</strong>
            <span>Tobit, Judith, Wisdom, the Maccabees</span>
          </Link>
        </div>
      </section>
    </div>
  );
}
