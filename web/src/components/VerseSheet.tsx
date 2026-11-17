// The reader's verse panel (words, commentary, the text's history, links, your note), opened over any page that
// shows a passage: tap a verse, or a word in the Greek or Hebrew. A side panel on wide screens, a sheet on phones.

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMeta } from "../api";
import { useBackClose } from "../backClose";
import { useSettings } from "../settings";
import { StudyPanel, type Tab } from "./StudyPanel";

export function useVerseSheet(): { selected: string | null; onSelect: (osis: string) => void; onWord: (strong: string, osis?: string) => void; sheet: ReactNode } {
  const { settings } = useSettings();
  const [osis, setOsis] = useState<string | null>(null);
  const [word, setWord] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(settings.panel.tab);
  const books = useMeta().data?.books ?? [];
  const close = useCallback(() => {
    setOsis(null);
    setWord(null);
  }, []);
  useBackClose(!!osis, close);
  useEffect(() => {
    if (!osis) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [osis, close]);
  const onSelect = useCallback((o: string) => {
    setOsis((cur) => (cur === o ? null : o)); // tap again: close
    setWord(null);
  }, []);
  const onWord = useCallback((strong: string, o?: string) => {
    if (o) setOsis(o);
    setWord(strong);
  }, []);
  const sheet = osis
    ? createPortal(
        <>
          <div className="vs-scrim" onClick={close} aria-hidden />
          <aside className="guide vs-sheet" aria-label="Verse study">
            <StudyPanel
              osis={osis}
              books={books}
              tab={tab}
              word={word}
              onTab={(t) => {
                setTab(t);
                setWord(null);
              }}
              onWord={(s) => setWord(s)}
              onCloseWord={() => setWord(null)}
              onClose={close}
            />
          </aside>
        </>,
        document.body,
      )
    : null;
  return { selected: osis, onSelect, onWord, sheet };
}
