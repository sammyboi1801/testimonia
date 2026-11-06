// Types mirroring the JSON returned by testimonia/server/api.py.

export interface Edition {
  id: string;
  title: string;
  abbrev: string | null;
  language: string;
  script_dir: "ltr" | "rtl";
  kind: string;
  testament: string | null;
  versification_id: string | null;
  year: number | null;
  description: string | null;
  sort: number;
}

export interface Book {
  osis: string;
  name: string;
  testament: "OT" | "NT" | "DC" | "EX";
  hebrew_name: string | null;
  greek_name: string | null;
  latin_name: string | null;
  genre: string | null;
  ord: number;
  chapters: number;
}

export interface Meta {
  editions: Edition[];
  books: Book[];
  traditions: { id: string; name: string }[];
  canon: { tradition_id: string; book: string; ord: number; division: string | null; status: string }[];
  build: Record<string, string>;
  counts: { works: number; citations: number; commentary: number };
}

export interface Word {
  pos: number;
  surface: string;
  translit: string | null;
  gloss: string | null;
  strong: string | null;
  lemma_id: string | null;
  morph: string | null;
  editions: string | null;
  word_type: string | null;
  parts?: string | null;
  lemma?: string | null;
  lemma_gloss?: string | null;
  morph_text?: string | null;
}

export interface VerseMarks {
  variants?: number;
  major_variants?: number;
  fathers?: number;
  witnesses?: number;
  pre_nicene?: number;
  quotations?: number;
}

export interface ChapterVerse {
  vkey: number;
  osis: string;
  verse: number;
  red_letter: number;
  texts: Record<string, { text: string; native: string | null }>;
  words: Record<string, Word[]>;
  marks?: VerseMarks;
}

export interface ChapterRef {
  book: string;
  chapter: number;
  name: string;
}

export interface Chapter {
  book: string;
  chapter: number;
  name: string;
  editions: string[];
  verses: ChapterVerse[];
  headings: { vkey: number; title: string }[];
  prev: ChapterRef | null;
  next: ChapterRef | null;
}

export interface Reading {
  n: number;
  text: string;
  gloss: string | null;
  witnesses: string | null;
}

export interface VariantUnit {
  id: number;
  label: string;
  significance: string;
  note: string | null;
  source_id: string;
  readings: Reading[];
}

export interface CrossRef {
  dst_start: number;
  dst_end: number;
  votes: number | null;
  source_id: string;
  osis: string;
  end_osis: string | null;
  text: string | null;
}

export interface Quotation {
  direction: "quotes" | "quoted_by";
  other: number;
  via: string | null;
  osis: string;
  text: string | null;
}

export interface FatherCitation {
  work_id: string;
  work_title: string;
  category: string;
  author_id: string | null;
  author: string | null;
  year: number | null;
  era: string | null;
  kind: string | null;
  cite: string | null;
  snippet: string | null;
  edition_id: string | null;
  section_ord: number | null;
  source_id: string;
  times: number;
}

export interface CommentaryEntry {
  id: number;
  start_vkey: number;
  end_vkey: number;
  work_title: string | null;
  html: string;
  source_url: string | null;
  author: string;
  year: number | null;
  era: string | null;
  author_id: string | null;
}

export interface VerseGuide {
  verse: { vkey: number; osis: string; book: string; chapter: number; verse: number; red_letter: number };
  texts: { edition_id: string; text: string; native_ref: string | null; abbrev: string | null; language: string; script_dir: string }[];
  words: Record<string, Word[]>;
  variants: VariantUnit[];
  crossrefs: CrossRef[];
  quotations: Quotation[];
  fathers: FatherCitation[];
  witnesses?: FatherCitation[]; // Josephus, Tacitus… (Jewish & Roman writers)
  commentary: CommentaryEntry[];
  notes: { n: number; kind: string | null; body: string }[];
  topics: { id: string; name: string }[];
  chronology: { label: string | null; start_year: number | null; end_year: number | null; chron_order: number | null } | null;
  periods: { id: string; name: string; parent_id: string | null }[];
  heading: { title: string; start_vkey: number; end_vkey: number } | null;
}

export interface WordStudy {
  lemma: { id: string; language: string; lemma: string; translit: string | null; gloss: string | null; definition: string | null } | null;
  lexicons: { lexicon_id: string; title: string; lemma_id: string; body: string }[];
  by_book: { book: string; name: string; n: number }[];
  occurrences: { vkey: number; osis: string; surface: string; gloss: string | null; morph: string | null; edition_id: string }[];
  total: number;
  glosses: { gloss: string; n: number }[];
}

export interface WorkSummary {
  id: string;
  title: string;
  category: string;
  era: string | null;
  author_id: string | null;
  author: string | null;
  year: number | null;
  date_from: number | null;
  date_to: number | null;
  citations: number;
  edition_id: string | null;
}

export interface Toc {
  edition: {
    id: string;
    work_id: string;
    title: string;
    author: string | null;
    author_id: string | null;
    category: string;
    era: string | null;
    translator: string | null;
    year: number | null;
    summary: string | null;
    attribution: string | null;
    date_from: number | null;
    date_to: number | null;
    author_born: number | null;
    author_died: number | null;
    author_from: number | null;
    author_to: number | null;
    author_summary: string | null;
    wikipedia: string | null;
    author_wikipedia: string | null;
  };
  sections: { ord: number; cite: string | null; title: string | null; level: number }[];
  intro_ord: number | null;
}

export interface TimelineWork {
  id: string;
  title: string;
  category: string;
  author_id: string | null;
  date_from: number | null;
  date_to: number | null;
  summary: string | null;
  citations: number;
  edition_id: string | null;
  wikipedia: string | null;
}

export interface TimelineAuthor {
  id: string;
  name: string;
  born: number | null;
  died: number | null;
  floruit_from: number | null;
  floruit_to: number | null;
  era: string | null;
  tradition: string | null;
  summary: string | null;
  wikipedia: string | null;
  circa: string[]; // 'birth' | 'death' | 'floruit'
  category: string;
  works: TimelineWork[];
}

export interface TimelineEvent {
  id: string;
  title: string;
  kind: string;
  description: string | null;
  start: number;
  end: number;
  date_kind: "point" | "span" | "window";
  circa: number;
  wikipedia: string | null;
  major: boolean; // milestones are drawn across the whole timeline
}

export interface Timeline {
  eras: { id: string; name: string; description: string | null; start: number; end: number }[];
  events: TimelineEvent[];
  authors: TimelineAuthor[];
  works: TimelineWork[];
}

export interface WikiSummary {
  title: string;
  description?: string;
  extract: string;
  thumbnail?: { source: string; width: number; height: number };
  content_urls?: { desktop: { page: string } };
}

export interface SectionView {
  section: { edition_id: string; ord: number; cite: string | null; title: string | null; html: string };
  citations: { start_vkey: number; end_vkey: number; kind: string | null; osis: string }[];
  prev: number | null;
  next: number | null;
}

export interface RefResult {
  book: string;
  chapter: number;
  verse: number | null;
  label: string;
  osis: string;
}

export interface SearchResults {
  query: string;
  reference?: RefResult;
  bible?: { vkey: number; edition_id: string; abbrev: string | null; snippet: string; osis: string }[];
  works?: { edition_id: string; ord: number; cite: string | null; section_title: string | null; work_title: string; author: string | null; snippet: string }[];
  lexicon?: { id: string; lemma: string; translit: string | null; gloss: string | null }[];
}
