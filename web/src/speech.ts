// Pronunciation through the browser's built-in speech synthesis (Web Speech API).
// Voices come from the operating system / browser (e.g. Microsoft Stefanos el-GR, Asaf he-IL, or Edge's
// online natural voices), so this costs nothing and works offline with local voices. These are MODERN
// Greek and MODERN Hebrew voices: good for hearing a word, not a reconstruction of ancient pronunciation.

export type SpeechLang = "grc" | "hbo";

const LANG_TAGS: Record<SpeechLang, string[]> = { grc: ["el-GR", "el"], hbo: ["he-IL", "he", "iw-IL"] };

/** Polytonic Greek → what a modern Greek voice reads well: breathings/subscripts dropped, accents → acute. */
export function speakableGreek(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̓̔̆̄ͅ]/g, "") // breathings, iota subscript, breve, macron
    .replace(/[̀͂]/g, "́") // grave / circumflex → acute
    .replace(/[^\p{L}\p{M}\s.,;·'’-]/gu, "")
    .normalize("NFC");
}

/** Pointed Hebrew → vowels kept, cantillation and textual markers removed. */
export function speakableHebrew(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[֑-ֽ֯׀׃׆׳״]/g, "") // te'amim, meteg, paseq, sof pasuq…
    .replace(/[/\\]/g, "")
    .replace(/־/g, " ") // maqaf → space so words are read separately
    .normalize("NFC")
    .trim();
}

function voices(): SpeechSynthesisVoice[] {
  return typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis.getVoices() : [];
}

/** Every installed voice for a language (for the settings pane). */
export function listVoices(lang: SpeechLang): SpeechSynthesisVoice[] {
  return voices().filter((v) => LANG_TAGS[lang].some((t) => v.lang.toLowerCase().startsWith(t.slice(0, 2).toLowerCase())));
}

export function voiceFor(lang: SpeechLang, preferred?: string | null): SpeechSynthesisVoice | null {
  const all = voices();
  const chosen = preferred ? all.find((v) => v.name === preferred) : undefined;
  if (chosen) return chosen;
  for (const tag of LANG_TAGS[lang]) {
    const exact = all.filter((v) => v.lang.toLowerCase() === tag.toLowerCase());
    const pick = exact.find((v) => /natural|neural|online/i.test(v.name)) ?? exact[0];
    if (pick) return pick;
  }
  return all.find((v) => LANG_TAGS[lang].some((t) => v.lang.toLowerCase().startsWith(t.slice(0, 2)))) ?? null;
}

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Voices load asynchronously in some browsers; resolve once they are available (or after a timeout). */
export function voicesReady(timeoutMs = 1500): Promise<void> {
  if (!speechSupported() || voices().length) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => resolve();
    window.speechSynthesis.addEventListener("voiceschanged", done, { once: true });
    setTimeout(done, timeoutMs);
  });
}

export async function speak(text: string, lang: SpeechLang, rate = 0.8, voiceName?: string | null): Promise<boolean> {
  if (!speechSupported()) return false;
  await voicesReady();
  const voice = voiceFor(lang, voiceName);
  const utterance = new SpeechSynthesisUtterance(lang === "grc" ? speakableGreek(text) : speakableHebrew(text));
  utterance.lang = voice?.lang ?? LANG_TAGS[lang][0]!;
  if (voice) utterance.voice = voice;
  utterance.rate = rate;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
  return voice !== null;
}

// ----------------------------------------------------------------------------- reading aloud (audio Bible)

/** BCP-47 prefix for an edition language ('eng' → 'en', 'lat' → 'la', 'grc' → 'el', 'hbo' → 'he'). */
export function speechLang(edition: string): string {
  return { eng: "en", lat: "la", grc: "el", hbo: "he", heb: "he" }[edition] ?? edition.slice(0, 2);
}

/** Installed voices for a language, natural/neural (online) voices first. */
export function readingVoices(prefix: string): SpeechSynthesisVoice[] {
  const natural = (v: SpeechSynthesisVoice) => (/natural|neural|online/i.test(v.name) ? 0 : 1);
  return voices()
    .filter((v) => v.lang.toLowerCase().startsWith(prefix))
    .sort((a, b) => natural(a) - natural(b) || a.name.localeCompare(b.name));
}

/** Speak one passage; resolves when it has been spoken (true) or was interrupted (false). */
export async function speakPassage(text: string, prefix: string, voiceName: string | null, rate: number): Promise<boolean> {
  if (!speechSupported()) return false;
  await voicesReady();
  const list = readingVoices(prefix);
  const voice = (voiceName && list.find((v) => v.name === voiceName)) || list[0];
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = voice?.lang ?? prefix;
  if (voice) utterance.voice = voice;
  utterance.rate = rate;
  return new Promise((resolve) => {
    utterance.onend = () => resolve(true);
    utterance.onerror = () => resolve(false);
    window.speechSynthesis.speak(utterance);
  });
}

export function stopSpeaking(): void {
  if (speechSupported()) window.speechSynthesis.cancel();
}
