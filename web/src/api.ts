import { useQuery } from "@tanstack/react-query";
import type { BookGuide, Chapter, Meta, RefResult, SearchResults, SectionView, Timeline, Toc, VerseGuide, WikiSummary, WordStudy, WorkSummary } from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Where the API lives: same origin by default, or a separate server (e.g. Cloud Run behind Firebase Hosting). */
export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/+$/, "") ?? "";
// the assistant streams its answers: it talks to the server directly (VITE_AGENT_BASE), never through a cache
const AGENT_BASE = (import.meta.env.VITE_AGENT_BASE as string | undefined)?.replace(/\/+$/, "") ?? API_BASE;
export const apiUrl = (path: string) => `${path.startsWith("/api/agent") ? AGENT_BASE : API_BASE}${path}`;

/** Where the Bible's static files live (written by `testimonia export-static`); empty = always ask the API. */
const STATIC = (import.meta.env.VITE_STATIC_DATA as string | undefined)?.replace(/\/+$/, "") ?? "";
const WORD_EDITIONS = new Set(["tagnt", "tahot", "lxx"]);

async function staticJson<T>(path: string): Promise<T | null> {
  const res = await fetch(`${STATIC}/${path}`);
  if (res.status === 404) return null;
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) throw new Error(`static ${res.status}`);
  return (await res.json()) as T;
}

/** A chapter from the static files: the chapter itself, then each edition, fetched together and merged into the
 *  same shape as /api/chapter. Throws (so the API is asked instead) when the files are not there. */
async function staticChapter(book: string, chapter: number, editions: string[]): Promise<Chapter> {
  if (!STATIC) throw new Error("no static data");
  const base = await staticJson<Omit<Chapter, "editions"> & { present?: string[] }>(`chapter/${book}/${chapter}.json`);
  if (!base?.present) throw new Error("chapter not exported");
  // only the editions that have this chapter (the BSB has no Tobit): nothing is asked for in vain
  const parts = await Promise.all(
    editions.map((ed) => (base.present!.includes(ed) ? staticJson<Record<string, unknown>>(`text/${encodeURIComponent(ed)}/${book}/${chapter}.json`) : null)),
  );
  const verses = base.verses.map((v) => ({ ...v, texts: {} as Record<string, unknown>, words: {} as Record<string, unknown> }));
  const byKey = new Map(verses.map((v) => [String(v.vkey), v]));
  editions.forEach((ed, i) => {
    for (const [k, val] of Object.entries(parts[i] ?? {})) {
      const v = byKey.get(k);
      if (v) (WORD_EDITIONS.has(ed) ? v.words : v.texts)[ed] = val;
    }
  });
  return { ...base, editions, verses } as unknown as Chapter;
}

export async function getJson<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(apiUrl(path), window.location.origin);
  for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  const res = await fetch(url);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { detail?: string };
      detail = body.detail ?? detail;
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

const FOREVER = { staleTime: Infinity, gcTime: 30 * 60_000 } as const; // core.db is read-only

/** The library's own data (meta, works, timeline): the static copy from the CDN first (compressed, at every edge),
 *  the API when there is none. */
const libraryJson = <T,>(name: "meta" | "works" | "timeline") => async (): Promise<T> => {
  if (STATIC) {
    try {
      const hit = await staticJson<T>(`lib/${name}.json`);
      if (hit) return hit;
    } catch {
      /* not exported: ask the API */
    }
  }
  return getJson<T>(`/api/${name}`);
};

export const useMeta = () => useQuery({ queryKey: ["meta"], queryFn: libraryJson<Meta>("meta"), ...FOREVER });

export const useChapter = (book: string, chapter: number, editions: string[]) =>
  useQuery({
    queryKey: ["chapter", book, chapter, editions.join(",")],
    queryFn: () => staticChapter(book, chapter, editions).catch(() => getJson<Chapter>(`/api/chapter/${book}/${chapter}`, { editions: editions.join(",") })),
    ...FOREVER,
  });

export const useVerse = (osis: string | null) =>
  useQuery({
    queryKey: ["verse", osis],
    // ?r= changes whenever the verse data does, so the CDN's cached copies are not served after an update
    queryFn: () => getJson<VerseGuide>(`/api/verse/${osis}`, { r: 2 }),
    enabled: !!osis,
    ...FOREVER,
  });

export const useWord = (strong: string | null) =>
  useQuery({
    queryKey: ["word", strong],
    queryFn: () => getJson<WordStudy>(`/api/word/${strong}`),
    enabled: !!strong,
    ...FOREVER,
  });

export const useTimeline = () => useQuery({ queryKey: ["timeline"], queryFn: libraryJson<Timeline>("timeline"), ...FOREVER });

/** Wikipedia's page summary (CC BY-SA), fetched live from the public REST API and cached for the session. */
export async function wikiSummary(title: string): Promise<WikiSummary> {
  const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replaceAll(" ", "_"))}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Wikipedia: ${res.status}`);
  return (await res.json()) as WikiSummary;
}
export const useWiki = (title: string | null | undefined, enabled = true) =>
  useQuery({ queryKey: ["wiki", title], queryFn: () => wikiSummary(title!), enabled: !!title && enabled, staleTime: Infinity, gcTime: Infinity, retry: 0 });

export const useBookGuide = (osis: string) =>
  useQuery({ queryKey: ["book", osis], queryFn: () => getJson<BookGuide>(`/api/book/${encodeURIComponent(osis)}`), ...FOREVER });

export const useWorks = () => useQuery({ queryKey: ["works"], queryFn: libraryJson<WorkSummary[]>("works"), ...FOREVER });

export const useToc = (edition: string | undefined) =>
  useQuery({
    queryKey: ["toc", edition],
    queryFn: () => getJson<Toc>(`/api/edition/${encodeURIComponent(edition ?? "")}/toc`),
    enabled: !!edition,
    ...FOREVER,
  });

export const useSection = (edition: string | undefined, ord: number) =>
  useQuery({
    queryKey: ["section", edition, ord],
    queryFn: () => getJson<SectionView>(`/api/edition/${encodeURIComponent(edition ?? "")}/section/${ord}`),
    enabled: !!edition,
    ...FOREVER,
  });

export const useSearch = (q: string, scope = "all") =>
  useQuery({
    queryKey: ["search", q, scope],
    queryFn: () => getJson<SearchResults>("/api/search", { q, scope, limit: 40 }),
    enabled: q.trim().length > 0,
    ...FOREVER,
  });

export const resolveRef = (q: string) => getJson<RefResult>("/api/resolve", { q });
