import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { WikiCard } from "../components/Wiki";
import { formatYear, osisLabel, verseUrl } from "../lib";
import { useMeta } from "../api";
import {
  CHRONOLOGIES,
  datesFor,
  reignRange,
  saveChronology,
  savedChronology,
  SHARED_LABEL,
  shortLabel,
  spanOf,
  useRulers,
  type ChronologySystem,
  type Realm,
  type ReignDates,
  type Ruler,
} from "../rulersApi";

type Range = [number, number];
/** Windows onto the chart (astronomical years: 1 BC = 0). */
const VIEWS: { id: string; label: string; range: Range }[] = [
  { id: "kings", label: "Israel & Judah", range: [-1059, -560] },
  { id: "empires", label: "Exile & Persia", range: [-760, -320] },
  { id: "hellenistic", label: "Maccabees", range: [-340, -25] },
  { id: "nt", label: "New Testament", range: [-45, 75] },
  { id: "rome", label: "Roman emperors", range: [-35, 400] },
  { id: "all", label: "Everything", range: [-1059, 400] },
];
const ROW = 26;
const LIMITS: Range = [-1059, 400];

function clampRange([a, b]: Range): Range {
  const span = Math.min(b - a, LIMITS[1] - LIMITS[0]);
  const start = Math.min(Math.max(a, LIMITS[0]), LIMITS[1] - span);
  return [start, start + span];
}

interface Placed {
  ruler: Ruler;
  system: string;
  d: ReignDates;
  row: number;
}

/** Greedy rows: overlapping reigns (coregencies, rivals, co-emperors) stack within their realm's lane; a reign
 * that begins in the year its predecessor's ends (one regnal year shared) stays on the same row. */
export function pack(items: Omit<Placed, "row">[]): Placed[] {
  const ends: number[] = [];
  return [...items]
    .sort((a, b) => spanOf(a.d)[0] - spanOf(b.d)[0] || spanOf(b.d)[1] - spanOf(a.d)[1])
    .map((it) => {
      const [a, b] = spanOf(it.d);
      let row = ends.findIndex((e) => e <= a);
      if (row < 0) row = ends.push(Math.max(b, a + 1)) - 1;
      else ends[row] = Math.max(b, a + 1);
      return { ...it, row };
    });
}

/** Axis ticks on round historical years (500 BC, 450 BC … AD 50), given astronomical bounds. */
export function ticks(lo: number, hi: number): number[] {
  const span = hi - lo;
  const step = [5, 10, 20, 25, 50, 100].find((s) => span / s <= 12) ?? 200;
  const out: number[] = [];
  for (let y = lo; y <= hi; y++) if ((y <= 0 ? 1 - y : y) % step === 0) out.push(y);
  return out;
}

/** Kings and rulers: realms as lanes on a time axis (a list on phones), chronologies switchable for Israel and Judah. */
export function RulersPage() {
  const { data, isLoading, error } = useRulers();
  const [params, setParams] = useSearchParams();
  const viewId = params.get("view") ?? "kings";
  const view = VIEWS.find((v) => v.id === viewId) ?? VIEWS[0]!;
  const sel = params.get("sel");
  const [system, setSystem] = useState<string>(() => params.get("system") ?? savedChronology() ?? "thiele");
  // zoom and pan within the chosen window; picking a window starts again from its full extent
  const [range, setRange] = useState<Range>(view.range);
  useEffect(() => {
    setRange(view.range);
  }, [view]);
  const zoom = (factor: number) =>
    setRange(([a, b]) => {
      const mid = (a + b) / 2;
      const half = Math.max(10, ((b - a) * factor) / 2);
      return clampRange([Math.round(mid - half), Math.round(mid + half)]);
    });
  const pan = (dir: number) => setRange(([a, b]) => clampRange([a + Math.round(((b - a) / 4) * dir), b + Math.round(((b - a) / 4) * dir)]));
  const set = (key: string, value: string | null) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (value) n.set(key, value);
        else n.delete(key);
        return n;
      },
      { replace: true },
    );
  const chooseSystem = (s: string) => {
    setSystem(s);
    saveChronology(s);
    set("system", s === "thiele" ? null : s);
  };

  // a ruler picked by link (?sel=hezekiah@judah) opens a window that shows it
  const selected = useMemo(() => {
    for (const realm of data?.realms ?? []) for (const r of realm.rulers) if (r.id === sel) return { realm, ruler: r };
    return null;
  }, [data, sel]);
  useEffect(() => {
    if (!selected || params.get("view")) return;
    const when = datesFor(selected.ruler, selected.realm, system);
    if (!when) return;
    const [a, b] = spanOf(when.d);
    const fit = VIEWS.find((v) => v.id !== "all" && v.range[0] <= a && b <= v.range[1]);
    if (fit && fit.id !== view.id) set("view", fit.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  if (isLoading) return <div className="loading">Loading rulers…</div>;
  if (error || !data) return <div className="error">Could not load the rulers: {String(error)}</div>;

  const [lo, hi] = range;
  const realms = data.realms.filter((r) => r.start <= hi && r.end >= lo);
  const names = Object.fromEntries(data.systems.map((s) => [s.id, s]));
  const pick = (ruler: Ruler | null) => set("sel", ruler && ruler.id !== sel ? ruler.id : null);

  return (
    <div className="page rl-page">
      <Link to="/library" className="book-back">
        ← Library
      </Link>
      <header className="rl-head">
        <h1>Kings &amp; rulers</h1>
        <p className="rl-intro">
          Who reigned when, from Saul to Theodosius: Israel and Judah, the empires over them, the Hasmoneans and Herods, Rome and its governors, and the
          high priests. Dates are approximate where marked; for the kings of Israel and Judah scholars reconstruct the years differently, so you can switch
          between their chronologies.
        </p>
      </header>

      <div className="rl-controls">
        <div className="seg rl-views" role="tablist" aria-label="Period">
          {VIEWS.map((v) => (
            <button key={v.id} className={v.id === view.id ? "on" : ""} onClick={() => set("view", v.id === "kings" ? null : v.id)}>
              {v.label}
            </button>
          ))}
        </div>
        <div className="rl-systems">
          <span className="muted small">Israel &amp; Judah:</span>
          <div className="seg" role="radiogroup" aria-label="Chronology of the kings of Israel and Judah">
            {CHRONOLOGIES.map((s) => (
              <button key={s} role="radio" aria-checked={system === s} className={system === s ? "on" : ""} title={names[s]?.description ?? ""} onClick={() => chooseSystem(s)}>
                {(names[s]?.name ?? s).replace(/\s*\(.*\)$/, "")}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={`rl-body${selected ? " with-detail" : ""}`}>
        <div className="rl-main">
          <div className="rl-zoom" aria-label="Zoom and move">
            <button className="chip" onClick={() => pan(-1)} title="Earlier" aria-label="Earlier">
              ←
            </button>
            <button className="chip" onClick={() => zoom(0.6)} title="Zoom in" aria-label="Zoom in">
              +
            </button>
            <button className="chip" onClick={() => zoom(1.6)} title="Zoom out" aria-label="Zoom out">
              −
            </button>
            <button className="chip" onClick={() => pan(1)} title="Later" aria-label="Later">
              →
            </button>
            <span className="muted small">
              {formatYear(lo)} – {formatYear(hi)}
            </span>
          </div>
          <Chart realms={realms} range={range} system={system} sel={sel} onPick={pick} />
          <RulerList realms={realms} range={range} system={system} sel={sel} onPick={pick} systems={names} />
          <p className="muted small rl-foot">
            {names[system]?.name}: {names[system]?.description} Other realms follow one standard chronology (sources on each ruler). Bars with stripes mark a
            coregency or rival reign before a king reigned alone.
          </p>
        </div>
        {selected && (
          <aside className="rl-detail-side" aria-label="Ruler">
            <RulerDetail ruler={selected.ruler} realm={selected.realm} system={system} systems={names} onClose={() => pick(null)} />
          </aside>
        )}
      </div>
    </div>
  );
}

function Chart({ realms, range, system, sel, onPick }: { realms: Realm[]; range: Range; system: string; sel: string | null; onPick: (r: Ruler) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setWidth(el.clientWidth);
    });
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => {
      ro.disconnect();
    };
  }, []);
  const [lo, hi] = range;
  const span = hi + 1 - lo;
  const pct = (y: number) => ((y - lo) / span) * 100;
  const marks = ticks(lo, hi);

  // at least ~3 px a year, so reigns keep room for their names; wider periods scroll sideways
  const minWidth = 168 + span * 3;
  return (
    <div className="rl-chart" role="group" aria-label="Rulers on a time axis">
      <div className="rl-chart-inner" style={{ width: `max(100%, ${minWidth}px)` }}>
      <div className="rl-axis-row">
        <span className="rl-lane-name" />
        <div className="rl-axis" ref={box}>
          {marks.map((t) => (
            <span key={t} className="rl-tick" style={{ left: `${pct(t)}%` }}>
              {t === 0 ? "1 BC" : formatYear(t)}
            </span>
          ))}
        </div>
      </div>
      {realms.map((realm) => {
        const items = pack(
          realm.rulers.flatMap((ruler) => {
            const when = datesFor(ruler, realm, system);
            if (!when) return [];
            const [a, b] = spanOf(when.d);
            return a <= range[1] && b >= range[0] ? [{ ruler, system: when.system, d: when.d }] : [];
          }),
        );
        const rows = Math.max(1, ...items.map((i) => i.row + 1));
        const multi = realm.systems.length > 1;
        // a name may run past its bar while the row is free up to the next reign
        const room = new Map<string, number>();
        for (const it of items) {
          const next = items
            .filter((o) => o.row === it.row && spanOf(o.d)[0] > spanOf(it.d)[0])
            .reduce((m, o) => Math.min(m, spanOf(o.d)[0]), hi + 1);
          room.set(it.ruler.id, ((Math.min(next, hi + 1) - Math.max(spanOf(it.d)[0], lo)) / span) * width);
        }
        return (
          <div key={realm.id} className="rl-lane">
            <div className="rl-lane-name" title={realm.description ?? ""}>
              {realm.name}
              {multi && <small>{realm.systems.includes(system) ? system.charAt(0).toUpperCase() + system.slice(1) : "conventional"}</small>}
            </div>
            <div className="rl-track" style={{ height: rows * ROW }}>
              {marks.map((t) => (
                <span key={t} className="rl-grid" style={{ left: `${pct(t)}%` }} />
              ))}
              {items.map(({ ruler, d, row }) => {
                const [a, b] = spanOf(d);
                const stop = Math.max(b, a + 1); // a reign within one year still gets a year's width
                const left = Math.max(0, pct(a));
                const right = Math.min(100, pct(stop));
                const px = room.get(ruler.id) ?? 0;
                const shared = d.shared_from !== null ? ((d.start - d.shared_from) / (stop - a)) * 100 : 0;
                const full = ruler.name.replace(/\s*\(.*\)$/, "");
                const short = full.split(" ").filter((w) => !/^[IVX]+$/.test(w)).pop() ?? full; // "Pilate", not "III"
                const label = [full, short].find((t) => px > t.length * 6.6 + 10) ?? "";
                return (
                  <button
                    key={ruler.id}
                    className={`rl-bar k-${realm.kind}${d.circa ? " circa" : ""}${ruler.id === sel ? " on" : ""}`}
                    style={{ left: `${left}%`, width: `${right - left}%`, top: row * ROW + 2 }}
                    title={`${ruler.name} · ${shortLabel(d)}`}
                    aria-label={`${ruler.name}, ${shortLabel(d)}`}
                    onClick={() => onPick(ruler)}
                  >
                    {shared > 0 && <i className="rl-shared" style={{ width: `${Math.min(shared, 100)}%` }} />}
                    {label && <span>{label}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}

/** Phones: the same reigns as a plain list, realm by realm. */
function RulerList({
  realms,
  range,
  system,
  sel,
  onPick,
  systems,
}: {
  realms: Realm[];
  range: Range;
  system: string;
  sel: string | null;
  onPick: (r: Ruler | null) => void;
  systems: Record<string, ChronologySystem>;
}) {
  return (
    <div className="rl-list">
      {realms.map((realm) => {
        const rows = realm.rulers.flatMap((ruler) => {
          const when = datesFor(ruler, realm, system);
          if (!when) return [];
          const [a, b] = spanOf(when.d);
          return a <= range[1] && b >= range[0] ? [{ ruler, when }] : [];
        });
        return (
          <section key={realm.id} className="rl-list-realm">
            <h2>{realm.name}</h2>
            <ul>
              {rows.map(({ ruler, when }) => (
                <li key={ruler.id} className={ruler.id === sel ? "on" : ""}>
                  <button className="rl-list-row" aria-expanded={ruler.id === sel} onClick={() => onPick(ruler)}>
                    <span className="rl-list-name">{ruler.name}</span>
                    <span className="rl-list-dates">{shortLabel(when.d)}</span>
                  </button>
                  {ruler.id === sel && (
                    <div className="rl-list-detail">
                      <RulerDetail ruler={ruler} realm={realm} system={system} systems={systems} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function RulerDetail({
  ruler,
  realm,
  system,
  systems,
  onClose,
}: {
  ruler: Ruler;
  realm: Realm;
  system: string;
  systems: Record<string, ChronologySystem>;
  onClose?: () => void;
}) {
  const books = useMeta().data?.books;
  const when = datesFor(ruler, realm, system);
  const order = [...realm.systems, ...Object.keys(ruler.dates).filter((s) => !realm.systems.includes(s)).sort((a, b) => Number(a === "wikidata") - Number(b === "wikidata"))];
  const rows = order.filter((s) => ruler.dates[s]);
  return (
    <div className="rl-detail">
      {onClose && (
        <button className="icon-btn rl-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      )}
      <h2>{ruler.name}</h2>
      <div className="sub">
        {ruler.office} · {realm.name}
        {ruler.dynasty && ` · ${ruler.dynasty}`}
      </div>
      {when && (
        <p className="rl-when">
          {fullLabel(when.d)} <span className="muted small">({systems[when.system]?.name ?? when.system})</span>
          {when.d.shared_from !== null && !when.d.label && (
            <span className="muted small">
              {" "}
              — {SHARED_LABEL[when.d.shared_kind ?? "coregency"]} from {formatYear(when.d.shared_from)}
            </span>
          )}
        </p>
      )}
      {ruler.note && <p className="rl-note">{ruler.note}</p>}
      {rows.length > 1 && (
        <table className="rl-systems-table">
          <caption className="muted small">Reign by chronology</caption>
          <tbody>
            {rows.map((s) => (
              <tr key={s} className={s === when?.system ? "on" : ""}>
                <th scope="row">{(systems[s]?.name ?? s).replace(/\s*\(.*\)$/, "")}</th>
                <td>{shortLabel(ruler.dates[s]!)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {when?.d.basis && <p className="muted small rl-source">Source: {when.d.basis}</p>}
      <p className="rl-links">
        <Link to={`/person/${encodeURIComponent(ruler.person_id)}`}>
          {ruler.verses > 0 ? `Named in ${ruler.verses.toLocaleString()} verse${ruler.verses === 1 ? "" : "s"} →` : "Person page →"}
        </Link>
        {ruler.first_osis && (
          <Link to={verseUrl(ruler.first_osis)} className="muted small">
            first: {osisLabel(ruler.first_osis, books)}
          </Link>
        )}
      </p>
      {ruler.wikipedia && <WikiCard title={ruler.wikipedia} />}
    </div>
  );
}

function fullLabel(d: ReignDates): string {
  if (d.label) return /BC|AD/.test(d.label) || d.start > 0 ? d.label : `${d.label} BC`;
  return reignRange(d.start, d.end, d.circa);
}
