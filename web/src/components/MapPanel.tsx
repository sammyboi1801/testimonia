import L from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMeta } from "../api";
import { useBackClose } from "../backClose";
import { useAtlas, usePlacesIn } from "../geoApi";
import { osisLabel, verseUrl } from "../lib";
import { atlasUrl, onOpenMap, pins, usePins, type MapRequest } from "../pins";
import { addBasemap, createMap, escapeHtml } from "./atlasMap";

interface Spot {
  id: string;
  name: string;
  lat: number;
  lon: number;
  modern_name: string | null;
  first_osis?: string;
  n?: number;
}

/** A map beside the text: the places of a passage (or a person's story, an event, a list the assistant chose),
 *  numbered in the order the text names them and joined by a faint line. Opens from anywhere with openMap(). */
export function MapPanel({ initial }: { initial: MapRequest }) {
  const [req, setReq] = useState<MapRequest | null>(initial);
  useEffect(() => onOpenMap((r) => setReq(r)), []);
  useBackClose(req !== null, () => setReq(null));
  if (!req) return null;
  return <Panel key={JSON.stringify(req)} req={req} onClose={() => setReq(null)} />;
}

function Panel({ req, onClose }: { req: MapRequest; onClose: () => void }) {
  const books = useMeta().data?.books ?? [];
  const atlas = useAtlas();
  const query = req.ref || req.person || req.event ? { ref: req.ref, person: req.person, event: req.event } : null;
  const found = usePlacesIn(query);
  const { pinned } = usePins();
  const [active, setActive] = useState<string | null>(req.select ?? null);

  const spots: Spot[] = useMemo(() => {
    if (query) return found.data?.places ?? [];
    const byId = new Map((atlas.data?.places ?? []).map((p) => [p.id, p]));
    return (req.places ?? []).flatMap((id) => {
      const p = byId.get(id);
      return p ? [{ id: p.id, name: p.name, lat: p.lat, lon: p.lon, modern_name: p.modern_name, n: p.verses }] : [];
    });
  }, [query, found.data, atlas.data, req.places]);
  const title = req.title ?? found.data?.title ?? "Places";
  const loading = query ? found.isLoading : atlas.isLoading;

  // ---------------------------------------------------------------- the map
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const markers = useRef(new Map<string, L.Marker>());
  useEffect(() => {
    if (!el.current) return;
    const m = createMap(el.current);
    m.setView([31.8, 35.2], 7);
    m.zoomControl?.setPosition("topright");
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    addBasemap(m, false).catch(() => undefined);
    // the panel slides in: let the map measure itself once it has its size
    const t = window.setTimeout(() => m.invalidateSize(), 260);
    return () => {
      window.clearTimeout(t);
      m.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    markers.current.clear();
    if (!spots.length) return;
    if (spots.length > 1 && query) {
      L.polyline(
        spots.map((s) => [s.lat, s.lon] as [number, number]),
        { className: "mp-path", interactive: false },
      ).addTo(g);
    }
    spots.forEach((s, i) => {
      const mk = L.marker([s.lat, s.lon], {
        icon: L.divIcon({
          className: `mp-pin${pinned.includes(s.id) ? " pinned" : ""}${s.id === active ? " on" : ""}`,
          html: `<span class="mp-num">${i + 1}</span><span class="mp-name">${escapeHtml(s.name)}</span>`,
          iconSize: [0, 0],
        }),
        riseOnHover: true,
      }).addTo(g);
      mk.on("click", () => setActive(s.id));
      markers.current.set(s.id, mk);
    });
    const b = L.latLngBounds(spots.map((s) => [s.lat, s.lon] as [number, number]));
    window.setTimeout(() => m.fitBounds(b, { padding: [36, 36], maxZoom: spots.length === 1 ? 9 : 10 }), 280);
  }, [spots, pinned, active, query]);
  useEffect(() => {
    const s = spots.find((x) => x.id === active);
    if (s && map.current) map.current.panTo([s.lat, s.lon], { animate: true });
    if (active) document.getElementById(`mp-row-${active}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active, spots]);

  const allPinned = spots.length > 0 && spots.every((s) => pinned.includes(s.id));
  return (
    <>
      <div className="mp-scrim" onClick={onClose} />
      <aside className="mp" role="dialog" aria-label={`Map: ${title}`}>
        <header className="mp-head">
          <div className="mp-title">
            <span className="mp-kicker">Map</span>
            <strong>{title}</strong>
            <span className="muted small">{loading ? "Finding places…" : `${spots.length} ${spots.length === 1 ? "place" : "places"}`}</span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close the map">
            ✕
          </button>
        </header>
        <div className="mp-map atlas-map" ref={el} />
        <div className="mp-actions">
          <Link className="btn" to={atlasUrl({ ...req, select: active ?? undefined })} onClick={onClose}>
            Open full atlas ↗
          </Link>
          {spots.length > 0 && (
            <button className="btn" onClick={() => (allPinned ? pins.remove(spots.map((s) => s.id)) : pins.add(spots.map((s) => s.id)))}>
              {allPinned ? "★ Unpin all" : "☆ Pin all"}
            </button>
          )}
          {spots.length > 1 && (
            <button className="btn" onClick={() => pins.saveSet(title, spots.map((s) => s.id))} title="Keep these places as a named set in the atlas">
              Save as set
            </button>
          )}
        </div>
        {!loading && spots.length === 0 && <p className="muted mp-empty">No mapped places here.</p>}
        <ol className="mp-list">
          {spots.map((s, i) => (
            <li key={s.id} id={`mp-row-${s.id}`} className={s.id === active ? "on" : ""}>
              <button className="mp-row" onClick={() => setActive(s.id)}>
                <span className="mp-n">{i + 1}</span>
                <span className="mp-row-name">
                  {s.name}
                  {s.modern_name && <span className="muted small"> · today {s.modern_name}</span>}
                </span>
              </button>
              {s.first_osis && (
                <Link className="mp-ref" to={verseUrl(s.first_osis)} onClick={onClose}>
                  {osisLabel(s.first_osis, books)}
                </Link>
              )}
              <button className={`mp-star${pinned.includes(s.id) ? " on" : ""}`} onClick={() => pins.toggle(s.id)} aria-label={pinned.includes(s.id) ? `Unpin ${s.name}` : `Pin ${s.name}`}>
                {pinned.includes(s.id) ? "★" : "☆"}
              </button>
            </li>
          ))}
        </ol>
      </aside>
    </>
  );
}
