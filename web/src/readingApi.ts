// Reading aids: topic pages, reading plans and the Gospel synopsis — API hooks, types and small pure helpers.
import { useQuery } from "@tanstack/react-query";
import { getJson } from "./api";

const FOREVER = { staleTime: Infinity, gcTime: 30 * 60_000 } as const; // core.db is read-only

// ----------------------------------------------------------------------------- topics

export interface TopicSummary {
  id: string;
  name: string;
  verses: number;
}

export interface TopicDetail {
  topic: { id: string; name: string; body: string | null; source_id: string };
  books: { book: string; name: string; testament: string; verses: number }[];
  total: number;
  book: string | null;
  verses: { vkey: number; osis: string; text: string | null }[];
  truncated: boolean;
  related: { id: string; name: string; kind: "see" | "shared"; shared?: number }[];
  fathers: {
    id: string;
    name: string;
    year: number | null;
    n: number;
    verses: number;
    pre_nicene: boolean;
    sample: { work_title: string; cite: string | null; edition_id: string | null; section_ord: number | null; osis: string; snippet: string | null } | null;
  }[];
  connections: { a: string; b: string; votes: number | null }[];
}

/** The translation to show: the reader's first text column (not the Greek/Hebrew word editions), else the BSB. */
export function preferredTranslation(editions: string[]): string {
  return editions.find((e) => e !== "tagnt" && e !== "tahot") ?? "bsb";
}

export const useTopics = () =>
  useQuery({ queryKey: ["topics"], queryFn: () => getJson<{ topics: TopicSummary[]; total: number }>("/api/topics"), ...FOREVER });

export const useTopic = (id: string, edition: string, book: string | null) =>
  useQuery({
    queryKey: ["topic", id, edition, book],
    queryFn: () => getJson<TopicDetail>(`/api/topic/${encodeURIComponent(id)}`, { edition, book: book ?? undefined }),
    enabled: !!id,
    ...FOREVER,
  });

export const topicUrl = (id: string) => `/topic/${encodeURIComponent(id)}`;

// ----------------------------------------------------------------------------- reading plans

export interface PlanSummary {
  id: string;
  title: string;
  description: string;
  days: number;
}

export interface PlanReading {
  label: string;
  book: string;
  chapters: number[];
  osis: string;
  end_osis?: string;
  verses?: number;
  title?: string;
  citations?: number;
  cited_by?: string[];
}

export interface Plan extends Omit<PlanSummary, "days"> {
  days: { day: number; readings: PlanReading[] }[];
}

export const usePlans = () => useQuery({ queryKey: ["plans"], queryFn: () => getJson<PlanSummary[]>("/api/plans"), ...FOREVER });

export const usePlan = (id: string | undefined) =>
  useQuery({ queryKey: ["plan", id], queryFn: () => getJson<Plan>(`/api/plan/${encodeURIComponent(id ?? "")}`), enabled: !!id, ...FOREVER });

/** Progress on one plan, kept in this browser only. */
export interface PlanProgress {
  start: string | null; // 'YYYY-MM-DD'
  done: number[]; // day numbers ticked off
}

const PROGRESS_KEY = "testimonia.plans";

export function loadProgress(id: string): PlanProgress {
  try {
    const all = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? "{}") as Record<string, Partial<PlanProgress>>;
    const p = all[id];
    return { start: typeof p?.start === "string" ? p.start : null, done: Array.isArray(p?.done) ? p.done.filter((d) => Number.isInteger(d)) : [] };
  } catch {
    return { start: null, done: [] };
  }
}

export function saveProgress(id: string, p: PlanProgress): void {
  try {
    const all = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? "{}") as Record<string, PlanProgress>;
    if (!p.start && !p.done.length) delete all[id];
    else all[id] = { start: p.start, done: [...new Set(p.done)].sort((a, b) => a - b) };
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
  } catch {
    /* private mode: progress lasts for this visit only */
  }
}

/** Local calendar date as 'YYYY-MM-DD'. */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The plan day (1-based) that falls on `today` for a plan started on `start`, clamped to the plan's length. */
export function dayOf(start: string, today: string, days: number): number {
  const ms = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
  if (Number.isNaN(ms)) return 1;
  return Math.min(days, Math.max(1, Math.round(ms / 86_400_000) + 1));
}

/** The calendar date of plan day `day` ('YYYY-MM-DD'). */
export function dateOf(start: string, day: number): string {
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + day - 1);
  return d.toISOString().slice(0, 10);
}

// ----------------------------------------------------------------------------- Gospel synopsis

export interface SectionPassage {
  osis: string;
  end_osis: string;
  label: string;
  anchor: boolean;
}

export interface SynopsisSection {
  id: string;
  n: number;
  title: string;
  source: string;
  anchor: string;
  passages: Partial<Record<string, SectionPassage[]>>;
}

export interface GreekWord {
  surface: string;
  lemma_id: string | null;
  gloss: string | null;
}

export interface ParallelVerse {
  osis: string;
  chapter: number;
  verse: number;
  text: string | null;
  greek: GreekWord[];
  codes: string | null;
}

export interface ParallelSection {
  id: string;
  n: number;
  title: string;
  source: string;
  edition: string;
  total: number;
  columns: { gospel: string; name: string; passages: (SectionPassage & { verses: ParallelVerse[] })[] }[];
  prev: { id: string; title: string } | null;
  next: { id: string; title: string } | null;
}

export const GOSPELS = [
  { osis: "Matt", name: "Matthew", short: "Mt" },
  { osis: "Mark", name: "Mark", short: "Mk" },
  { osis: "Luke", name: "Luke", short: "Lk" },
  { osis: "John", name: "John", short: "Jn" },
] as const;

export const useParallels = (verse?: string, enabled = true) =>
  useQuery({
    queryKey: ["parallels", verse ?? ""],
    queryFn: () => getJson<{ sections: SynopsisSection[] }>("/api/parallels", { verse }),
    enabled,
    ...FOREVER,
  });

export const useParallel = (id: string | undefined, edition: string) =>
  useQuery({
    queryKey: ["parallel", id, edition],
    queryFn: () => getJson<ParallelSection>(`/api/parallel/${encodeURIComponent(id ?? "")}`, { edition }),
    enabled: !!id,
    ...FOREVER,
  });

export const parallelUrl = (id: string) => `/parallels/${encodeURIComponent(id)}`;

/** Words of a text, each with the form used for comparison (lower case, no accents or punctuation). */
export function tokens(text: string): { word: string; key: string }[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => ({
      word,
      key: word
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]/gu, ""),
    }));
}

/** Indices of `a` that belong to a longest common subsequence with `b` (by comparison key). */
function lcsMatches(a: string[], b: string[]): Set<number> {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i]!;
    const next = dp[i + 1]!;
    for (let j = m - 1; j >= 0; j--) row[j] = a[i] && a[i] === b[j] ? next[j + 1]! + 1 : Math.max(next[j]!, row[j + 1]!);
  }
  const hits = new Set<number>();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] && a[i] === b[j]) {
      hits.add(i);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return hits;
}

/**
 * For each text, which of its words also occur, in order, in at least one of the other texts
 * (word-level longest common subsequence against each other text in turn).
 */
export function sharedWords(texts: string[][]): boolean[][] {
  return texts.map((a, i) => {
    const shared = a.map(() => false);
    texts.forEach((b, j) => {
      if (i === j || !b.length) return;
      for (const k of lcsMatches(a, b)) shared[k] = true;
    });
    return shared;
  });
}
