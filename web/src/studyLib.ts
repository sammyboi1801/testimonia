// Pure helpers for the study tools: word-level comparison of translations, citations, the clipboard.

// ----------------------------------------------------------------------------- comparing translations

export interface DiffPart {
  text: string;
  changed: boolean; // a word the base translation does not have at this point
  gap?: string; // base words missing just before this part
}

/** Words compared without case, accents or punctuation: "Word," = "word". */
export function normWord(w: string): string {
  return w
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * `other` split into runs of text, each marked changed or not against `base` (longest common subsequence of
 * normalised words). Punctuation-only tokens and spaces are never marked; consecutive changed words form one run.
 */
export function diffWords(base: string, other: string): DiffPart[] {
  const a = base.split(/\s+/).filter(Boolean);
  const tokens = other.split(/(\s+)/).filter((t) => t !== "");
  const bIdx = tokens.map((t, i) => (/\S/.test(t) && normWord(t) ? i : -1)).filter((i) => i >= 0);
  const an = a.map(normWord);
  const bn = bIdx.map((i) => normWord(tokens[i]!));
  const n = an.length;
  const m = bn.length;
  // LCS table (verses are short: a few dozen words)
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) L[i]![j] = an[i] && an[i] === bn[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
  const same = new Set<number>(); // token indexes of `other` that the base shares
  const gaps = new Map<number, string[]>(); // token index → base words missing right before it
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (an[i] && an[i] === bn[j]) {
      same.add(bIdx[j]!);
      i++;
      j++;
    } else if (L[i + 1]![j]! >= L[i]![j + 1]!) {
      if (an[i]) gaps.set(bIdx[j]!, [...(gaps.get(bIdx[j]!) ?? []), a[i]!]);
      i++;
    } else j++;
  }
  const trailing = a.slice(i).filter((w) => normWord(w));
  const isWord = (k: number) => /\S/.test(tokens[k] ?? "") && !!normWord(tokens[k]!);
  const marked = tokens.map((_, k) => isWord(k) && !same.has(k));
  // a space between two changed words belongs to their run, so a changed phrase is marked as one
  const run = tokens.map((t, k) => marked[k]! || (!/\S/.test(t) && !!marked[k - 1] && !!marked[k + 1]));
  const parts: DiffPart[] = [];
  tokens.forEach((t, k) => {
    const last = parts[parts.length - 1];
    const gap = gaps.get(k)?.join(" ");
    if (last && !gap && last.changed === run[k]) last.text += t;
    else parts.push({ text: t, changed: run[k]!, ...(gap ? { gap } : {}) });
  });
  if (trailing.length) parts.push({ text: "", changed: false, gap: trailing.join(" ") });
  return parts;
}

// ----------------------------------------------------------------------------- citations

/** Quotation marks inside a quotation become single ones. */
function nest(text: string): string {
  return text.trim().replace(/“/g, "‘").replace(/”/g, "’").replace(/"/g, "'");
}

/** “In the beginning was the Word…” (John 1:1, KJV) */
export function citeInline(text: string, ref: string, edition?: string | null): string {
  return `“${nest(text)}” (${ref}${edition ? `, ${edition}` : ""})`;
}

const SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const sup = (n: number) => String(n).replace(/\d/g, (d) => SUP[Number(d)]!);

/** The text as a block (verse numbers when there are several verses), then a reference line. */
export function citeBlock(verses: { verse: number; text: string }[], ref: string, edition?: string | null): string {
  const body = verses.length === 1 ? verses[0]!.text.trim() : verses.map((v) => `${sup(v.verse)} ${v.text.trim()}`).join(" ");
  return `${body}\n— ${ref}${edition ? ` (${edition})` : ""}`;
}

/** Copy text: the Clipboard API where allowed, else a hidden textarea and execCommand. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall back below */
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "0";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

// ----------------------------------------------------------------------------- references

/** 'John.1.1' + 'John.1.18' → 'John 1:1–18' (book name from `name`). */
export function rangeLabel(name: string, start: string, end: string): string {
  const [, c1, v1] = start.split(".");
  const [, c2, v2] = end.split(".");
  if (start === end) return `${name} ${c1}:${v1}`;
  return c1 === c2 ? `${name} ${c1}:${v1}–${v2}` : `${name} ${c1}:${v1}–${c2}:${v2}`;
}

/** URL of the passage guide for a range or (expanded by the server to its section) a single verse. */
export function passageUrl(start: string, end?: string): string {
  return `/passage/${end && end !== start ? `${start}-${end}` : start}`;
}

// ----------------------------------------------------------------------------- grammar search

/** The features a grammar search can filter on (mirrors testimonia/morphology.py FEATURES). */
export const GRAMMAR_FEATURES: Record<"grc" | "hbo", { key: string; label: string; values: string[] }[]> = {
  grc: [
    { key: "part", label: "Part of speech", values: ["verb", "noun", "adjective", "article", "pronoun", "preposition", "conjunction", "adverb", "particle"] },
    { key: "tense", label: "Tense", values: ["present", "imperfect", "future", "aorist", "perfect", "pluperfect"] },
    { key: "voice", label: "Voice", values: ["active", "middle", "passive", "middle-passive"] },
    { key: "mood", label: "Mood", values: ["indicative", "subjunctive", "optative", "imperative", "infinitive", "participle"] },
    { key: "case", label: "Case", values: ["nominative", "genitive", "dative", "accusative", "vocative"] },
    { key: "person", label: "Person", values: ["1st", "2nd", "3rd"] },
    { key: "number", label: "Number", values: ["singular", "plural"] },
    { key: "gender", label: "Gender", values: ["masculine", "feminine", "neuter"] },
  ],
  hbo: [
    { key: "part", label: "Part of speech", values: ["verb", "noun", "adjective", "pronoun", "preposition", "conjunction", "adverb", "particle"] },
    { key: "stem", label: "Stem", values: ["qal", "niphal", "piel", "pual", "hiphil", "hophal", "hithpael", "polel", "poel", "qal passive"] },
    {
      key: "form",
      label: "Form",
      values: [
        "perfect",
        "sequential perfect",
        "imperfect",
        "sequential imperfect",
        "conjunctive imperfect",
        "cohortative",
        "jussive",
        "imperative",
        "participle",
        "passive participle",
        "infinitive absolute",
        "infinitive construct",
      ],
    },
    { key: "person", label: "Person", values: ["1st", "2nd", "3rd"] },
    { key: "gender", label: "Gender", values: ["masculine", "feminine", "common"] },
    { key: "number", label: "Number", values: ["singular", "plural", "dual"] },
    { key: "state", label: "State", values: ["absolute", "construct", "determined"] },
  ],
};

export const featureLabel = (v: string) => v.replace("middle-passive", "middle or passive");
