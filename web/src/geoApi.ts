import { useQuery } from "@tanstack/react-query";
import { getJson } from "./api";
import { formatYear } from "./lib";

/** A place on the atlas (every place with coordinates). */
export interface AtlasPlace {
  id: string;
  name: string;
  kind: string | null;
  lat: number;
  lon: number;
  precision: "exact" | "approximate" | "unknown" | null;
  modern_name: string | null;
  confidence: number | null;
  verses: number;
  books: number[]; // book order numbers (Gen = 1)
}
export interface RouteSummary {
  id: string;
  kind: string;
  name: string | null;
  date_from: number | null;
  date_to: number | null;
  source_id: string | null;
}
export interface Atlas {
  places: AtlasPlace[];
  routes: RouteSummary[];
}
export interface RouteStop {
  name: string;
  osis: string;
  lat: number;
  lon: number;
  place: string | null;
}
export interface RouteFeature extends RouteSummary {
  geojson: {
    type: "Feature";
    geometry: { type: "MultiLineString"; coordinates: number[][][] };
    properties: { journey?: number; refs?: string; stops?: RouteStop[] };
  };
}

export interface VerseGroup {
  book: string;
  name: string;
  testament: string;
  refs: string[]; // "chapter.verse"
}
export interface Verses {
  count: number;
  books: VerseGroup[];
  samples: { osis: string; text: string | null }[];
}
export interface EventSummary {
  id: string;
  title: string;
  kind: string;
  place_id: string | null;
  place: string | null;
  year: number | null;
  end_year: number | null;
  osis: string | null;
}
export interface PersonSummary {
  id: string;
  name: string;
  summary: string | null;
  kind?: string;
  sex?: string | null;
  roles?: string[];
  role?: string | null;
}
export interface PlaceSummary {
  id: string;
  name: string;
  kind: string | null;
  lat: number | null;
  lon: number | null;
  roles?: string[];
  km?: number;
}
export interface Dating {
  aspect: string;
  system_id: string;
  system: string | null;
  date_kind: string;
  start_year: number | null;
  end_year: number | null;
  start_month: number | null;
  start_day: number | null;
  circa: number;
  label: string | null;
}

export interface PlaceView {
  place: {
    id: string;
    name: string;
    alt_names: string[];
    kind: string | null;
    lat: number | null;
    lon: number | null;
    precision: string | null;
    modern_name: string | null;
    summary: string | null;
    source_id: string | null;
    source_name: string | null;
    confidence: number | null;
    easton: string | null;
    external: Record<string, string>;
  };
  verses: Verses;
  events: EventSummary[];
  people: PersonSummary[];
  nearby: PlaceSummary[];
  routes: string[];
}
export type FamilyKey = "parents" | "spouses" | "siblings" | "half_siblings" | "children";
export interface PersonView {
  person: {
    id: string;
    name: string;
    alt_names: string[];
    sex: string | null;
    kind: string;
    born: number | null;
    died: number | null;
    summary: string | null;
    bio: string | null;
    source_id: string | null;
    source_name: string | null;
    groups: string[];
    wrote: { osis: string; name: string }[];
    external: Record<string, string>;
    dating: Dating[];
  };
  family: Partial<Record<FamilyKey, PersonSummary[]>>;
  events: EventSummary[];
  places: PlaceSummary[];
  verses: Verses;
}
export interface EventView {
  event: {
    id: string;
    title: string;
    kind: string;
    description: string | null;
    place_id: string | null;
    source_id: string | null;
    source_name: string | null;
    external: Record<string, string>;
    dating: Dating[];
  };
  people: PersonSummary[];
  places: PlaceSummary[];
  refs: { start_vkey: number; end_vkey: number; osis: string; end_osis: string }[];
  passage: { osis: string; text: string }[];
  related: Partial<Record<"part_of" | "parts" | "after" | "before", EventSummary[]>>;
}
export interface VerseEntities {
  osis: string;
  people: { id: string; name: string; summary: string | null; verses: number }[];
  places: { id: string; name: string; kind: string | null; lat: number | null; lon: number | null; modern_name: string | null }[];
  events: { id: string; title: string }[];
}

const FOREVER = { staleTime: Infinity, gcTime: 30 * 60_000 } as const;

export const useAtlas = () => useQuery({ queryKey: ["atlas"], queryFn: () => getJson<Atlas>("/api/atlas"), ...FOREVER });
export const useAtlasRoutes = (enabled: boolean) =>
  useQuery({ queryKey: ["atlas-routes"], queryFn: () => getJson<RouteFeature[]>("/api/atlas/routes"), enabled, ...FOREVER });
export const usePlace = (id: string | null | undefined) =>
  useQuery({ queryKey: ["place", id], queryFn: () => getJson<PlaceView>(`/api/place/${encodeURIComponent(id!)}`), enabled: !!id, ...FOREVER });
export const usePerson = (id: string | undefined) =>
  useQuery({ queryKey: ["person", id], queryFn: () => getJson<PersonView>(`/api/person/${encodeURIComponent(id!)}`), enabled: !!id, ...FOREVER });
export const useEvent = (id: string | undefined) =>
  useQuery({ queryKey: ["event", id], queryFn: () => getJson<EventView>(`/api/event/${encodeURIComponent(id!)}`), enabled: !!id, ...FOREVER });
/** A passage's (or a person's, an event's) mapped places in the order the text first names them. */
export interface PlacesIn {
  title: string;
  places: { id: string; name: string; kind: string | null; lat: number; lon: number; modern_name: string | null; n: number; first_osis: string }[];
}
export const usePlacesIn = (q: { ref?: string; person?: string; event?: string } | null) =>
  useQuery({
    queryKey: ["places-in", q?.ref, q?.person, q?.event],
    queryFn: () => getJson<PlacesIn>("/api/places/in", Object.fromEntries(Object.entries(q ?? {}).filter(([, v]) => v)) as Record<string, string>),
    enabled: !!(q && (q.ref || q.person || q.event)),
    ...FOREVER,
  });
export const useVerseEntities = (osis: string) =>
  useQuery({ queryKey: ["verse-entities", osis], queryFn: () => getJson<VerseEntities>(`/api/verse/${osis}/entities`), ...FOREVER });

/** How sure scholars are of a site, in words (OpenBible's identification score, 0–1). */
export function confidenceBand(c: number | null | undefined): "certain" | "likely" | "uncertain" | "unknown" {
  if (c === null || c === undefined) return "unknown";
  if (c >= 0.8) return "certain";
  if (c >= 0.4) return "likely";
  return "uncertain";
}
export const CONFIDENCE_LABEL: Record<ReturnType<typeof confidenceBand>, string> = {
  certain: "Location certain",
  likely: "Location probable",
  uncertain: "Location uncertain",
  unknown: "Location approximate",
};

export const KIND_LABEL: Record<string, string> = {
  city: "Town or city",
  region: "Region or people",
  mountain: "Mountain or hill",
  river: "River or stream",
  water: "Sea, lake or spring",
  island: "Island",
  valley: "Valley or open country",
  camp: "Camp in the wilderness",
  site: "Site",
  other: "Place",
};

/** A Theographic-style date for display: "c. 1446 BC", "AD 30–33", "1491 BC (Jones)". */
export function yearRange(start: number | null | undefined, end?: number | null): string {
  if (start === null || start === undefined) return "";
  if (end === null || end === undefined || end === start) return formatYear(start);
  if (start <= 0 && end <= 0) return `${1 - start}–${1 - end} BC`;
  if (start > 0) return `AD ${start}–${end}`;
  return `${formatYear(start)} – ${formatYear(end)}`;
}

/** "3.16" refs of one book → compact "3:16, 17; 4:2" style labels with their OSIS ids. */
export function refLinks(book: string, refs: string[]): { label: string; osis: string }[] {
  let chapter = "";
  return refs.map((r) => {
    const [c, v] = r.split(".");
    const label = c === chapter ? v! : `${c}:${v}`;
    chapter = c!;
    return { label, osis: `${book}.${r}` };
  });
}
