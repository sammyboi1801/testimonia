/** A reading guide for a Greek word, syllable by syllable with the stressed one in capitals: οὗτος → "HOO-tos",
 *  ἄγγελος → "AN-ge-los". English-friendly (Erasmian-style) sounds; the accent marks the stress. */

const VOWELS = "αεηιουω";
const DIPHTHONGS: Record<string, string> = { αι: "ai", ει: "ay", οι: "oy", υι: "wee", αυ: "ow", ευ: "yoo", ηυ: "ayoo", ου: "oo" };
const SOUNDS: Record<string, string> = {
  α: "a", β: "b", γ: "g", δ: "d", ε: "e", ζ: "z", η: "ay", θ: "th", ι: "i", κ: "k", λ: "l", μ: "m", ν: "n", ξ: "x",
  ο: "o", π: "p", ρ: "r", σ: "s", ς: "s", τ: "t", υ: "u", φ: "f", χ: "kh", ψ: "ps", ω: "o",
};
const ACCENTS = new Set(["́", "̀", "͂"]);
const ROUGH = "̔";
const DIAERESIS = "̈";

interface Unit {
  t: string; // a letter or a diphthong
  vowel: boolean;
  stressed: boolean;
  rough: boolean;
}

/** May these two consonants begin a syllable together (so a vowel before them is left open)? */
const onset = (a: string, b: string) => ("πβφτδθκγχ".includes(a) && "λρνμ".includes(b)) || (a === "σ" && "πτκ".includes(b)) || ["πτ", "κτ", "φθ", "χθ"].includes(a + b);

export function pronounce(word: string): string {
  const letters: { c: string; stressed: boolean; rough: boolean; diaeresis: boolean }[] = [];
  for (const ch of word.normalize("NFD").toLowerCase()) {
    if (/\p{M}/u.test(ch)) {
      const last = letters[letters.length - 1];
      if (!last) continue;
      if (ACCENTS.has(ch)) last.stressed = true;
      else if (ch === ROUGH) last.rough = true;
      else if (ch === DIAERESIS) last.diaeresis = true;
      continue;
    }
    if (/[α-ως]/.test(ch)) letters.push({ c: ch, stressed: false, rough: false, diaeresis: false });
  }
  if (!letters.length) return "";
  const units: Unit[] = [];
  for (let i = 0; i < letters.length; i++) {
    const a = letters[i]!;
    const b = letters[i + 1];
    if (b && DIPHTHONGS[a.c + b.c] && !b.diaeresis) {
      units.push({ t: a.c + b.c, vowel: true, stressed: a.stressed || b.stressed, rough: a.rough || b.rough });
      i++;
    } else units.push({ t: a.c, vowel: VOWELS.includes(a.c), stressed: a.stressed, rough: a.rough });
  }
  // syllables: break before a single consonant between vowels; split a pair unless it can open a syllable
  const vowels = units.map((u, i) => (u.vowel ? i : -1)).filter((i) => i >= 0);
  if (!vowels.length) return units.map((u) => SOUNDS[u.t] ?? "").join("");
  const breaks: number[] = [];
  for (let k = 1; k < vowels.length; k++) {
    const from = vowels[k - 1]! + 1;
    const to = vowels[k]!;
    const cons = units.slice(from, to).map((u) => u.t);
    if (cons.length <= 1) breaks.push(from);
    else breaks.push(onset(cons[0]!, cons[1]!) ? from : from + 1);
  }
  const syllables: Unit[][] = [];
  let start = 0;
  for (const b of [...breaks, units.length]) {
    syllables.push(units.slice(start, b));
    start = b;
  }
  const out = syllables.map((syl, si) => {
    let s = "";
    syl.forEach((u, ui) => {
      const next = syl[ui + 1]?.t ?? syllables[si + 1]?.[0]?.t ?? "";
      if (u.rough && si === 0 && u.vowel) s += "h";
      if (u.t === "γ" && "γκξχ".includes(next[0] ?? "")) s += "n"; // γγ, γκ: "ng"
      else s += DIPHTHONGS[u.t] ?? SOUNDS[u.t] ?? "";
    });
    return syl.some((u) => u.stressed) ? s.toUpperCase() : s;
  });
  return out.join("-");
}
