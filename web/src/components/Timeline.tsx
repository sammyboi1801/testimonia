import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTimeline } from "../api";
import { CATEGORY_LABELS, ERA_LABELS, formatYear } from "../lib";
import { datesFor, shortLabel, spanOf, useRulers, type Realm, type ReignDates, type Ruler, type Rulers } from "../rulersApi";
import type { Timeline, TimelineAuthor, TimelineEvent, TimelineWork } from "../types";
import { WikiCard } from "./Wiki";

type Range = [number, number];
/** Each preset picks a period and only the layers that matter for it, so the timeline stays uncluttered. */
const PRESETS: { label: string; range: Range; layers: string[] }[] = [
  { label: "Kings of Israel", range: [-1060, -530], layers: ["events", "rulers"] },
  { label: "Exile to Maccabees", range: [-620, -100], layers: ["events", "rulers"] },
  { label: "New Testament", range: [-45, 110], layers: ["events", "rulers", "outside", "fathers"] },
  { label: "Jesus to Nicaea", range: [-40, 345], layers: ["events", "fathers", "outside"] },
  { label: "First five centuries", range: [-60, 520], layers: ["events", "fathers"] },
  { label: "Everything", range: [-1060, 1320], layers: ["events", "rulers", "fathers"] },
];
const DEFAULT_PRESET = 3; // Jesus to Nicaea
const LAYERS: { id: string; label: string }[] = [
  { id: "events", label: "Events" },
  { id: "rulers", label: "Kings & rulers" },
  { id: "fathers", label: "Church fathers" },
  { id: "outside", label: "Jewish & Roman writers" },
  { id: "anonymous", label: "Anonymous writings & councils" },
];
const LIMITS: Range = [-1080, 1330];
const LANE = 26;

type Item =
  | { kind: "author"; id: string; a: TimelineAuthor; start: number; end: number; label: string }
  | { kind: "work"; id: string; w: TimelineWork; start: number; end: number; label: string }
  | { kind: "event"; id: string; e: TimelineEvent; start: number; end: number; label: string }
  | { kind: "ruler"; id: string; r: Ruler; realm: Realm; d: ReignDates; start: number; end: number; label: string };

interface Group {
  id: string;
  label: string;
  items: Item[];
}

function groups(t: Timeline): Group[] {
  const outside = (a: TimelineAuthor) => a.tradition === "jewish" || a.tradition === "pagan";
  const author = (a: TimelineAuthor): Item => ({
    kind: "author",
    id: `a:${a.id}`,
    a,
    start: a.born ?? a.floruit_from ?? a.floruit_to ?? a.died ?? 0,
    end: a.died ?? a.floruit_to ?? a.floruit_from ?? a.born ?? 0,
    label: a.name,
  });
  const work = (w: TimelineWork): Item => ({ kind: "work", id: `w:${w.id}`, w, start: w.date_from ?? 0, end: w.date_to ?? w.date_from ?? 0, label: w.title });
  return [
    { id: "outside", label: "Jewish & Roman writers", items: t.authors.filter(outside).map(author) },
    { id: "fathers", label: "Church fathers", items: t.authors.filter((a) => !outside(a)).map(author) },
    { id: "anonymous", label: "Anonymous writings & councils", items: t.works.map(work) },
  ];
}

/** Kings, emperors and governors (from /rulers; loaded when the layer is on). Collapsed: two lanes, the land's own
 *  rulers and the empires over it. Expanded: one lane per realm. */
function rulersGroups(data: Rulers | undefined, expanded: boolean): Group[] {
  const item = (realm: Realm, r: Ruler): Item | null => {
    const when = datesFor(r, realm, null);
    if (!when) return null;
    const [start, end] = spanOf(when.d);
    return { kind: "ruler", id: `r:${r.id}`, r, realm, d: when.d, start, end, label: r.name.replace(/\s*\(.*\)$/, "") };
  };
  const realms = data?.realms ?? [];
  if (expanded) {
    return realms.map((realm) => ({
      id: `rulers:${realm.id}`,
      label: realm.name,
      items: realm.rulers.map((r) => item(realm, r)).filter((x): x is Item => x !== null),
    }));
  }
  const of = (kind: string) => realms.filter((r) => r.kind === kind).flatMap((realm) => realm.rulers.map((r) => item(realm, r)));
  return [
    { id: "rulers:local", label: "Kings & governors", items: of("local").filter((x): x is Item => x !== null) },
    { id: "rulers:empires", label: "Empires", items: of("overlord").filter((x): x is Item => x !== null) },
  ];
}

/** Greedy lane packing on the current scale: an item reaches from its start to the end of its label. */
function pack(items: Item[], x: (y: number) => number): { item: Item; lane: number }[] {
  const ends: number[] = [];
  return [...items]
    .sort((a, b) => a.start - b.start || b.end - a.end)
    .map((item) => {
      const left = x(item.start);
      const labelPx = item.label.length * (item.kind === "event" ? 6.6 : 7.4) + (item.kind === "author" ? 26 : 16);
      const right = Math.max(x(item.end), left + 4) + labelPx;
      let lane = ends.findIndex((e) => e + 8 <= left);
      if (lane < 0) lane = ends.push(right) - 1;
      else ends[lane] = right;
      return { item, lane };
    });
}

function tickStep(span: number, width: number): number {
  const perPx = span / Math.max(width, 1);
  for (const s of [1, 2, 5, 10, 25, 50, 100, 200]) if (s / perPx >= 70) return s;
  return 500;
}

function lifeLabel(a: TimelineAuthor): string {
  const c = (aspect: string) => (a.circa.includes(aspect) ? "c. " : "");
  if (a.born !== null && a.died !== null) return `${c("birth")}${formatYear(a.born)} – ${c("death")}${a.died}`;
  if (a.died !== null) return `died ${c("death")}${formatYear(a.died)}`;
  if (a.floruit_from !== null && a.floruit_to !== null && a.floruit_from !== a.floruit_to)
    return `active ${c("floruit")}${formatYear(a.floruit_from)} – ${a.floruit_to}`;
  return `active ${c("floruit")}${formatYear(a.floruit_to ?? a.floruit_from)}`;
}

function rangeLabel(start: number | null, end: number | null, circa: boolean): string {
  if (start === null) return "";
  const c = circa ? "c. " : "";
  return start === end || end === null ? `${c}${formatYear(start)}` : `${c}${formatYear(start)} – ${end <= 0 ? formatYear(end) : end}`;
}

function itemDates(item: Item): string {
  if (item.kind === "author") return lifeLabel(item.a);
  if (item.kind === "work") return rangeLabel(item.w.date_from, item.w.date_to, true);
  if (item.kind === "ruler") return shortLabel(item.d);
  return rangeLabel(item.e.start, item.e.end, !!item.e.circa);
}

function itemNote(item: Item): string | null {
  if (item.kind === "author") return item.a.summary;
  if (item.kind === "work") return item.w.summary ?? CATEGORY_LABELS[item.w.category] ?? null;
  if (item.kind === "ruler") return `${item.r.office} · ${item.realm.name}`;
  return item.e.description;
}

function clamp([a, b]: Range): Range {
  const s = Math.min(Math.max(b - a, 12), LIMITS[1] - LIMITS[0]);
  let lo = Math.max(LIMITS[0], Math.min(a, LIMITS[1] - s));
  if (lo + s > LIMITS[1]) lo = LIMITS[1] - s;
  return [lo, lo + s];
}

const ease = (t: number) => 1 - (1 - t) ** 3;

export function TimelineView() {
  const { data, isLoading, error } = useTimeline();
  const [range, setRange] = useState<Range>(PRESETS[DEFAULT_PRESET]!.range);
  const [selected, setSelected] = useState<Item | null>(null);
  const [hover, setHover] = useState<{ item: Item; x: number; y: number } | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const cursor = useRef<HTMLSpanElement>(null);
  // which layers are on (events, rulers, fathers, outside, anonymous); presets set them, the Layers menu adjusts
  const [layers, setLayers] = useState<Set<string>>(new Set(PRESETS[DEFAULT_PRESET]!.layers));
  const [allRealms, setAllRealms] = useState(false);
  const rulers = useRulers(layers.has("rulers"));
  const showEvents = layers.has("events");
  const toggleLayer = (id: string) =>
    setLayers((h) => {
      const n = new Set(h);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const [find, setFind] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const drag = useRef<{ x: number; y: number; range: Range; top: number; moved: boolean } | null>(null);
  const anim = useRef<number | undefined>(undefined);
  const rangeRef = useRef(range);
  const frame = useRef<number | null>(null);
  // a render only catches up with the latest range when no wheel/drag update is waiting for its frame
  if (frame.current === null) rangeRef.current = range;
  /** Move the view now (for the next event's maths) and draw it once per animation frame, not once per event. */
  const queueRange = useCallback((r: Range) => {
    rangeRef.current = clamp(r);
    if (frame.current !== null) return;
    frame.current = window.requestAnimationFrame(() => {
      frame.current = null;
      setRange(rangeRef.current);
    });
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [data]);

  /** Glide to a new window (presets, eras, search) instead of jumping. */
  const animateTo = useCallback((target: Range) => {
    window.cancelAnimationFrame(anim.current ?? 0);
    const from = rangeRef.current;
    const to = clamp(target);
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / 380);
      const k = ease(t);
      setRange([from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k]);
      if (t < 1) anim.current = window.requestAnimationFrame(tick);
    };
    anim.current = window.requestAnimationFrame(tick);
  }, []);

  const [from, to] = range;
  const span = to - from;
  const x = (y: number) => ((y - from) / span) * width;
  const yearAt = (px: number) => from + (px / width) * span;
  const all = useMemo(
    () => (data ? [...(layers.has("rulers") ? rulersGroups(rulers.data, allRealms) : []), ...groups(data).filter((g) => layers.has(g.id))] : []),
    [data, rulers.data, layers, allRealms],
  );
  const everything = useMemo(() => all.flatMap((g) => g.items), [all]);
  const milestones = useMemo(() => (data?.events ?? []).filter((e) => e.major), [data]);
  const minorEvents = useMemo(() => (data?.events ?? []).filter((e) => !e.major), [data]);
  // how much of an author the library holds (Scripture citations + works): decides who shows when zoomed out
  const weight = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of data?.authors ?? []) m.set(`a:${a.id}`, a.works.reduce((n, w) => n + w.citations, 0) + a.works.length * 40);
    for (const w of data?.works ?? []) m.set(`w:${w.id}`, w.citations + 40);
    // rulers: the ones Scripture names first, then the longest reigns
    for (const realm of rulers.data?.realms ?? []) for (const r of realm.rulers) m.set(`r:${r.id}`, r.verses * 20 + ((r.end ?? 0) - (r.start ?? 0)));
    return m;
  }, [data, rulers.data]);

  // ?sel=a:josephus (author), w:<work id> or e:<event id> opens that item — links can point at a person or event
  const [params, setParams] = useSearchParams();
  const sel = params.get("sel");
  const focus = useCallback(
    (item: Item, zoom = false) => {
      setSelected(item);
      const r = rangeRef.current;
      const mid = (item.start + item.end) / 2;
      const s = zoom ? Math.max(item.end - item.start + 80, 160) : r[1] - r[0];
      if (zoom || mid < r[0] || mid > r[1]) animateTo([mid - s / 2, mid + s / 2]);
    },
    [animateTo],
  );
  useEffect(() => {
    if (!sel || !everything.length) return;
    const item = everything.find((i) => i.id === sel) ?? milestoneItem(data?.events ?? [], sel);
    if (item && item.id !== selected?.id) focus(item);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, everything]);
  const choose = (item: Item | null) => {
    setSelected(item);
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (item) n.set("sel", item.id);
        else n.delete("sel");
        return n;
      },
      { replace: true },
    );
  };

  // the wheel zooms around the pointer (needs a non-passive listener to stop the page from scrolling)
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const r = rangeRef.current;
      const rect = el.getBoundingClientRect();
      const w = rect.width;
      if (!(e.ctrlKey || e.metaKey)) {
        // plain wheel scrolls the rows as usual; sideways (trackpad) or Shift + wheel moves through time
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
          e.preventDefault();
          const d = ((e.shiftKey ? e.deltaY : e.deltaX) / w) * (r[1] - r[0]);
          queueRange([r[0] + d, r[1] + d]);
        }
        return;
      }
      e.preventDefault(); // Ctrl + wheel (and trackpad pinch) zooms around the pointer
      window.cancelAnimationFrame(anim.current ?? 0);
      const at = r[0] + ((e.clientX - rect.left) / w) * (r[1] - r[0]);
      const f = Math.exp(Math.max(-0.5, Math.min(0.5, e.deltaY * 0.0015)));
      queueRange([at - (at - r[0]) * f, at + (r[1] - at) * f]);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [data]);

  function zoom(factor: number) {
    const at = (from + to) / 2;
    animateTo([at - (at - from) * factor, at + (to - at) * factor]);
  }
  function onKey(e: RKeyboardEvent) {
    const step = span * 0.15;
    if (e.key === "ArrowLeft") animateTo([from - step, to - step]);
    else if (e.key === "ArrowRight") animateTo([from + step, to + step]);
    else if (e.key === "+" || e.key === "=") zoom(1 / 1.5);
    else if (e.key === "-" || e.key === "_") zoom(1.5);
    else if (e.key === "Escape") choose(null);
    else return;
    e.preventDefault();
  }
  function onPointerDown(e: RPointerEvent) {
    if (e.button !== 0) return;
    window.cancelAnimationFrame(anim.current ?? 0);
    drag.current = { x: e.clientX, y: e.clientY, range, top: body.current?.scrollTop ?? 0, moved: false };
  }
  function onPointerMove(e: RPointerEvent) {
    const rect = box.current!.getBoundingClientRect();
    const c = cursor.current;
    if (c) {
      const px = e.clientX - rect.left;
      c.style.display = drag.current?.moved ? "none" : "block";
      c.style.transform = `translateX(${px}px)`;
      c.firstElementChild!.textContent = formatYear(Math.round(yearAt(px)));
    }
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) > 4) {
      d.moved = true;
      window.clearTimeout(hoverTimer.current);
      setHover(null);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    if (d.moved) {
      const dyears = (dx / width) * (d.range[1] - d.range[0]);
      queueRange([d.range[0] - dyears, d.range[1] - dyears]);
      if (body.current) body.current.scrollTop = d.top - dy;
    }
  }
  function endDrag() {
    window.setTimeout(() => (drag.current = null), 0);
  }
  const click = (item: Item) => {
    if (!drag.current?.moved) choose(item);
  };
  const enter = (item: Item, e: { currentTarget: EventTarget }) => {
    if (drag.current?.moved) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setHover({ item, x: r.left, y: r.bottom }), 220);
  };
  const leave = () => {
    window.clearTimeout(hoverTimer.current);
    setHover(null);
  };

  function onFind(text: string) {
    setFind(text);
    const q = text.trim().toLowerCase();
    if (q.length < 3) return;
    const exact = [...everything, ...(data?.events ?? []).map(asItem)].find((i) => i.label.toLowerCase() === q);
    if (exact) {
      focus(exact, true);
      choose(exact);
    }
  }

  if (isLoading) return <div className="loading">Loading timeline…</div>;
  if (error || !data) return <div className="error">Could not load the timeline: {String(error)}</div>;

  const step = tickStep(span, width);
  const ticks: number[] = [];
  // round years on both sides of the era: astronomical year -999 is 1000 BC (year 0 is 1 BC)
  for (let y = Math.ceil(from / step) * step; y <= to; y += step) ticks.push(y < 0 ? y + 1 : y);
  const placedMilestones = pack(milestones.map(asItem), x).filter(({ item }) => x(item.end) > -150 && x(item.start) < width + 20);
  const milestoneLanes = Math.min(3, Math.max(1, ...placedMilestones.map((p) => p.lane + 1)));
  // level of detail: the wider the view, the fewer (and more important) names
  const budget = span > 900 ? 10 : span > 500 ? 14 : span > 300 ? 22 : span > 170 ? 36 : Infinity;
  const hotId = hover?.item.id ?? null;

  return (
    <div className={`tl-wrap${selected ? " with-detail" : ""}`}>
      <div className="tl-main">
        <div className="tl-toolbar">
          <div className="seg">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => {
                  setLayers(new Set(p.layers));
                  setAllRealms(false);
                  animateTo(p.range);
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button className="chip" onClick={() => zoom(1 / 1.6)} title="Zoom in (+)">
            +
          </button>
          <button className="chip" onClick={() => zoom(1.6)} title="Zoom out (−)">
            −
          </button>
          <input
            className="tl-find"
            list="tl-names"
            value={find}
            onChange={(e) => onFind(e.target.value)}
            placeholder="Find a writer, book or event…"
            aria-label="Find on the timeline"
          />
          <datalist id="tl-names">
            {[...everything, ...(data?.events ?? []).map(asItem)].map((i) => (
              <option key={i.id} value={i.label} />
            ))}
          </datalist>
          <details className="tl-layers">
            <summary>Layers · {layers.size}</summary>
            <div className="tl-layers-menu">
              {LAYERS.map((l) => (
                <label key={l.id}>
                  <input type="checkbox" checked={layers.has(l.id)} onChange={() => toggleLayer(l.id)} />
                  {l.label}
                </label>
              ))}
              {layers.has("rulers") && (
                <label className="tl-layers-sub">
                  <input type="checkbox" checked={allRealms} onChange={() => setAllRealms(!allRealms)} />
                  Rulers: every realm in its own lane
                </label>
              )}
            </div>
          </details>
        </div>

        <div
          className="tl-canvas"
          ref={box}
          tabIndex={0}
          onKeyDown={onKey}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerLeave={() => {
            if (cursor.current) cursor.current.style.display = "none";
            leave();
          }}
        >
          <div className="tl-head">
            <div className={`tl-eras${data.eras.some((er, i) => i > 0 && er.start < data.eras[i - 1]!.end) ? " two" : ""}`}>
              {data.eras.map((er, i) => {
                const l = Math.max(0, x(er.start));
                const r = Math.min(width, x(er.end));
                if (r <= 0 || l >= width) return null;
                // a band that overlaps the next one (the Second Temple runs on to AD 70) sits on its own row
                const overlaps = data.eras.some((o, j) => j !== i && o.start < er.end && er.start < o.end && j > i);
                return (
                  <button
                    key={er.id}
                    className={`tl-era ${er.id}${overlaps ? " upper" : ""}`}
                    style={{ left: l, width: r - l }}
                    title={`${er.name} (${formatYear(er.start)}–${er.end}) — click to zoom`}
                    onClick={() => !drag.current?.moved && animateTo([er.start - (er.end - er.start) * 0.04, er.end + (er.end - er.start) * 0.04])}
                  >
                    <span>{er.name}</span>
                  </button>
                );
              })}
            </div>
            <div className="tl-axis">
              {ticks.map((t) => (
                <span key={t} className={`tl-tick${t % (step * 2) === 0 ? " major" : ""}`} style={{ left: x(t) }}>
                  {t === 0 ? "1 BC" : formatYear(t)}
                </span>
              ))}
            </div>
            <div className="tl-milestones" style={{ height: milestoneLanes * 24 + 6 }}>
              {placedMilestones.map(({ item, lane }) => (
                <button
                  key={item.id}
                  className={`tl-flag${lane > 2 ? " mini" : ""}${selected?.id === item.id ? " on" : ""}${hotId === item.id ? " hot" : ""}`}
                  style={{ left: x(item.start), top: 3 + Math.min(lane, 2) * 24 }}
                  onClick={() => click(item)}
                  onPointerEnter={(e) => enter(item, e)}
                  onPointerLeave={leave}
                  aria-label={item.label}
                >
                  {lane > 2 ? "" : item.label}
                </button>
              ))}
            </div>
            {showEvents && (
              <div className="tl-evticks">
                {minorEvents.map((e) => {
                  const item = asItem(e);
                  const l = x(e.start);
                  if (l < -10 || l > width + 10) return null;
                  return (
                    <button
                      key={e.id}
                      className={`tl-evtick ev-${e.kind}${selected?.id === item.id ? " on" : ""}${hotId === item.id ? " hot" : ""}`}
                      style={{ left: l, width: Math.max(x(e.end) - l, 0) }}
                      onClick={() => click(item)}
                      onPointerEnter={(ev) => enter(item, ev)}
                      onPointerLeave={leave}
                      aria-label={e.title}
                    />
                  );
                })}
              </div>
            )}
          </div>

          <div className="tl-body" ref={body}>
            <div className="tl-body-inner">
              {ticks.map((t) => (
                <span key={`g${t}`} className="tl-grid" style={{ left: x(t) }} />
              ))}
              {placedMilestones.map(({ item }) => (
                <span
                  key={`m${item.id}`}
                  className={`tl-milestone${hotId === item.id || selected?.id === item.id ? " hot" : ""}`}
                  style={{ left: x(item.start), width: Math.max(x(item.end) - x(item.start), 0) }}
                />
              ))}
              <span className="tl-cursor" ref={cursor} style={{ display: "none" }}>
                <span />
              </span>
              {all
                .filter((g) => g.items.length > 0)
                .map((g) => {
                  const inView = g.items.filter((item) => x(item.end) > -260 && x(item.start) < width + 50);
                  const ranked = g.id === "outside" ? inView : [...inView].sort((a, b) => (weight.get(b.id) ?? 0) - (weight.get(a.id) ?? 0));
                  const keep = new Set(ranked.slice(0, budget).map((i) => i.id));
                  if (selected) keep.add(selected.id);
                  const shown = inView.filter((i) => keep.has(i.id));
                  const placed = pack(shown, x);
                  const lanes = Math.max(1, ...placed.map((p) => p.lane + 1));
                  return (
                    <section key={g.id} className={`tl-group tl-${g.id}`}>
                      <h4>
                        {g.label}{" "}
                        <span className="count">
                          {shown.length < inView.length ? `${shown.length} of ${inView.length} here \u2014 zoom in for more` : inView.length}
                        </span>
                      </h4>
                      <div className="tl-lanes" style={{ height: lanes * LANE }}>
                        {placed.map(({ item, lane }) => (
                          <Bar
                            key={item.id}
                            item={item}
                            lane={lane}
                            x={x}
                            on={selected?.id === item.id}
                            hot={hotId === item.id}
                            onClick={() => click(item)}
                            onEnter={(e) => enter(item, e)}
                            onLeave={leave}
                          />
                        ))}
                      </div>
                    </section>
                  );
                })}
            </div>
          </div>
        </div>
        <Overview data={data} range={range} onRange={(r) => setRange(clamp(r))} />
        <p className="muted small tl-hint">
          Ctrl + scroll to zoom · drag to move · drag the edges of the window below to zoom · click an era to zoom to it · ← → and + − keys · click anything to read about it
        </p>
      </div>
      {selected && <Detail item={selected} onClose={() => choose(null)} />}
      {hover && !drag.current?.moved && <HoverCard item={hover.item} x={hover.x} y={hover.y} />}
    </div>
  );
}

function asItem(e: TimelineEvent): Item {
  return { kind: "event", id: `e:${e.id}`, e, start: e.start, end: e.end, label: e.title };
}

function milestoneItem(ms: TimelineEvent[], id: string): Item | undefined {
  const e = ms.find((m) => `e:${m.id}` === id);
  return e ? asItem(e) : undefined;
}

function Bar({
  item,
  lane,
  x,
  on,
  hot,
  onClick,
  onEnter,
  onLeave,
}: {
  item: Item;
  lane: number;
  x: (y: number) => number;
  on: boolean;
  hot: boolean;
  onClick: () => void;
  onEnter: (e: { currentTarget: EventTarget }) => void;
  onLeave: () => void;
}) {
  const left = x(item.start);
  const w = Math.max(x(item.end) - left, 0);
  const top = lane * LANE;
  const cls = `${on ? " on" : ""}${hot ? " hot" : ""}`;
  const handlers = { onClick, onPointerEnter: onEnter, onPointerLeave: onLeave };
  if (item.kind === "event") {
    const point = item.e.date_kind === "point" || w < 4;
    return (
      <button className={`tl-item tl-ev ev-${item.e.kind}${cls}`} style={{ left, top }} {...handlers}>
        {point ? <i className="tl-dot" /> : <i className={`tl-span${item.e.date_kind === "window" ? " window" : ""}`} style={{ width: w }} />}
        <span className="tl-label">{item.label}</span>
      </button>
    );
  }
  if (item.kind === "ruler") {
    const shared = item.d.shared_from !== null ? Math.max(x(item.d.start) - left, 0) : 0;
    return (
      <button className={`tl-item tl-ruler k-${item.realm.kind}${cls}`} style={{ left, top }} {...handlers}>
        <i className={`tl-reign${item.d.circa ? " circa" : ""}`} style={{ width: Math.max(w, 4) }}>
          {shared > 0 && <i className="tl-coreign" style={{ width: shared }} />}
        </i>
        <span className="tl-label">{item.label}</span>
      </button>
    );
  }
  if (item.kind === "work") {
    return (
      <button className={`tl-item tl-work cat-${item.w.category}${cls}`} style={{ left, top }} {...handlers}>
        <i className="tl-span window" style={{ width: Math.max(w, 4) }} />
        <span className="tl-label">{item.label}</span>
      </button>
    );
  }
  const a = item.a;
  const fl = a.floruit_from ?? a.floruit_to;
  const flLeft = fl !== null ? x(fl) - left : 0;
  const flW = a.floruit_to !== null && fl !== null ? Math.max(x(a.floruit_to) - x(fl), 3) : 0;
  return (
    <button className={`tl-item tl-author trad-${a.tradition ?? "x"}${cls}${a.born === null ? " no-birth" : ""}`} style={{ left, top }} {...handlers}>
      <i className="tl-life" style={{ width: Math.max(w, 4) }}>
        {flW > 0 && <i className="tl-floruit" style={{ left: flLeft, width: flW }} />}
      </i>
      <span className="tl-label">
        {a.name}
        <small>{a.works.length}</small>
      </span>
    </button>
  );
}

function HoverCard({ item, x, y }: { item: Item; x: number; y: number }) {
  const note = itemNote(item);
  // anchored just below the item (above it near the bottom of the window), never following the pointer
  const left = Math.max(8, Math.min(x, window.innerWidth - 296));
  const top = y + 6 + 150 > window.innerHeight ? y - 176 : y + 6;
  return (
    <div className="tl-hovercard" style={{ left, top }} role="tooltip">
      <strong>{item.label}</strong>
      <span className="muted">{itemDates(item)}</span>
      {note && <span>{note}</span>}
      {item.kind === "author" && (
        <span className="muted small">
          {item.a.works.length} work{item.a.works.length === 1 ? "" : "s"} in the library · click for more
        </span>
      )}
      {item.kind !== "author" && <span className="muted small">click for more</span>}
    </div>
  );
}

/** A strip showing the whole span with the visible window; click or drag to move. */
function Overview({ data, range, onRange }: { data: Timeline; range: Range; onRange: (r: Range) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [lo, hi] = LIMITS;
  const pct = (y: number) => ((y - lo) / (hi - lo)) * 100;
  // dragging the window moves the view; dragging either edge resizes it (= zooms)
  const drag = useRef<{ mode: "move" | "left" | "right"; x: number; range: Range } | null>(null);
  const yearsPerPx = () => (hi - lo) / (ref.current?.getBoundingClientRect().width || 1);
  function start(e: RPointerEvent, mode: "move" | "left" | "right") {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, x: e.clientX, range };
  }
  function move(e: RPointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dy = (e.clientX - d.x) * yearsPerPx();
    const [a, b] = d.range;
    if (d.mode === "move") onRange([a + dy, b + dy]);
    else if (d.mode === "left") onRange([Math.min(a + dy, b - 12), b]);
    else onRange([a, Math.max(b + dy, a + 12)]);
  }
  return (
    <div
      className="tl-overview"
      ref={ref}
      title="The whole span — drag the window to move, drag its edges to zoom, click to jump"
      onPointerDown={(e) => {
        const rect = ref.current!.getBoundingClientRect();
        const at = lo + ((e.clientX - rect.left) / rect.width) * (hi - lo);
        const half = (range[1] - range[0]) / 2;
        const next: Range = [at - half, at + half];
        onRange(next);
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { mode: "move", x: e.clientX, range: next };
      }}
      onPointerMove={move}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    >
      {data.eras.map((er) => (
        <span key={er.id} className={`ov-era ${er.id}`} style={{ left: `${pct(er.start)}%`, width: `${pct(er.end) - pct(er.start)}%` }} />
      ))}
      {data.authors.map((a) => (
        <span key={a.id} className="ov-dot" style={{ left: `${pct(a.floruit_to ?? a.died ?? 0)}%` }} />
      ))}
      {data.events
        .filter((e) => e.major)
        .map((e) => (
          <span key={e.id} className="ov-mile" style={{ left: `${pct(e.start)}%` }} />
        ))}
      <span
        className="ov-window"
        style={{ left: `${pct(range[0])}%`, width: `${pct(range[1]) - pct(range[0])}%` }}
        onPointerDown={(e) => start(e, "move")}
        onPointerMove={move}
        onPointerUp={() => (drag.current = null)}
      >
        <i className="ov-handle left" onPointerDown={(e) => start(e, "left")} onPointerMove={move} onPointerUp={() => (drag.current = null)} />
        <i className="ov-handle right" onPointerDown={(e) => start(e, "right")} onPointerMove={move} onPointerUp={() => (drag.current = null)} />
      </span>
      {[0, 500, 1000].map((y) => (
        <span key={y} className="ov-tick" style={{ left: `${pct(y)}%` }}>
          {y === 0 ? "AD 1" : y}
        </span>
      ))}
    </div>
  );
}

function Detail({ item, onClose }: { item: Item; onClose: () => void }) {
  return (
    <aside className="tl-detail" aria-label="Details">
      <button className="icon-btn tl-close" onClick={onClose} aria-label="Close">
        ✕
      </button>
      {item.kind === "author" && <AuthorDetail a={item.a} />}
      {item.kind === "work" && <WorkDetail w={item.w} />}
      {item.kind === "event" && <EventDetail e={item.e} />}
      {item.kind === "ruler" && <TimelineRulerDetail r={item.r} realm={item.realm} d={item.d} />}
    </aside>
  );
}

function TimelineRulerDetail({ r, realm, d }: { r: Ruler; realm: Realm; d: ReignDates }) {
  return (
    <>
      <h2>{r.name}</h2>
      <div className="sub">
        {shortLabel(d)} · {r.office}, {realm.name}
      </div>
      {r.note && <p className="tl-summary">{r.note}</p>}
      <p>
        <Link to={`/rulers?sel=${encodeURIComponent(r.id)}`}>All the rulers of the time →</Link>
        {r.verses > 0 && (
          <>
            {" · "}
            <Link to={`/person/${encodeURIComponent(r.person_id)}`}>
              Named in {r.verses} verse{r.verses === 1 ? "" : "s"}
            </Link>
          </>
        )}
      </p>
      {r.wikipedia && <WikiCard title={r.wikipedia} />}
    </>
  );
}

export function AuthorDetail({ a }: { a: TimelineAuthor }) {
  const works = [...a.works].sort((x, y) => y.citations - x.citations || x.title.localeCompare(y.title));
  return (
    <>
      <h2>{a.name}</h2>
      <div className="sub">
        {lifeLabel(a)}
        {a.era && ` · ${ERA_LABELS[a.era] ?? a.era}`}
        {a.tradition === "jewish" && " · Jewish"}
        {a.tradition === "pagan" && " · Greek/Roman"}
      </div>
      {a.summary && <p className="tl-summary">{a.summary}</p>}
      {a.wikipedia && <WikiCard title={a.wikipedia} />}
      <h3>
        Works in the library <span className="count">{works.length}</span>
      </h3>
      <ul className="tl-works">
        {works.map((w) => (
          <WorkRow key={w.id} w={w} />
        ))}
      </ul>
    </>
  );
}

export function WorkRow({ w }: { w: TimelineWork }) {
  return (
    <li>
      {w.edition_id ? <Link to={`/library/${encodeURIComponent(w.edition_id)}/1`}>{w.title}</Link> : w.title}
      <span className="muted small">
        {w.date_from !== null && ` · ${rangeLabel(w.date_from, w.date_to, true)}`}
        {w.citations > 0 && ` · ${w.citations.toLocaleString()} Scripture citations`}
      </span>
    </li>
  );
}

export function WorkDetail({ w }: { w: TimelineWork }) {
  return (
    <>
      <h2>{w.title}</h2>
      <div className="sub">
        {rangeLabel(w.date_from, w.date_to, true)} · {CATEGORY_LABELS[w.category] ?? w.category}
      </div>
      {w.summary && <p className="tl-summary">{w.summary}</p>}
      {w.wikipedia && <WikiCard title={w.wikipedia} />}
      {w.edition_id && (
        <p>
          <Link className="btn" to={`/library/${encodeURIComponent(w.edition_id)}/1`}>
            Read it →
          </Link>
        </p>
      )}
    </>
  );
}

export function EventDetail({ e }: { e: TimelineEvent }) {
  return (
    <>
      <h2>{e.title}</h2>
      <div className="sub">
        {rangeLabel(e.start, e.end, !!e.circa)} · {e.kind}
      </div>
      {e.description && <p className="tl-summary">{e.description}</p>}
      {e.wikipedia && <WikiCard title={e.wikipedia} />}
    </>
  );
}
