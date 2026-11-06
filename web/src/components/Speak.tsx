import { useState, type MouseEvent } from "react";
import { speak, speechSupported, type SpeechLang } from "../speech";

/** A small speaker button that pronounces Greek or Hebrew text with the system's speech voices. */
export function Speak({ text, lang, label }: { text: string; lang: SpeechLang; label?: string }) {
  const [missing, setMissing] = useState(false);
  if (!speechSupported()) return null;
  const language = lang === "grc" ? "Greek" : "Hebrew";
  async function onClick(e: MouseEvent) {
    e.stopPropagation();
    const ok = await speak(text, lang);
    setMissing(!ok);
  }
  return (
    <button
      type="button"
      className={`speak${missing ? " missing" : ""}`}
      onClick={onClick}
      title={
        missing
          ? `No ${language} voice is installed — add one in Windows Settings › Time & language › Speech`
          : `Listen (modern ${language} voice)`
      }
      aria-label={label ?? `Pronounce ${text}`}
    >
      <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden>
        <path d="M3 8h3l4-3.5v11L6 12H3z" fill="currentColor" />
        <path d="M13 7.2a4 4 0 0 1 0 5.6M15.2 5a7 7 0 0 1 0 10" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      </svg>
      {label && <span>{label}</span>}
    </button>
  );
}
