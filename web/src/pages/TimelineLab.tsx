import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTimeline } from "../api";
import { formatYear } from "../lib";
import { useRulers, type Ruler } from "../rulersApi";
import type { Timeline } from "../types";
import "../timeline-lab.css";

/** Prototype: two calmer ways to read the timeline, on the real data, for choosing a design. */

const FROM = -1050;
const TO = 500;
const STEP = 10;

interface Decade {
  start: number;
  rulersNew: { name: string; realm: string }[];
  ruling: { name: string; realm: string }[];
  events: { id: string; title: string; major: boolean; wikipedia: string | null }[];
  writersNew: { id: string; name: string }[];
  writersAlive: { id: string; name: string }[];
  works: { id: string; title: string; author: string | null; edition: string | null }[];
}

function decadeLabel(y: number): string {
  if (y >= 0) return `AD ${y === 0 ? 1 : y}s`;
  return `${-y}s BC`;
}

function build(t: Timeline, realms: { short: string; kind: string; rulers: Ruler[] }[]): Decade[] {
  const names = new Map(t.authors.map((a) => [a.id, a.name]));
  const out: Decade[] = [];
  const reigns = realms.flatMap((r) =>
    r.rulers.filter((x) => x.start !== null && x.end !== null).map((x) => ({ ...x, realmShort: r.short, overlord: r.kind === "overlord" })),
  );
  for (let y = FROM; y < TO; y += STEP) {
    const end = y + STEP;
    const within = (a: number | null) => a !== null && a >= y && a < end;
    const d: Decade = {
      start: y,
      rulersNew: reigns.filter((r) => within(r.start)).map((r) => ({ name: r.name, realm: r.realmShort })),
      ruling: reigns.filter((r) => r.start! < end && r.end! >= y).map((r) => ({ name: r.name, realm: r.realmShort })),
      events: t.events.filter((e) => within(e.start)).map((e) => ({ id: e.id, title: e.title, major: e.major, wikipedia: e.wikipedia })),
      writersNew: t.authors
        .filter((a) => within(a.floruit_from ?? (a.born !== null ? a.born + 25 : a.died !== null ? a.died - 20 : null)))
        .map((a) => ({ id: a.id, name: a.name })),
      writersAlive: t.authors
        .filter((a) => {
          const s = a.born ?? a.floruit_from ?? (a.died !== null ? a.died - 50 : null);
          const e = a.died ?? a.floruit_to ?? (s !== null ? s + 50 : null);
          return s !== null && e !== null && s < end && e >= y;
        })
        .map((a) => ({ id: a.id, name: a.name })),
      works: t.works
        .filter((w) => within(w.date_from))
        .sort((a, b) => b.citations - a.citations)
        .map((w) => ({ id: w.id, title: w.title, author: w.author_id ? (names.get(w.author_id) ?? null) : null, edition: w.edition_id })),
    };
    out.push(d);
  }
  return out;
}

const busy = (d: Decade) => d.rulersNew.length + d.events.length + d.writersNew.length + d.works.length > 0;

export function TimelineLab() {
  const tl = useTimeline();
  const rulers = useRulers();
  const [mode, setMode] = useState<"river" | "cards">("river");
  const decades = useMemo(
    () => (tl.data && rulers.data ? build(tl.data, rulers.data.realms) : []),
    [tl.data, rulers.data],
  );
  if (!decades.length) return <div className="page loading">Loading the timeline…</div>;
  return (
    <div className="tlx">
      <header className="tlx-head">
        <div className="tlx-title">
          <h1>Timeline</h1>
          <span className="tlx-proto">prototype</span>
        </div>
        <div className="seg tlx-switch" role="tablist">
          <button className={mode === "river" ? "on" : ""} onClick={() => setMode("river")}>
            A · River
          </button>
          <button className={mode === "cards" ? "on" : ""} onClick={() => setMode("cards")}>
            B · Cards
          </button>
        </div>
      </header>
      {mode === "river" ? <River decades={decades} /> : <Cards decades={decades.filter(busy)} />}
    </div>
  );
}

// ----------------------------------------------------------------------------- A · river

function River({ decades }: { decades: Decade[] }) {
  const centuries = useMemo(() => {
    const seen: number[] = [];
    for (const d of decades) {
      const c = Math.floor(d.start / 100) * 100;
      if (!seen.includes(c)) seen.push(c);
    }
    return seen;
  }, [decades]);
  const rows: React.ReactNode[] = [];
  let quiet = 0;
  let century: number | null = null;
  const flushQuiet = (key: string) => {
    if (quiet) rows.push(<div key={key} className="river-quiet">· {quiet * STEP} quiet years ·</div>);
    quiet = 0;
  };
  for (const d of decades) {
    const c = Math.floor(d.start / 100) * 100;
    if (c !== century) {
      flushQuiet(`q${d.start}`);
      century = c;
      rows.push(
        <h2 key={`c${c}`} id={`cent${c}`} className="river-century">
          {c >= 0 ? `${c / 100 + 1}${["st", "nd", "rd"][c / 100] ?? "th"} century AD` : `${-c / 100}${["st", "nd", "rd"][-c / 100 - 1] ?? "th"} century BC`}
          <span>{d.ruling.slice(0, 3).map((r) => r.name).join(" · ")}</span>
        </h2>,
      );
    }
    if (!busy(d)) {
      quiet++;
      continue;
    }
    flushQuiet(`q${d.start}`);
    rows.push(
      <article key={d.start} className="river-row">
        <div className="river-year">{decadeLabel(d.start)}</div>
        <div className="river-body">
          {d.events.map((e) => (
            <p key={e.id} className={`rv-event${e.major ? " major" : ""}`}>
              {e.title}
            </p>
          ))}
          {d.rulersNew.length > 0 && (
            <p className="river-line rv-rulers">
              <i>Rules</i> {d.rulersNew.map((r) => `${r.name} (${r.realm})`).join(" · ")}
            </p>
          )}
          {d.writersNew.length > 0 && (
            <p className="river-line rv-writers">
              <i>Writing</i>{" "}
              {d.writersNew.map((w, i) => (
                <span key={w.id}>
                  {i > 0 && " · "}
                  <Link to={`/library?view=timeline&sel=a:${w.id}`}>{w.name}</Link>
                </span>
              ))}
            </p>
          )}
          {d.works.length > 0 && (
            <p className="river-line rv-works">
              <i>Written</i>{" "}
              {d.works.slice(0, 3).map((w, i) => (
                <span key={w.id}>
                  {i > 0 && " · "}
                  {w.edition ? <Link to={`/library/${encodeURIComponent(w.edition)}/1`}>{w.title}</Link> : w.title}
                </span>
              ))}
              {d.works.length > 3 && <span className="muted"> +{d.works.length - 3}</span>}
            </p>
          )}
        </div>
      </article>,
    );
  }
  flushQuiet("qend");
  return (
    <div className="river">
      <div className="river-list">{rows}</div>
      <nav className="river-scrub" aria-label="Jump to a century">
        {centuries.map((c) => (
          <button key={c} onClick={() => document.getElementById(`cent${c}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}>
            {c === 0 ? "1" : c > 0 ? c : `${-c}`}
            {c < 0 && <small>BC</small>}
          </button>
        ))}
      </nav>
    </div>
  );
}

// ----------------------------------------------------------------------------- B · cards

function Cards({ decades }: { decades: Decade[] }) {
  const [i, setI] = useState(() => Math.max(0, decades.findIndex((d) => d.start >= 0)));
  const strip = useRef<HTMLDivElement>(null);
  const go = (n: number) => {
    const k = Math.max(0, Math.min(decades.length - 1, n));
    setI(k);
    strip.current?.children[k]?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  };
  const d = decades[i]!;
  return (
    <div className="cd">
      <div className="cd-scale">
        <span>{formatYear(decades[0]!.start)}</span>
        <input type="range" min={0} max={decades.length - 1} value={i} onChange={(e) => go(Number(e.target.value))} aria-label="Move through time" />
        <span>AD {TO}</span>
      </div>
      <div
        className="cd-strip"
        ref={strip}
        onScroll={(e) => {
          const box = e.currentTarget;
          const k = Math.round(box.scrollLeft / box.clientWidth);
          if (k !== i && k >= 0 && k < decades.length) setI(k);
        }}
      >
        {decades.map((x) => (
          <section key={x.start} className="cd-card">
            <header>
              <div className="cd-when">What was going on</div>
              <h2>{decadeLabel(x.start)}</h2>
            </header>
            {x.ruling.length > 0 && (
              <Group title="Ruling">
                {x.ruling.slice(0, 6).map((r) => (
                  <li key={r.name + r.realm}>
                    {r.name} <span className="muted">· {r.realm}</span>
                  </li>
                ))}
                {x.ruling.length > 6 && <li className="muted">+{x.ruling.length - 6} more</li>}
              </Group>
            )}
            {x.events.length > 0 && (
              <Group title="Happening">
                {x.events.map((e) => (
                  <li key={e.id} className={e.major ? "major" : ""}>
                    {e.title}
                  </li>
                ))}
              </Group>
            )}
            {x.writersAlive.length > 0 && (
              <Group title="Writers alive">
                <li className="cd-inline">{x.writersAlive.map((w) => w.name).join(" · ")}</li>
              </Group>
            )}
            {x.works.length > 0 && (
              <Group title="Written">
                {x.works.slice(0, 5).map((w) => (
                  <li key={w.id}>
                    {w.edition ? <Link to={`/library/${encodeURIComponent(w.edition)}/1`}>{w.title}</Link> : w.title}
                    {w.author && <span className="muted"> · {w.author}</span>}
                  </li>
                ))}
              </Group>
            )}
          </section>
        ))}
      </div>
      <div className="cd-nav">
        <button className="btn" onClick={() => go(i - 1)} disabled={i === 0}>
          ‹ Earlier
        </button>
        <span className="muted small">
          {i + 1} / {decades.length}
        </span>
        <button className="btn" onClick={() => go(i + 1)} disabled={i === decades.length - 1}>
          Later ›
        </button>
      </div>
      <p className="muted small cd-tip">Swipe the card, drag the slider, or use the buttons. Only decades where something happened are shown. Now: {decadeLabel(d.start)}.</p>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="cd-group">
      <h3>{title}</h3>
      <ul>{children}</ul>
    </div>
  );
}
