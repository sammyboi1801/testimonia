// Study tools (passage guide, grammar search, word charts): types and hooks for testimonia/server/study.py.
import { useQuery } from "@tanstack/react-query";
import { getJson } from "./api";
import type { Footnote, Reading } from "./types";

const FOREVER = { staleTime: Infinity, gcTime: 30 * 60_000 } as const; // core.db is read-only

export interface PassageVariant {
  id: number;
  start_vkey: number;
  osis: string;
  label: string;
  significance: string;
  note: string | null;
  readings: Reading[];
}

export interface PassageWriter {
  id: string;
  author_id: string | null;
  name: string;
  year: number | null;
  era: string | null;
  category: string;
  pre_nicene: boolean;
  n: number; // citations
  places: number; // distinct places in their works
  verses: string[];
  works: {
    work_id: string;
    work_title: string;
    cite: string | null;
    edition_id: string | null;
    section_ord: number | null;
    kind: string | null;
    snippet: string | null;
    osis: string;
    times: number;
  }[];
}

export interface PassageGuide {
  range: { ref: string; start: string; end: string; label: string; book: string; name: string; testament: string; chapter: number };
  edition: { id: string; abbrev: string | null };
  verses: { vkey: number; osis: string; chapter: number; verse: number; text: string | null }[];
  headings: { title: string; start_vkey: number; end_vkey: number; osis: string }[];
  prev: { title: string; ref: string } | null;
  next: { title: string; ref: string } | null;
  variants: PassageVariant[];
  fathers: PassageWriter[];
  witnesses: PassageWriter[];
  crossrefs: { osis: string; end_osis: string | null; votes: number; from: string[]; text: string | null }[];
  quotations: { direction: "quotes" | "quoted_by"; here: string; other: string; kind: string | null; via: string | null; text: string | null }[];
  topics: { id: string; name: string; n: number }[];
  footnotes: (Footnote & { osis: string; edition_id: string; abbrev: string | null; language: string })[];
  chronology: { labels: string[]; start_year: number | null; end_year: number | null } | null;
  periods: { id: string; name: string; parent_id: string | null }[];
}

export const usePassage = (ref: string, edition: string) =>
  useQuery({
    queryKey: ["passage", ref, edition],
    queryFn: () => getJson<PassageGuide>(`/api/passage/${encodeURIComponent(ref)}`, { edition }),
    enabled: !!ref,
    ...FOREVER,
  });

export interface GrammarWord {
  pos: number;
  surface: string;
  hit?: boolean;
  lemma_id?: string | null;
  morph?: string | null;
  parse?: string;
  gloss?: string | null;
  only_in?: string | null;
}

export interface GrammarResults {
  language: "grc" | "hbo";
  query: Record<string, string | null>;
  lemmas: { id: string; lemma: string; translit: string | null; gloss: string | null }[];
  total: number;
  verses: number;
  page: number;
  size: number;
  by_book: { book: string; name: string; n: number }[];
  results: { osis: string; book: string; words: GrammarWord[]; text: string | null }[];
  message?: string;
}

export const useGrammar = (params: Record<string, string>) => {
  const key = new URLSearchParams(params).toString();
  return useQuery({
    queryKey: ["grammar", key],
    queryFn: () => getJson<GrammarResults>("/api/grammar", params),
    enabled: Object.keys(params).some((k) => !["page", "size", "lang", "book", "edition"].includes(k)),
    ...FOREVER,
  });
};

export const useWordChapters = (strong: string) =>
  useQuery({
    queryKey: ["word-chapters", strong],
    queryFn: () => getJson<{ chapters: { book: string; name: string; chapter: number; n: number }[] }>(`/api/word/${strong}/chapters`),
    ...FOREVER,
  });

export const useWordInBook = (strong: string, book: string | null) =>
  useQuery({
    queryKey: ["word-in-book", strong, book],
    queryFn: () =>
      getJson<{ vkey: number; osis: string; surface: string; gloss: string | null; morph: string | null }[]>(`/api/word/${strong}/book/${book}`),
    enabled: !!book,
    ...FOREVER,
  });
