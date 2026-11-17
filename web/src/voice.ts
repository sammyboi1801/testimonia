// Talking to the assistant and hearing it answer, with the browser's own speech: recognition turns speech into the
// question's text (in Chrome and Edge the browser sends the audio to Google to do it; Safari does it on the device;
// Firefox has none, so the mic is not offered there), and the reader's chosen voice reads answers aloud.

import { speakPassage, speechSupported, stopSpeaking } from "./speech";

interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

function recognitionClass(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const canListen = (): boolean => recognitionClass() !== null;
export const canSpeak = (): boolean => speechSupported();

/**
 * Listen for one spoken question. `onText` gets what has been heard so far (the settled words, then the words still
 * being made out); `onEnd` gets the final text, or an error ('not-allowed' when the mic is refused). Returns stop.
 */
export function listen(onText: (heard: string) => void, onEnd: (final: string, error?: string) => void): () => void {
  const Rec = recognitionClass();
  if (!Rec) {
    onEnd("", "unsupported");
    return () => {};
  }
  const rec = new Rec();
  rec.lang = navigator.language || "en-US";
  rec.interimResults = true;
  rec.continuous = false; // it stops by itself when the speaker pauses
  rec.maxAlternatives = 1;
  let settled = "";
  let pending = "";
  let error: string | undefined;
  rec.onresult = (e) => {
    pending = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]!;
      if (r.isFinal) settled += r[0]!.transcript;
      else pending += r[0]!.transcript;
    }
    onText((settled + pending).replace(/\s+/g, " ").trimStart());
  };
  rec.onerror = (e) => {
    error = e.error;
  };
  rec.onend = () => onEnd((settled || pending).replace(/\s+/g, " ").trim(), error === "no-speech" || error === "aborted" ? undefined : error);
  try {
    rec.start();
  } catch {
    onEnd("", "busy");
  }
  return () => rec.stop();
}

/**
 * Read some paragraphs aloud one after another, telling which is being read; at the end `onParagraph(null, true)`
 * when all were read, `(null, false)` when stopped or interrupted. Returns stop. The voice and speed are the
 * reader's own (Settings, Pronunciation).
 */
export function readAloud(paragraphs: string[], voice: string | null, rate: number, onParagraph: (i: number | null, finished?: boolean) => void): () => void {
  let stopped = false;
  const lang = (document.documentElement.lang || "en").slice(0, 2);
  void (async () => {
    stopSpeaking();
    for (let i = 0; i < paragraphs.length; i++) {
      if (stopped) return;
      onParagraph(i);
      const ok = await speakPassage(paragraphs[i]!, lang, voice, rate);
      if (stopped) return;
      if (!ok) {
        onParagraph(null, false);
        return;
      }
    }
    onParagraph(null, true);
  })();
  return () => {
    if (stopped) return;
    stopped = true;
    stopSpeaking();
    onParagraph(null, false);
  };
}

/** What a paragraph of an answer says aloud: its words, without link arrows, icons or reference numbers. */
export function speakable(el: Element): string {
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll(".cl-out, .cl-icon, sup, .ans-ed, button, svg").forEach((n) => n.remove());
  return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
}
