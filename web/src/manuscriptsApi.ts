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
  transcription: TranscriptionSummary | null;
}

/** A manuscript's transcription (CNTR, CC BY-SA): its source and the chapters it has text for. */
export interface TranscriptionSummary {
  id: string;
  title: string;
  description: string | null;
  source_name: string;
  attribution: string | null;
  license: string;
  source_url: string | null;
  version: string | null;
  verses: number;
  books: { osis: string; name: string; chapters: { chapter: number; verses: number }[] }[];
}

export interface ChapterRef {
  book: string;
  chapter: number;
  label: string;
}

/** One chapter of a transcription: each verse's markup (light HTML: words, lacunae, nomina sacra, corrections). */
export interface ManuscriptText {
  edition: string;
  book: string;
  chapter: number;
  label: string;
  verses: { osis: string; verse: number; native: string | null; markup: string }[];
  prev: ChapterRef | null;
  next: ChapterRef | null;
}

/** A verse as written in the transcribed manuscripts, earliest first; differences from NA28 marked in the markup. */
export interface VerseTranscriptions {
  osis: string;
  manuscripts: (ManuscriptSummary & {
    edition_id: string;
    markup: string;
    leiden: string;
    absent: boolean;
    extant: number;
    differs: number;
  })[];
  total: number;
  printed: string | null;
  source: { name: string; attribution: string | null; license: string; url: string | null } | null;
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

export const useManuscriptText = (id: string, book: string | null, chapter: number | null, enabled = true) =>
  useQuery({
    queryKey: ["manuscript-text", id, book, chapter],
    queryFn: () =>
      getJson<ManuscriptText>(`/api/manuscript/${encodeURIComponent(id)}/text`, {
        book: book ?? undefined,
        chapter: chapter ?? undefined,
      }),
    enabled: enabled && !!id,
    placeholderData: (prev) => prev,
    ...FOREVER,
  });

export const useVerseTranscriptions = (osis: string | null, limit: number) =>
  useQuery({
    queryKey: ["verse-transcriptions", osis, limit],
    queryFn: () => getJson<VerseTranscriptions>(`/api/verse/${osis}/transcriptions`, { limit }),
    enabled: !!osis,
    // keep the shorter list on screen while "show more" loads, but never another verse's
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === osis ? prev : undefined),
    ...FOREVER,
  });

/** Link to a manuscript's page open at a chapter of its transcription. */
export function transcriptionUrl(id: string, osis: string): string {
  const [book, chapter] = osis.split(".");
  return `${manuscriptUrl(id)}?b=${book}&c=${chapter}#transcription`;
}

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
