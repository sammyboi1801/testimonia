import L from "leaflet";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { addBasemap, createMap, escapeHtml, placeClass } from "./atlasMap";

export interface MapPoint {
  id: string;
  name: string;
  kind: string | null;
  lat: number;
  lon: number;
  confidence?: number | null;
  main?: boolean;
}

/** A small map for a place, person or event page: its places on the local basemap, click one to open it. */
export default function MiniMap({ points, zoom = 8 }: { points: MapPoint[]; zoom?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const key = points.map((p) => p.id).join(",");

  useEffect(() => {
    if (!el.current || !points.length) return;
    const m = createMap(el.current, { minZoom: 3 });
    m.scrollWheelZoom.disable();
    let alive = true;
    addBasemap(m, false)
      .catch(() => undefined)
      .finally(() => {
        if (!alive) return;
        const group = L.featureGroup();
        // name every spot when there are few; regions (a representative point only) keep a hover label
        const named = points.filter((p) => p.kind !== "region").length <= 8;
        for (const p of [...points].sort((a, b) => Number(!!a.main) - Number(!!b.main))) {
          const marker = L.circleMarker([p.lat, p.lon], {
            radius: p.main ? 7 : 4,
            className: placeClass(p.kind, p.confidence ?? null, p.main ? "sel" : ""),
          });
          marker.bindTooltip(escapeHtml(p.name), { direction: "top", offset: [0, -4], className: "pm-tip", permanent: !!p.main || (named && p.kind !== "region") });
          if (!p.main) marker.on("click", () => navigate(`/place/${encodeURIComponent(p.id)}`));
          marker.addTo(group);
        }
        group.addTo(m);
        const main = points.find((p) => p.main);
        if (main && points.length === 1) m.setView([main.lat, main.lon], zoom);
        else m.fitBounds(group.getBounds().pad(0.25), { maxZoom: zoom });
      });
    return () => {
      alive = false;
      m.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, zoom]);

  return <div className="mini-map" ref={el} aria-label="Map" />;
}
