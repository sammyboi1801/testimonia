// A guided tour the assistant built: stops the reader steps through with Next and Back, each opening a passage (and
// perhaps the map) with a line or two of explanation. One tour plays at a time; it survives a reload of the tab.

import { useSyncExternalStore } from "react";

export interface TourStop {
  title: string;
  text: string;
  osis?: string; // first verse of the passage to open
  end?: string; // its last verse
  label?: string; // "Acts 16:6–10"
  link?: string; // or an app page
  map?: { ref?: string; person?: string };
}

export interface Tour {
  title: string;
  steps: TourStop[];
}

interface State {
  tour: Tour | null;
  at: number;
}

const KEY = "testimonia.tour";
let state: State = load();
const listeners = new Set<() => void>();

function load(): State {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as State | null;
    if (s?.tour?.steps?.length) return { tour: s.tour, at: Math.min(Math.max(0, s.at | 0), s.tour.steps.length - 1) };
  } catch {
    /* none */
  }
  return { tour: null, at: 0 };
}

function set(next: State) {
  state = next;
  try {
    if (next.tour) sessionStorage.setItem(KEY, JSON.stringify(next));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: the tour lasts until the page reloads */
  }
  listeners.forEach((l) => l());
}

export function startTour(tour: Tour): void {
  if (tour.steps.length) set({ tour, at: 0 });
}
export function goToStop(i: number): void {
  if (state.tour) set({ tour: state.tour, at: Math.min(Math.max(0, i), state.tour.steps.length - 1) });
}
export function endTour(): void {
  set({ tour: null, at: 0 });
}

/** A tour is playing (read outside React, e.g. when the chat decides how much of the screen to take). */
export const tourPlaying = (): boolean => state.tour !== null;

export function useTour(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
