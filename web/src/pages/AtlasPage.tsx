import L from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMeta } from "../api";
import { addBasemap, createMap, escapeHtml, placeClass } from "../components/atlasMap";
import {
  confidenceBand,
  CONFIDENCE_LABEL,
  KIND_LABEL,
  refLinks,
  useAtlas,
  useAtlasRoutes,
  usePlace,
  usePlacesIn,
  type AtlasPlace,
  type RouteFeature,
} from "../geoApi";
import { osisLabel, verseUrl } from "../lib";
import { pins, usePins } from "../pins";
import type { Book } from "../types";

const JOURNEY_LABEL: Record<number, string> = { 1: "First journey", 2: "Second journey", 3: "Third journey", 4: "To Rome" };

/** How many verses a place needs before its name is written at this zoom (busy maps stay legible). */
function labelThreshold(z: number): number {
  if (z < 4.5) return 300;
  if (z < 5.5) return 90;
  if (z < 6.5) return 30;
  if (z < 7.5) return 12;
  if (z < 8.5) return 4;
  return 0;
}

/** Zoomed out, only places named often keep a dot (pinned, focused and chosen places always do). */
function dotThreshold(z: number): number {
  if (z < 5) return 40;
  if (z < 6) return 12;
  if (z < 7) return 4;
  return 0;
}

/** Great-circle distance in km. */
function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function radius(p: AtlasPlace, selected: boolean): number {
  if (selected) return 7;
  if (p.kind === "region") return 3;
  return p.verses >= 60 ? 5 : p.verses >= 10 ? 4 : 3.2;
}

export default function AtlasPage() {
  const [params, setParams] = useSearchParams();
  const selected = params.get("place");
  const show = useMemo(() => (params.get("show") ?? "").split(",").filter(Boolean), [params]);
  const testament = params.get("t") ?? "";
  const book = params.get("book") ?? "";
  const paul = params.get("paul") === "1";
  const hideUncertain = params.get("certain") === "1";
  const satellite = params.get("sat") === "1";
  const focusRef = params.get("focus");
  const focusPerson = params.get("person");
  const focusEvent = params.get("event");
  const pinnedOnly = params.get("pinned") === "1";
  const setId = params.get("set");
  const from = params.get("from");
  const { pinned, sets } = usePins();
  const activeSet = sets.find((x) => x.id === setId) ?? null;
  const focus = usePlacesIn(focusRef || focusPerson || focusEvent ? { ref: focusRef ?? undefined, person: focusPerson ?? undefined, event: focusEvent ?? undefined } : null);
  const focusIds = useMemo(() => focus.data?.places.map((p) => p.id) ?? null, [focus.data]);
  const [zoom, setZoom] = useState(6);
  const [q, setQ] = useState("");
  const [peek, setPeek] = useState(false); // phones: the sheet pulled down
  const pull = useRef<number | null>(null);
  const atlas = useAtlas();
  const meta = useMeta();
  const routes = useAtlasRoutes(paul);
  const books = useMemo(() => meta.data?.books ?? [], [meta.data]);

  const set = (changes: Record<string, string | null>) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        for (const [k, v] of Object.entries(changes)) {
          if (v) n.set(k, v);
          else n.delete(k);
        }
        return n;
      },
      { replace: true },
    );

  const testamentOf = useMemo(() => new Map(books.map((b) => [b.ord, b.testament])), [books]);
  const bookOrd = books.find((b) => b.osis === book)?.ord;
  const visible = useMemo(() => {
    const all = atlas.data?.places ?? [];
    const only = focusIds ? new Set(focusIds) : activeSet ? new Set(activeSet.places) : pinnedOnly ? new Set(pinned) : null;
    return all.filter((p) => {
      if (only) return only.has(p.id) || p.id === selected;
      if (hideUncertain && confidenceBand(p.confidence) === "uncertain") return false;
      if (bookOrd) return p.books.includes(bookOrd);
      if (testament) return p.books.some((o) => testamentOf.get(o) === testament);
      return true;
    });
  }, [atlas.data, hideUncertain, bookOrd, testament, testamentOf, focusIds, activeSet, pinnedOnly, pinned, selected]);
  const booksWithPlaces = useMemo(() => {
    const used = new Set((atlas.data?.places ?? []).flatMap((p) => p.books));
    return books.filter((b) => used.has(b.ord) && (!testament || b.testament === testament));
  }, [atlas.data, books, testament]);

  const matches = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (term.length < 2) return [];
    const hits = (atlas.data?.places ?? []).filter((p) => p.name.toLowerCase().includes(term) || p.modern_name?.toLowerCase().includes(term));
    return hits
      .sort((a, b) => Number(!b.name.toLowerCase().startsWith(term)) - Number(!a.name.toLowerCase().startsWith(term)) || b.verses - a.verses)
      .slice(0, 8);
  }, [q, atlas.data]);

  // ---------------------------------------------------------------- the map
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<{ markers: L.LayerGroup; labels: L.LayerGroup; routes: L.LayerGroup } | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!el.current) return;
    const m = createMap(el.current);
    // the lands of the Bible, from the Aegean to Babylon, beside the panel (phones: the Holy Land, above the sheet)
    if (window.innerWidth < 760) m.setView([31.9, 35.3], 6.5);
    else m.fitBounds(L.latLngBounds([27.5, 22], [38.5, 47]), { paddingTopLeft: [350, 0] });
    m.zoomControl?.setPosition("topright");
    layers.current = { routes: L.layerGroup().addTo(m), markers: L.layerGroup().addTo(m), labels: L.layerGroup().addTo(m) };
    map.current = m;
    m.on("zoomend", () => setZoom(m.getZoom()));
    setZoom(m.getZoom());
    let alive = true;
    addBasemap(m)
      .catch(() => undefined)
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
      m.remove();
      map.current = null;
    };
  }, []);

  // optional satellite imagery: the only part of the atlas that contacts another server, so it is opt-in
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !satellite) return;
    const tiles = L.tileLayer("https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg", {
      maxZoom: 13,
      attribution:
        '<a href="https://s2maps.eu" target="_blank" rel="noreferrer">Sentinel-2 cloudless 2016</a> by EOX IT Services (CC BY 4.0), contains modified Copernicus Sentinel data 2016',
    }).addTo(m);
    m.getContainer().classList.add("satellite");
    return () => {
      tiles.remove();
      m.getContainer().classList.remove("satellite");
    };
  }, [ready, satellite]);

  // markers for the places that pass the filters
  useEffect(() => {
    const m = map.current;
    const ls = layers.current;
    if (!m || !ls || !ready) return;
    ls.markers.clearLayers();
    const highlight = new Set(show);
    const narrowed = !!(focusIds || activeSet || pinnedOnly || book);
    const min = narrowed ? 0 : dotThreshold(zoom);
    const pinSet = new Set(pinned);
    const order = new Map((focusIds ?? []).map((id, i) => [id, i + 1]));
    // measuring: a dashed line between the two places
    const fromP = from ? visible.find((p) => p.id === from) ?? atlas.data?.places.find((p) => p.id === from) : null;
    const toP = selected ? atlas.data?.places.find((p) => p.id === selected) : null;
    if (fromP && toP && fromP.id !== toP.id) L.polyline([[fromP.lat, fromP.lon], [toP.lat, toP.lon]], { className: "measure-line", interactive: false }).addTo(ls.markers);
    for (const p of visible) {
      const sel = p.id === selected;
      const n = order.get(p.id);
      if (p.verses < min && !sel && !pinSet.has(p.id) && !highlight.has(p.id) && p.id !== from) continue;
      if (n) {
        L.marker([p.lat, p.lon], {
          icon: L.divIcon({ className: `mp-pin${sel ? " on" : ""}${pinSet.has(p.id) ? " pinned" : ""}`, html: `<span class="mp-num">${n}</span><span class="mp-name">${escapeHtml(p.name)}</span>`, iconSize: [0, 0] }),
        })
          .on("click", () => set({ place: p.id }))
          .addTo(ls.markers);
        continue;
      }
      const marker = L.circleMarker([p.lat, p.lon], {
        radius: radius(p, sel) + (pinSet.has(p.id) ? 1 : 0),
        className: placeClass(p.kind, p.confidence, `${sel ? "sel" : ""}${highlight.has(p.id) ? " hl" : ""}${pinSet.has(p.id) ? " pinned" : ""}`),
        bubblingMouseEvents: false,
      });
      const certainty =
        p.confidence == null ? "" : p.confidence >= 0.8 ? "location certain" : p.confidence >= 0.4 ? "location probable" : "location uncertain";
      const meta = [p.kind ?? "", p.modern_name ? `today ${p.modern_name}` : "", certainty].filter(Boolean).map(escapeHtml).join(" · ");
      marker.bindTooltip(
        `<strong>${escapeHtml(p.name)}</strong>${meta ? `<span class="pm-tip-meta">${meta}</span>` : ""}<span class="pm-tip-n">named in ${p.verses} verse${p.verses === 1 ? "" : "s"} · click for details</span>`,
        { direction: "top", offset: [0, -4], className: "pm-tip pm-tip-card" },
      );
      marker.on("click", () => set({ place: p.id }));
      marker.addTo(ls.markers);
    }
  }, [visible, selected, ready, show, zoom, focusIds, activeSet, pinnedOnly, pinned, book, from, atlas.data]);

  // place names, largest first, skipping any that would overlap
  useEffect(() => {
    const m = map.current;
    const ls = layers.current;
    if (!m || !ls || !ready) return;
    const draw = () => {
      ls.labels.clearLayers();
      const min = focusIds || activeSet || pinnedOnly ? 0 : labelThreshold(m.getZoom()); // a narrowed map names every place
      const bounds = m.getBounds().pad(0.1);
      const boxes: [number, number, number, number][] = [];
      const highlight = new Set(show);
      const numbered = new Set(focusIds ?? []); // these carry their names in their numbered pins
      const ranked = visible
        .filter((p) => !numbered.has(p.id))
        .filter((p) => p.verses >= min || p.id === selected || highlight.has(p.id))
        .filter((p) => bounds.contains([p.lat, p.lon]))
        .sort((a, b) => Number(b.id === selected) - Number(a.id === selected) || Number(highlight.has(b.id)) - Number(highlight.has(a.id)) || b.verses - a.verses);
      for (const p of ranked) {
        const pt = m.latLngToContainerPoint([p.lat, p.lon]);
        const region = p.kind === "region";
        const w = p.name.length * (region ? 7.4 : 6.6) + 6;
        const box: [number, number, number, number] = region ? [pt.x - w / 2, pt.y - 8, pt.x + w / 2, pt.y + 8] : [pt.x + 5, pt.y - 8, pt.x + 5 + w, pt.y + 8];
        if (boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
        boxes.push(box);
        L.marker([p.lat, p.lon], {
          interactive: false,
          keyboard: false,
          icon: L.divIcon({
            className: `pm-label${region ? " region" : ""}${p.verses >= 100 ? " major" : ""}${p.id === selected ? " sel" : ""}`,
            html: `<span>${escapeHtml(p.name)}</span>`,
            iconSize: [0, 0],
          }),
        }).addTo(ls.labels);
      }
    };
    draw();
    m.on("zoomend moveend", draw);
    return () => {
      m.off("zoomend moveend", draw);
    };
  }, [visible, selected, ready, show, focusIds, activeSet, pinnedOnly]);

  // Paul's journeys
  useEffect(() => {
    const ls = layers.current;
    if (!ls || !ready) return;
    ls.routes.clearLayers();
    if (!paul || !routes.data) return;
    for (const r of routes.data) drawRoute(r, ls.routes, (id) => set({ place: id }));
  }, [paul, routes.data, ready]);

  // follow the selection (and links that ask for a set of places), keeping it clear of the panel
  const atlasPlaces = atlas.data?.places;
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !atlasPlaces) return;
    const size = m.getSize();
    const phone = size.x < 760;
    const covered: [number, number] = phone ? [0, Math.round(window.innerHeight * 0.46) + 16] : [370, 0];
    const pad = { paddingTopLeft: L.point(phone ? 0 : covered[0], 0), paddingBottomRight: L.point(0, covered[1]) };
    const group = focusIds ?? activeSet?.places ?? (pinnedOnly ? pinned : show.length > 1 ? show : null);
    if (group && group.length > 0 && !selected) {
      const pts = atlasPlaces.filter((p) => group.includes(p.id)).map((p) => L.latLng(p.lat, p.lon));
      if (pts.length) m.fitBounds(L.latLngBounds(pts), { ...pad, maxZoom: 9 });
      return;
    }
    const p = atlasPlaces.find((x) => x.id === selected);
    if (!p) return;
    const ll = L.latLng(p.lat, p.lon);
    const pt = m.latLngToContainerPoint(ll);
    const clear = pt.x > covered[0] + 40 && pt.x < size.x - 40 && pt.y > 40 && pt.y < size.y - covered[1] - 40;
    if (!clear || m.getZoom() < 6) m.flyToBounds(L.latLngBounds(ll, ll), { ...pad, maxZoom: Math.max(m.getZoom(), 7.5), duration: 0.6 });
  }, [selected, show, ready, atlasPlaces, focusIds, activeSet, pinnedOnly]);

  const count = visible.length;
  return (
    <div className="atlas-page">
      <div className="atlas-map" ref={el} role="application" aria-label="Map of biblical places" />
      <aside
        className={`atlas-panel${selected ? " has-place" : ""}${peek ? " peek" : ""}`}
        onTouchStart={(e) => {
          const box = e.currentTarget;
          pull.current = box.scrollTop <= 0 ? e.touches[0]!.clientY : null;
        }}
        onTouchEnd={(e) => {
          if (pull.current === null) return;
          const dy = e.changedTouches[0]!.clientY - pull.current;
          pull.current = null;
          if (dy > 60) setPeek(true);
          else if (dy < -40) setPeek(false);
        }}
      >
        {/* phones: a handle to pull the sheet down to just the search (or the place name), and back up */}
        <button className="atlas-grip" onClick={() => setPeek(!peek)} aria-label={peek ? "Show the panel" : "Shrink the panel"} />
        <header className="atlas-head">
          <h1>Atlas</h1>
          <span className="muted small">{atlas.data ? `${count.toLocaleString()} places` : "Loading places…"}</span>
        </header>
        <div className="atlas-find">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a place…" aria-label="Find a place" />
          {matches.length > 0 && (
            <ul className="atlas-matches">
              {matches.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => {
                      setQ("");
                      set({ place: p.id, book: null, t: null });
                    }}
                  >
                    {p.name}
                    <span className="muted small">{p.modern_name ? ` · ${p.modern_name}` : ""} · {p.verses} verses</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="atlas-filters">
          <div className="seg" role="group" aria-label="Testament">
            {[
              ["", "All"],
              ["OT", "OT"],
              ["NT", "NT"],
            ].map(([id, label]) => (
              <button key={id} className={testament === id ? "on" : ""} onClick={() => set({ t: id || null, book: null })}>
                {label}
              </button>
            ))}
          </div>
          <select value={book} onChange={(e) => set({ book: e.target.value || null })} aria-label="Places named in a book">
            <option value="">All books</option>
            {booksWithPlaces.map((b) => (
              <option key={b.osis} value={b.osis}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        {(focusIds || activeSet || pinnedOnly) && (
          <div className="atlas-focus">
            <span>
              <b>{focusIds ? focus.data?.title : activeSet ? activeSet.name : "Pinned places"}</b>
              <span className="muted"> · {visible.length} {visible.length === 1 ? "place" : "places"}{focusIds ? ", numbered in the order the text names them" : ""}</span>
            </span>
            <button className="link-btn" onClick={() => set({ focus: null, person: null, event: null, set: null, pinned: null })}>
              Show all
            </button>
          </div>
        )}
        <div className="atlas-pins">
          <label>
            <input type="checkbox" checked={pinnedOnly} disabled={!pinned.length} onChange={(e) => set({ pinned: e.target.checked ? "1" : null, set: null, focus: null, person: null, event: null })} /> ★ Pinned only
            <span className="muted"> ({pinned.length})</span>
          </label>
          {sets.length > 0 && (
            <select value={setId ?? ""} onChange={(e) => set({ set: e.target.value || null, pinned: null, focus: null, person: null, event: null })} aria-label="Saved sets">
              <option value="">Saved sets…</option>
              {sets.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} ({x.places.length})
                </option>
              ))}
            </select>
          )}
          {pinned.length > 1 && (
            <button className="link-btn" onClick={() => { const name = window.prompt("Name this set of pinned places", "My places"); if (name) pins.saveSet(name, pinned); }}>
              Save pins as set
            </button>
          )}
          {activeSet && (
            <button className="link-btn" onClick={() => { pins.deleteSet(activeSet.id); set({ set: null }); }}>
              Delete set
            </button>
          )}
        </div>
        <div className="atlas-toggles">
          <label>
            <input type="checkbox" checked={paul} onChange={(e) => set({ paul: e.target.checked ? "1" : null })} /> Paul's journeys
          </label>
          <label>
            <input type="checkbox" checked={hideUncertain} onChange={(e) => set({ certain: e.target.checked ? "1" : null })} /> Hide uncertain sites
          </label>
          <label title="Sentinel-2 cloudless 2016 by EOX (CC BY 4.0). Turning this on loads imagery from EOX's servers.">
            <input type="checkbox" checked={satellite} onChange={(e) => set({ sat: e.target.checked ? "1" : null })} /> Satellite
            <span className="atlas-toggle-note"> (loads from EOX)</span>
          </label>
        </div>
        {selected ? (
          <PlaceCard id={selected} books={books} onClose={() => set({ place: null })} from={from ? (atlas.data?.places.find((p) => p.id === from) ?? null) : null} onMeasure={(id) => set({ from: id })} />
        ) : (
          <Legend paul={paul} routes={routes.data} />
        )}
      </aside>
    </div>
  );
}

function drawRoute(r: RouteFeature, group: L.LayerGroup, onPlace: (id: string) => void) {
  const j = r.geojson.properties.journey ?? 0;
  const lines = r.geojson.geometry.coordinates.map((line) => line.map(([lon, lat]) => L.latLng(lat!, lon!)));
  L.polyline(lines, { className: `route route-${j}`, interactive: false }).addTo(group);
  for (const s of r.geojson.properties.stops ?? []) {
    const stop = L.circleMarker([s.lat, s.lon], { radius: 3, className: `route-stop route-${j}`, bubblingMouseEvents: false });
    stop.bindTooltip(`${escapeHtml(s.name)} <span>${escapeHtml(s.osis.replace(/^Acts\./, "Acts ").replace(/\.(\d+)$/, ":$1"))}</span>`, {
      direction: "top",
      className: "pm-tip",
    });
    if (s.place) {
      const id = s.place;
      stop.on("click", () => onPlace(id));
    }
    stop.addTo(group);
  }
}

function Legend({ paul, routes }: { paul: boolean; routes?: RouteFeature[] }) {
  return (
    // open beside the map on wide screens; on phones a tap-to-open "Map key", so the map keeps the room
    <details className="atlas-legend" open={window.matchMedia("(min-width: 761px)").matches}>
      <summary>
        <h3>Reading the map</h3>
      </summary>
      <ul>
        <li>
          <i className="lg-dot certain" /> location certain
        </li>
        <li>
          <i className="lg-dot likely" /> probable
        </li>
        <li>
          <i className="lg-dot uncertain" /> uncertain or disputed
        </li>
        <li>
          <i className="lg-dot region" /> region, land or people
        </li>
      </ul>
      {paul && routes && (
        <ul>
          {routes.map((r) => (
            <li key={r.id}>
              <i className={`lg-route route-${r.geojson.properties.journey ?? 0}`} /> {JOURNEY_LABEL[r.geojson.properties.journey ?? 0] ?? r.name}
              <span className="muted small"> · {r.geojson.properties.refs?.replace(/Acts\.(\d+)\.(\d+)-Acts\.(\d+)\.(\d+)/, "Acts $1:$2–$3:$4")}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">
        Click a place to see the verses that name it. Sites follow OpenBible.info's identifications, scored by how widely scholars accept them.
      </p>
    </details>
  );
}

function PlaceCard({ id, books, onClose, from, onMeasure }: { id: string; books: Book[]; onClose: () => void; from: AtlasPlace | null; onMeasure: (id: string | null) => void }) {
  const isPinned = usePins().pinned.includes(id);
  const { data, isLoading, error } = usePlace(id);
  if (isLoading) return <div className="atlas-card loading">Loading…</div>;
  if (error || !data) return <div className="atlas-card error">Could not load this place.</div>;
  const p = data.place;
  const band = confidenceBand(p.confidence);
  return (
    <article className="atlas-card">
      <button className="icon-btn atlas-close" onClick={onClose} aria-label="Close">
        ✕
      </button>
      <h2>{p.name}</h2>
      <div className="sub">
        {KIND_LABEL[p.kind ?? "site"] ?? p.kind}
        {p.modern_name && ` · today ${p.modern_name}`}
      </div>
      <div className="atlas-card-actions">
        <span className={`conf conf-${band}`}>{CONFIDENCE_LABEL[band]}</span>
        <button className={`chip${isPinned ? " on" : ""}`} onClick={() => pins.toggle(p.id)} aria-pressed={isPinned}>
          {isPinned ? "★ Pinned" : "☆ Pin"}
        </button>
        {p.lat != null &&
          (from && from.id !== p.id ? null : (
            <button className="chip" onClick={() => onMeasure(from?.id === p.id ? null : p.id)}>
              {from?.id === p.id ? "Stop measuring" : "Measure from here"}
            </button>
          ))}
      </div>
      {from && from.id !== p.id && p.lat != null && p.lon != null && (
        <div className="atlas-measure">
          <b>{Math.round(km(from, { lat: p.lat, lon: p.lon }))} km</b> from {from.name} as the crow flies · about{" "}
          {Math.max(1, Math.round((km(from, { lat: p.lat, lon: p.lon }) * 1.25) / 30))} days on foot
          <button className="link-btn" onClick={() => onMeasure(null)}>
            Clear
          </button>
        </div>
      )}
      {p.summary && <p className="atlas-summary">{p.summary}</p>}
      <h3>
        Named in {data.verses.count.toLocaleString()} {data.verses.count === 1 ? "verse" : "verses"}
      </h3>
      <div className="atlas-books">
        {data.verses.books.slice(0, 8).map((g) => (
          <span key={g.book}>
            <strong>{g.name}</strong>{" "}
            {refLinks(g.book, g.refs.slice(0, 4)).map((r, i) => (
              <Link key={r.osis} to={verseUrl(r.osis)}>
                {i > 0 && " "}
                {r.label}
              </Link>
            ))}
            {g.refs.length > 4 && <span className="muted"> +{g.refs.length - 4}</span>}
          </span>
        ))}
        {data.verses.books.length > 8 && <span className="muted">and {data.verses.books.length - 8} more books</span>}
      </div>
      {data.verses.samples[0]?.text && (
        <blockquote className="atlas-quote">
          {data.verses.samples[0].text} <Link to={verseUrl(data.verses.samples[0].osis)}>{osisLabel(data.verses.samples[0].osis, books)}</Link>
        </blockquote>
      )}
      {data.events.length > 0 && (
        <>
          <h3>Events here</h3>
          <ul className="atlas-list">
            {data.events.slice(0, 5).map((e) => (
              <li key={e.id}>
                <Link to={`/event/${encodeURIComponent(e.id)}`}>{e.title}</Link>
              </li>
            ))}
          </ul>
        </>
      )}
      {data.people.length > 0 && (
        <>
          <h3>People</h3>
          <p className="atlas-people">
            {data.people.slice(0, 10).map((x, i) => (
              <span key={x.id}>
                {i > 0 && ", "}
                <Link to={`/person/${encodeURIComponent(x.id)}`}>{x.name}</Link>
              </span>
            ))}
          </p>
        </>
      )}
      <Link className="btn" to={`/place/${encodeURIComponent(p.id)}`}>
        Open {p.name} →
      </Link>
    </article>
  );
}
