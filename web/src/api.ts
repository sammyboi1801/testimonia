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
export const apiUrl = (path: string) => `${API_BASE}${path}`;

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

export const useMeta = () => useQuery({ queryKey: ["meta"], queryFn: () => getJson<Meta>("/api/meta"), ...FOREVER });

export const useChapter = (book: string, chapter: number, editions: string[]) =>
  useQuery({
    queryKey: ["chapter", book, chapter, editions.join(",")],
    queryFn: () => getJson<Chapter>(`/api/chapter/${book}/${chapter}`, { editions: editions.join(",") }),
    ...FOREVER,
  });

export const useVerse = (osis: string | null) =>
  useQuery({
    queryKey: ["verse", osis],
    queryFn: () => getJson<VerseGuide>(`/api/verse/${osis}`),
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

export const useTimeline = () => useQuery({ queryKey: ["timeline"], queryFn: () => getJson<Timeline>("/api/timeline"), ...FOREVER });

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

export const useWorks = () => useQuery({ queryKey: ["works"], queryFn: () => getJson<WorkSummary[]>("/api/works"), ...FOREVER });

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
