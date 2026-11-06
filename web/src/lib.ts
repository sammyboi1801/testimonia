import type { Book } from "./types";

/** Astronomical year → display: 0 → "1 BC", -1445 → "1446 BC", 202 → "AD 202". */
export function formatYear(y: number | null | undefined): string {
  if (y === null || y === undefined) return "";
  return y <= 0 ? `${1 - y} BC` : `AD ${y}`;
}

export const ERA_LABELS: Record<string, string> = {
  apostolic: "Apostolic (to 150)",
  "ante-nicene": "Ante-Nicene (to 325)",
  nicene: "Nicene & post-Nicene (325–451)",
  "late-patristic": "Late patristic (451–750)",
  medieval: "Medieval",
  reformation: "Reformation",
  modern: "Modern",
};

export const PRE_NICENE = new Set(["apostolic", "ante-nicene"]);

export const CATEGORY_LABELS: Record<string, string> = {
  "apostolic-father": "Apostolic Fathers",
  "church-father": "Church Fathers",
  "nt-apocrypha": "New Testament Apocrypha",
  "ot-pseudepigrapha": "Old Testament Pseudepigrapha",
  liturgical: "Liturgies & Church Orders",
  council: "Councils",
  catena: "Catena Aurea",
};

/** 'John.1.18' → { book, chapter, verse } (or null). */
export function parseOsis(osis: string): { book: string; chapter: number; verse: number } | null {
  const m = /^([1-4]?[A-Za-z]+)\.(\d+)\.(\d+)$/.exec(osis);
  if (!m) return null;
  return { book: m[1]!, chapter: Number(m[2]), verse: Number(m[3]) };
}

export function osisLabel(osis: string, books?: Book[]): string {
  const p = parseOsis(osis);
  if (!p) return osis;
  const name = books?.find((b) => b.osis === p.book)?.name ?? p.book;
  return p.verse ? `${name} ${p.chapter}:${p.verse}` : `${name} ${p.chapter}`;
}

/** URL of the reader positioned on a verse (and optionally showing a word study). */
export function verseUrl(osis: string, word?: string): string {
  const p = parseOsis(osis);
  if (!p) return "/";
  const q = new URLSearchParams({ v: osis });
  if (word) q.set("w", word);
  return `/read/${p.book}/${p.chapter}?${q.toString()}#v${p.verse}`;
}

export function isStrong(s: string): boolean {
  return /^[GH]\d{4}[A-Za-z]?$/.test(s);
}

export function isRtl(lang: string): boolean {
  return lang === "hbo" || lang === "arc" || lang === "heb";
}

/** CSS class for original-language text. */
export function langClass(lang: string): string {
  if (isRtl(lang)) return "hebrew";
  if (lang === "grc") return "greek";
  return "";
}
