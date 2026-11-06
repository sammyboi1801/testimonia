// Leaflet with a local basemap: no tile server, no third-party requests. Imported only by lazily loaded
// modules (the atlas page and the map insets), so Leaflet stays out of the main bundle.
import type { Feature, FeatureCollection, Geometry } from "geojson";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { confidenceBand } from "../geoApi";

interface BaseProps {
  k: "land" | "lake" | "coast" | "river" | "sea";
  n?: string;
  r?: number;
}
type Basemap = FeatureCollection<Geometry, BaseProps> & { bbox: [number, number, number, number] };

let basemap: Promise<Basemap> | null = null;

/** Natural Earth land, lakes, coasts and rivers, simplified (web/public/atlas/basemap.json, built by tools/build_basemap.py). */
export function loadBasemap(): Promise<Basemap> {
  basemap ??= fetch(`${import.meta.env.BASE_URL}atlas/basemap.json`).then((r) => {
    if (!r.ok) throw new Error(`basemap: ${r.status}`);
    return r.json() as Promise<Basemap>;
  });
  return basemap;
}

export const ATTRIBUTION =
  '<a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">Natural Earth</a> · ' +
  'places <a href="https://www.openbible.info/geo/" target="_blank" rel="noreferrer">OpenBible.info</a> (CC BY) · ' +
  '<a href="https://github.com/robertrouse/theographic-bible-metadata" target="_blank" rel="noreferrer">Theographic</a> (CC BY-SA)';

/** A map with the antique-style basemap drawn in its own panes (sea is the container background). */
export function createMap(el: HTMLElement, opts: { interactive?: boolean; minZoom?: number } = {}): L.Map {
  const interactive = opts.interactive ?? true;
  const map = L.map(el, {
    zoomControl: interactive,
    attributionControl: interactive,
    minZoom: opts.minZoom ?? 3,
    maxZoom: 11,
    zoomSnap: 0.5,
    scrollWheelZoom: interactive,
    dragging: true,
    worldCopyJump: false,
    maxBounds: L.latLngBounds([0, -25], [58, 78]),
    maxBoundsViscosity: 0.8,
  });
  if (map.attributionControl) map.attributionControl.setPrefix(false).addAttribution(ATTRIBUTION);
  const panes: [string, number][] = [
    ["land", 200],
    ["water", 210],
    ["coast", 220],
    ["seaLabels", 230],
  ];
  for (const [name, z] of panes) {
    const pane = map.createPane(name);
    pane.style.zIndex = String(z);
    pane.style.pointerEvents = "none";
  }
  return map;
}

/** Draw the basemap; resolves when it is on the map. */
export async function addBasemap(map: L.Map, withSeaNames = true): Promise<void> {
  const data = await loadBasemap();
  const by = (k: BaseProps["k"]) => data.features.filter((f) => f.properties.k === k) as Feature<Geometry, BaseProps>[];
  const layer = (features: Feature<Geometry, BaseProps>[], pane: string, className: (f: Feature<Geometry, BaseProps>) => string, fill: boolean) =>
    L.geoJSON({ type: "FeatureCollection", features } as FeatureCollection, {
      pane,
      interactive: false,
      style: (f) => ({ className: className(f as Feature<Geometry, BaseProps>), fill, stroke: true, weight: 1 }),
    }).addTo(map);
  layer(by("land"), "land", () => "bm-land", true);
  layer(by("coast"), "coast", () => "bm-coast-halo", false);
  layer(by("coast"), "coast", () => "bm-coast", false);
  layer(by("river"), "water", (f) => `bm-river${(f.properties.r ?? 9) <= 5 ? " major" : ""}`, false);
  layer(by("lake"), "water", () => "bm-lake", true);
  if (withSeaNames) {
    for (const f of by("sea")) {
      const [lon, lat] = (f.geometry as GeoJSON.Point).coordinates as [number, number];
      L.marker([lat, lon], {
        pane: "seaLabels",
        interactive: false,
        keyboard: false,
        icon: L.divIcon({ className: "bm-sea", html: `<span>${f.properties.n ?? ""}</span>`, iconSize: [0, 0] }),
      }).addTo(map);
    }
  }
}

/** CSS classes for a place marker: kind and how certain its location is. */
export function placeClass(kind: string | null, confidence: number | null, extra = ""): string {
  return `pm pm-${kind ?? "site"} pm-${confidenceBand(confidence)}${extra ? ` ${extra}` : ""}`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
