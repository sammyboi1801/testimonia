import { useQuery } from "@tanstack/react-query";
import { getJson } from "./api";
import { formatYear } from "./lib";

/** Manuscript catalogue (Wikipedia lists, CC BY-SA): NT papyri, majuscules, minuscules, LXX codices, Dead Sea Scrolls. */
export interface ManuscriptSummary {
  id: string;
  sigla: string | null;
  name: string | null;
  collection: string;
  language: string | null;
  date_from: number | null;
  date_to: number | null;
  date_label: string | null;
  script: string | null;
  institution: string | null;
  city: string | null;
  country: string | null;
  contents?: string | null;
  wikipedia?: string | null;
  passages?: number;
}

export interface NtvmrLinks {
  images: string;
  catalogue: string;
}

export interface ManuscriptList {
  manuscripts: ManuscriptSummary[];
  collections: { collection: string; n: number }[];
}

export interface ManuscriptDetail {
  manuscript: ManuscriptSummary & {
    format: string | null;
    material: string | null;
    contents: string | null;
    text_type: string | null;
    shelfmark: string | null;
    discovered: string | null;
    image_url: string | null;
    description: string | null;
    source_id: string;
    source_name: string | null;
    attribution: string | null;
    license: string | null;
    source_url: string | null;
  };
  ids: Record<string, string[]>;
  wikipedia: string | null;
  dating: {
    system_id: string;
    system: string | null;
    date_kind: string;
    start_year: number | null;
    end_year: number | null;
    circa: number;
    label: string | null;
    basis: string | null;
  }[];
  passages: { osis: string; label: string; testament: "OT" | "NT"; completeness: string | null }[];
  ntvmr: NtvmrLinks | null;
}

export interface VerseManuscripts {
  osis: string;
  manuscripts: (ManuscriptSummary & { completeness: string | null; ntvmr: NtvmrLinks | null })[];
  total: number;
  dss: (ManuscriptSummary & { completeness: string | null })[];
  ntvmr_verse: string | null;
}

const FOREVER = { staleTime: Infinity, gcTime: 30 * 60_000 } as const;

export const useManuscripts = () =>
  useQuery({ queryKey: ["manuscripts"], queryFn: () => getJson<ManuscriptList>("/api/manuscripts"), ...FOREVER });

export const useManuscript = (id: string | undefined) =>
  useQuery({
    queryKey: ["manuscript", id],
    queryFn: () => getJson<ManuscriptDetail>(`/api/manuscript/${encodeURIComponent(id!)}`),
    enabled: !!id,
    ...FOREVER,
  });

export const useVerseManuscripts = (osis: string | null) =>
  useQuery({
    queryKey: ["verse-manuscripts", osis],
    queryFn: () => getJson<VerseManuscripts>(`/api/verse/${osis}/manuscripts`),
    enabled: !!osis,
    ...FOREVER,
  });

export function manuscriptUrl(id: string): string {
  return `/manuscript/${encodeURIComponent(id)}`;
}

/** The browse page's groups, in reading order. */
export const KINDS: { id: string; label: string; collection: string; hint: string }[] = [
  { id: "papyri", label: "Papyri", collection: "NT papyri", hint: "New Testament papyri (𝔓)" },
  { id: "uncials", label: "Majuscules", collection: "NT majuscules", hint: "New Testament uncial codices" },
  { id: "minuscules", label: "Minuscules", collection: "NT minuscules", hint: "Notable New Testament minuscules" },
  { id: "lxx", label: "Septuagint", collection: "LXX manuscripts", hint: "Greek Old Testament manuscripts" },
  { id: "dss", label: "Dead Sea Scrolls", collection: "Dead Sea Scrolls", hint: "Qumran and the Judaean Desert" },
];

export const KIND_OF: Record<string, string> = Object.fromEntries(KINDS.map((k) => [k.collection, k.label]));

/** 'c. 110–140', '4th century', '150–100 BC': the list's own wording when short, else the window. */
export function msDate(m: Pick<ManuscriptSummary, "date_from" | "date_to" | "date_label">): string {
  const label = (m.date_label ?? "").trim();
  if (m.date_from == null) return label;
  const century = /^(\d{1,2})(st|nd|rd|th)(\s*\/\s*\d{1,2}(st|nd|rd|th))?$/i.test(label);
  if (century) return `${label} century`;
  if (m.date_to == null || m.date_to === m.date_from) return formatYear(m.date_from);
  if (m.date_from > 0) return `AD ${m.date_from}–${m.date_to}`;
  if (m.date_to <= 0) return `${1 - m.date_from}–${1 - m.date_to} BC`;
  return `${formatYear(m.date_from)} – ${formatYear(m.date_to)}`;
}

/** 'P52' → '𝔓52' with the number raised, as printed editions do. */
export function siglum(m: Pick<ManuscriptSummary, "sigla" | "id">): string {
  const s = m.sigla ?? m.id.replace(/^[A-Z]+:/, "");
  return s.replace(/^P(\d+)$/, "𝔓$1");
}
