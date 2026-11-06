import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSettings } from "../settings";
import { readingVoices, speakPassage, speechSupported, stopSpeaking, voicesReady } from "../speech";
import type { ChapterRef } from "../types";

const SPEEDS = [0.75, 0.9, 1, 1.15, 1.3, 1.5];

/**
 * The audio Bible: reads the chapter aloud verse by verse with the system's speech voices, reporting the verse
 * being read (the reader highlights it and keeps it in view) and carrying on into the next chapter.
 */
export function ReadAloud({
  verses,
  lang,
  title,
  next,
  onVerse,
}: {
  verses: { osis: string; text: string }[];
  lang: string; // BCP-47 prefix: 'en', 'la'…
  title: string;
  next: ChapterRef | null;
  onVerse: (osis: string | null) => void;
}) {
  const { settings, update } = useSettings();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [index, setIndex] = useState(0);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const run = useRef(0); // each play loop has an id; starting or stopping invalidates the old one
  const speech = settings.speech;

  useEffect(() => {
    let live = true;
    void voicesReady().then(() => live && setVoices(readingVoices(lang)));
    return () => {
      live = false;
    };
  }, [lang]);

  const play = useCallback(
    async (from: number) => {
      const id = ++run.current;
      stopSpeaking();
      setOpen(true);
      setPlaying(true);
      for (let i = from; i < verses.length; i++) {
        if (run.current !== id) return;
        setIndex(i);
        onVerse(verses[i]!.osis);
        const done = await speakPassage(verses[i]!.text, lang, speech.read, speech.readRate);
        if (run.current !== id) return;
        if (!done) {
          setPlaying(false); // the voice failed: stay on this verse rather than racing ahead
          return;
        }
      }
      if (run.current !== id) return;
      setPlaying(false);
      onVerse(null);
      if (next) navigate(`/read/${next.book}/${next.chapter}?listen=1`);
    },
    [verses, lang, speech.read, speech.readRate, onVerse, next, navigate],
  );

  const pause = useCallback(() => {
    run.current++;
    stopSpeaking();
    setPlaying(false);
  }, []);

  const close = useCallback(() => {
    pause();
    setOpen(false);
    onVerse(null);
  }, [pause, onVerse]);

  // arriving with ?listen=1 (the previous chapter finished) carries straight on
  useEffect(() => {
    if (params.get("listen") === "1" && verses.length) {
      setParams(
        (p) => {
          const n = new URLSearchParams(p);
          n.delete("listen");
          return n;
        },
        { replace: true },
      );
      void play(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verses]);

  // stop when leaving the chapter or the page
  useEffect(() => () => {
    run.current++;
    stopSpeaking();
  }, [verses]);

  // a new voice or speed applies from the current verse
  const restartWith = (patch: Partial<typeof speech>) => {
    update({ speech: { ...speech, ...patch } });
    if (playing) window.setTimeout(() => void play(index), 0);
  };

  if (!speechSupported() || !verses.length) return null;

  return (
    <>
      <button className="listen-btn" onClick={() => (playing ? pause() : void play(open ? index : 0))} title="Read this chapter aloud">
        {playing ? "❚❚ Pause" : "▶ Listen"}
      </button>
      {open && (
        <div className="audio-bar" role="region" aria-label="Audio Bible">
          <button className="icon-btn" onClick={() => void play(Math.max(0, index - 1))} title="Previous verse" aria-label="Previous verse">
            ⏮
          </button>
          <button className="icon-btn audio-play" onClick={() => (playing ? pause() : void play(index))} aria-label={playing ? "Pause" : "Play"}>
            {playing ? "❚❚" : "▶"}
          </button>
          <button className="icon-btn" onClick={() => void play(Math.min(verses.length - 1, index + 1))} title="Next verse" aria-label="Next verse">
            ⏭
          </button>
          <span className="audio-where">
            <strong>{title}</strong>
            <span className="muted small">
              {" "}
              verse {verses[index]?.osis.split(".").pop()} of {verses.length}
            </span>
          </span>
          <span className="audio-progress" aria-hidden>
            <i style={{ width: `${((index + (playing ? 0.5 : 0)) / verses.length) * 100}%` }} />
          </span>
          <select value={speech.readRate} onChange={(e) => restartWith({ readRate: Number(e.target.value) })} aria-label="Speed">
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
          {voices.length > 0 && (
            <select value={speech.read ?? ""} onChange={(e) => restartWith({ read: e.target.value || null })} aria-label="Voice" className="audio-voice">
              <option value="">Best voice</option>
              {voices.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name.replace(/^Microsoft /, "").replace(/ - .*$/, "")}
                </option>
              ))}
            </select>
          )}
          <button className="icon-btn" onClick={close} title="Close the player" aria-label="Close the player">
            ✕
          </button>
        </div>
      )}
    </>
  );
}
