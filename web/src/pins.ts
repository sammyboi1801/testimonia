import { useSyncExternalStore } from "react";
import { onRemoteChange } from "./sync";

/** Pinned places and named sets of them ("Elijah's journeys"), kept in this browser like the notes. */
export interface PinSet {
  id: string;
  name: string;
  places: string[];
  created: string;
}
interface PinState {
  pinned: string[];
  sets: PinSet[];
}

const KEY = "testimonia.pins.v1";
let state: PinState = load();
const listeners = new Set<() => void>();
// signed in: pins changed on another device
onRemoteChange(KEY, () => {
  state = load();
  listeners.forEach((l) => l());
});

function load(): PinState {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as PinState | null;
    if (s && Array.isArray(s.pinned) && Array.isArray(s.sets)) return s;
  } catch {
    /* unavailable or corrupt: start empty */
  }
  return { pinned: [], sets: [] };
}
function commit(next: PinState) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage full or unavailable */
  }
  listeners.forEach((l) => l());
}

export const pins = {
  get: () => state,
  isPinned: (id: string) => state.pinned.includes(id),
  toggle: (id: string) => commit({ ...state, pinned: state.pinned.includes(id) ? state.pinned.filter((x) => x !== id) : [...state.pinned, id] }),
  add: (ids: string[]) => commit({ ...state, pinned: [...new Set([...state.pinned, ...ids])] }),
  remove: (ids: string[]) => commit({ ...state, pinned: state.pinned.filter((x) => !ids.includes(x)) }),
  clear: () => commit({ ...state, pinned: [] }),
  saveSet: (name: string, places: string[]) => {
    const clean = name.trim().slice(0, 80) || "My places";
    const existing = state.sets.find((s) => s.name.toLowerCase() === clean.toLowerCase());
    const set: PinSet = { id: existing?.id ?? Date.now().toString(36), name: clean, places: [...new Set(places)], created: existing?.created ?? new Date().toISOString() };
    commit({ ...state, sets: [set, ...state.sets.filter((s) => s.id !== set.id)] });
    return set;
  },
  deleteSet: (id: string) => commit({ ...state, sets: state.sets.filter((s) => s.id !== id) }),
};

export function usePins(): PinState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

// ----------------------------------------------------------------------------- the map panel

/** What the map panel should show: a passage, a person's or an event's places, or a list of place ids. */
export interface MapRequest {
  ref?: string;
  person?: string;
  event?: string;
  places?: string[];
  title?: string;
  select?: string; // a place to open first
}
const MAP_EVENT = "testimonia:map";
export function openMap(req: MapRequest): void {
  window.dispatchEvent(new CustomEvent<MapRequest>(MAP_EVENT, { detail: req }));
}
export function onOpenMap(fn: (r: MapRequest) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent<MapRequest>).detail);
  window.addEventListener(MAP_EVENT, h);
  return () => window.removeEventListener(MAP_EVENT, h);
}
/** The same request as a link to the full atlas. */
export function atlasUrl(r: MapRequest): string {
  const q = new URLSearchParams();
  if (r.ref) q.set("focus", r.ref);
  if (r.person) q.set("person", r.person);
  if (r.event) q.set("event", r.event);
  if (r.places?.length) q.set("show", r.places.join(","));
  if (r.select) q.set("place", r.select);
  return `/atlas?${q.toString()}`;
}

// ----------------------------------------------------------------------------- what the assistant can see

/** The map panel's current contents, so the assistant knows what the reader is looking at. */
let mapContext: { title: string; places: string[] } | null = null;
export function setMapContext(c: { title: string; places: string[] } | null): void {
  mapContext = c;
}
/** One line for the assistant: the open map and the reader's pins. */
export function mapScreenContext(): string {
  const parts: string[] = [];
  if (mapContext) {
    const names = mapContext.places.slice(0, 30).map((n, i) => `${i + 1}. ${n}`).join(", ");
    parts.push(`the map beside the text shows ${mapContext.title}: ${names}${mapContext.places.length > 30 ? " …" : ""}`);
  }
  if (state.pinned.length) parts.push(`${state.pinned.length} pinned places${state.sets.length ? ` and saved sets: ${state.sets.map((s) => s.name).join(", ")}` : ""}`);
  return parts.join("; ");
}
