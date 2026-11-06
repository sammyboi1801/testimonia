// Deeper word study: semantic domains, senses, related words and Septuagint equivalents (MACULA data).
import { useQuery } from "@tanstack/react-query";
import { getJson } from "./api";

export interface DomainWord {
  id: string;
  lemma: string | null;
  translit: string | null;
  gloss: string | null;
  language: string;
  n: number;
  /** uses in the domain in question (its tokens whose sense in context lies in that domain) */
  n_field: number;
  /** lemma ids merged under this one (STEPBible splits some lemmas by sense: H1697G, H1697I…) */
  ids: string[];
  /** first verse the word occurs in (OSIS), for opening its word study in the reader */
  first: string | null;
}

export interface WordSense {
  id: string; // 'LN:33.98' | 'SDBH:002003003004'
  code: string;
  gloss: string | null;
  label: string | null;
  field: string;
  n: number;
}

export interface SemanticField {
  id: string;
  parent_id: string | null;
  system: string;
  system_name: string;
  label: string;
  description: string | null;
  n: number;
  senses: string[];
  total_words: number;
  words: (DomainWord & { same_sense: boolean })[];
}

export interface WordDomainsData {
  strong: string;
  language: "grc" | "hbo";
  senses: WordSense[];
  fields: SemanticField[];
  lxx: { direction: "greek" | "hebrew"; total: number; words: { id: string; ids: string[]; lemma: string | null; translit: string | null; gloss: string | null; n: number }[] };
  credit: string | null;
}

export interface SemanticDomain {
  id: string;
  parent_id: string | null;
  system: string;
  system_name: string;
  label: string;
  description: string | null;
  path: { id: string; label: string }[];
  children: { id: string; label: string }[];
  words: (DomainWord & { senses: { id: string; code: string; gloss: string | null }[] })[];
}

const FOREVER = { staleTime: Infinity, gcTime: 30 * 60_000 } as const; // core.db is read-only

export const useWordDomains = (strong: string) =>
  useQuery({
    queryKey: ["word-domains", strong],
    queryFn: () => getJson<WordDomainsData>(`/api/word/${strong}/domains`, { related: 24, fields: 3 }),
    ...FOREVER,
  });

export const useDomain = (id: string) =>
  useQuery({
    queryKey: ["domain", id],
    queryFn: () => getJson<SemanticDomain>(`/api/domains/${encodeURIComponent(id)}`),
    ...FOREVER,
  });
