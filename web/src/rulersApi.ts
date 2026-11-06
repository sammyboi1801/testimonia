import { useQuery } from "@tanstack/react-query";
import { getJson } from "./api";
import { formatYear } from "./lib";

/** One chronology system's dates for a reign (astronomical years: 1 BC = 0). */
export interface ReignDates {
  start: number;
  end: number;
  circa: boolean;
  label: string | null; // as the source writes it: "716/15–687/86 BC"
  basis: string | null; // citation
  shared_from: number | null; // a coregency or rival reign before the sole reign
  shared_kind: "coregency" | "rival" | null;
}
export interface Ruler {
  id: string; // office holding: "hezekiah@judah"
  person_id: string;
  name: string;
  realm: string;
  office: string;
  dynasty: string | null;
  scope: string | null; // "named": shown at a verse only when its chapter names them
  note: string | null;
  wikipedia: string | null;
  verses: number;
  first_osis: string | null;
  system: string | null; // the system the server picked (realm default)
  system_name: string | null;
  start: number | null;
  end: number | null;
  circa: boolean | null;
  label: string | null;
  shared_from: number | null;
  shared_kind: "coregency" | "rival" | null;
  dates: Record<string, ReignDates>;
}
export interface Realm {
  id: string;
  name: string;
  short: string;
  office: string;
  style: "of" | "office";
  kind: "local" | "overlord" | "named";
  sort: number;
  systems: string[]; // first = default
  overlord: [number, number] | null;
  description: string | null;
  citation: string | null;
  start: number;
  end: number;
  rulers: Ruler[];
}
export interface ChronologySystem {
  id: string;
  name: string;
  kind: string | null;
  description: string | null;
}
export interface Rulers {
  systems: ChronologySystem[];
  realms: Realm[];
}
export interface UnderRuler {
  id: string;
  person_id: string;
  name: string;
  office: string;
  realm: string;
  realm_name: string;
  realm_short: string;
  style: "of" | "office";
  system: string | null;
  system_name: string | null;
  start: number | null;
  end: number | null;
  circa: boolean | null;
  label: string | null;
  shared_from: number | null;
  shared_kind: string | null;
  named: boolean;
  coregent: boolean;
}
export interface VerseRulers {
  osis: string;
  window: { start: number; end: number; label: string | null } | null;
  rulers: UnderRuler[];
}
export interface PersonReign extends Ruler {
  realm_name: string;
  realm_short: string;
  style: "of" | "office";
}

const FOREVER = { staleTime: Infinity, gcTime: 30 * 60_000 } as const;

export const useRulers = (enabled = true) =>
  useQuery({ queryKey: ["rulers"], queryFn: () => getJson<Rulers>("/api/rulers"), enabled, ...FOREVER });
export const useVerseRulers = (osis: string, system: string | null) =>
  useQuery({
    queryKey: ["verse-rulers", osis, system],
    queryFn: () => getJson<VerseRulers>(`/api/verse/${osis}/rulers`, { system: system ?? undefined }),
    ...FOREVER,
  });
export const usePersonReigns = (id: string | undefined) =>
  useQuery({
    queryKey: ["person-reigns", id],
    queryFn: () => getJson<{ person_id: string; systems: Record<string, string>; reigns: PersonReign[] }>(`/api/rulers/person/${encodeURIComponent(id!)}`),
    enabled: !!id,
    ...FOREVER,
  });

/** The chronology the reader chose for Israel and Judah (kept in this browser only). */
const KEY = "testimonia.chronology";
export const CHRONOLOGIES = ["thiele", "galil", "albright"] as const;
export function savedChronology(): string | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v && (CHRONOLOGIES as readonly string[]).includes(v) ? v : null;
  } catch {
    return null;
  }
}
export function saveChronology(system: string): void {
  try {
    window.localStorage.setItem(KEY, system);
  } catch {
    /* private mode: the choice lasts for this page only */
  }
}

/** A reign's dates in the chosen system, else its realm's default, else any curated system. */
export function datesFor(r: Ruler, realm: Realm, system: string | null): { system: string; d: ReignDates } | null {
  for (const sid of [...(system ? [system] : []), ...realm.systems]) if (r.dates[sid]) return { system: sid, d: r.dates[sid]! };
  const any = Object.keys(r.dates).find((s) => s !== "wikidata");
  return any ? { system: any, d: r.dates[any]! } : null;
}

/** First and last year, including a coregency or rival reign. */
export const spanOf = (d: Pick<ReignDates, "start" | "end" | "shared_from">): [number, number] => [d.shared_from ?? d.start, d.end];

/** "716–687 BC", "AD 14–37", "4 BC – AD 39", "c. 1010–970 BC". */
export function reignRange(start: number | null, end: number | null, circa = false): string {
  if (start === null) return "";
  const c = circa ? "c. " : "";
  if (end === null || end === start) return c + formatYear(start);
  if (end <= 0) return `${c}${1 - start}–${1 - end} BC`;
  if (start > 0) return `${c}AD ${start}–${end}`;
  return `${c}${formatYear(start)} – ${formatYear(end)}`;
}

/** The dates as the source gives them, without the explanation in brackets ("716/15–687/86 BC"). */
export function shortLabel(d: { start: number | null; end: number | null; circa: boolean | null; label: string | null }): string {
  const label = d.label?.replace(/\s*\(.*\)\s*$/, "").trim();
  if (label && /\d/.test(label)) return /BC|AD/.test(label) || (d.start ?? 0) > 0 ? label : `${label} BC`;
  return reignRange(d.start, d.end, !!d.circa);
}

export const SHARED_LABEL: Record<string, string> = { coregency: "coregent", rival: "rival reign" };

/** "Hezekiah of Judah" or "Pontius Pilate, prefect of Judaea". */
export function rulerTitle(name: string, office: string, short: string, style: "of" | "office"): string {
  return style === "of" ? `${name} of ${short}` : `${name}, ${office.charAt(0).toLowerCase()}${office.slice(1)}`;
}
