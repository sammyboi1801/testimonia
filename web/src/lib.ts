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
  jewish: "Jewish writers",
  pagan: "Greek & Roman writers",
};

/** Categories of non-Christian witnesses (Josephus, Tacitus, Pliny…). */
export const OUTSIDE = new Set(["jewish", "pagan"]);

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

/**
 * An edition's own numbering of a verse (its `native_ref`, e.g. 'Ps.22.1' or '1Kgs.2.35,1Kgs.2.35a,…') as a
 * short label beside the standard verse `osis`: '22:1', '2:35–35n', or 'Dan 3:24' when the book differs.
 */
export function nativeLabel(native: string, osis: string): string {
  const hubBook = osis.split(".")[0];
  const parts = native
    .split(",")
    .map((n) => /^([1-4]?[A-Za-z]+)\.([0-9A-Za-z]+)\.([0-9]+[a-z]*(?:-\d+)?)$/.exec(n.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ book: m[1]!, ch: m[2]!, v: m[3]! }));
  if (!parts.length) return native;
  const first = parts[0]!;
  const last = parts[parts.length - 1]!;
  const head = `${first.book !== hubBook ? `${first.book} ` : ""}${first.ch}:${first.v}`;
  if (parts.length === 1 || (last.ch === first.ch && last.v === first.v)) return head;
  return `${head}–${last.ch === first.ch && last.book === first.book ? last.v : `${last.ch}:${last.v}`}`;
}

/** CSS class for original-language text. */
export function langClass(lang: string): string {
  if (isRtl(lang)) return "hebrew";
  if (lang === "grc") return "greek";
  return "";
}

const LAST_READ = "testimonia.lastRead";

/** Remember the chapter being read, so opening the app returns to it. */
export function rememberReading(book: string, chapter: number): void {
  try {
    localStorage.setItem(LAST_READ, JSON.stringify({ book, chapter }));
  } catch {
    /* private mode: nothing to remember */
  }
}

/** Where to open the reader: the last chapter read, or John 1. */
export function lastReadingPath(): string {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_READ) ?? "null") as { book?: string; chapter?: number } | null;
    if (v?.book && v.chapter) return `/read/${v.book}/${v.chapter}`;
  } catch {
    /* fall through */
  }
  return "/read/John/1";
}
