import { useCallback } from "react";
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { useChapter, useMeta } from "../api";
import { BookNav } from "../components/BookNav";
import { PassageGuide } from "../components/PassageGuide";
import { Reader } from "../components/Reader";
import { WordStudy } from "../components/WordStudy";
import { useSettings } from "../settings";

export function ReadPage() {
  const { book = "John", chapter = "1" } = useParams();
  const [params, setParams] = useSearchParams();
  const { settings } = useSettings();
  const meta = useMeta();
  const ch = Number(chapter);
  const editions = settings.original ? [...settings.editions, "tagnt", "tahot"] : settings.editions;
  const data = useChapter(book, ch, editions);
  const selected = params.get("v");
  const word = params.get("w");

  const select = useCallback(
    (osis: string) => setParams((p) => {
      const next = new URLSearchParams(p);
      next.set("v", osis);
      next.delete("w");
      return next;
    }, { replace: true }),
    [setParams],
  );
  const openWord = useCallback(
    (strong: string) => setParams((p) => {
      const next = new URLSearchParams(p);
      next.set("w", strong);
      return next;
    }),
    [setParams],
  );
  const closeWord = useCallback(
    () => setParams((p) => {
      const next = new URLSearchParams(p);
      next.delete("w");
      return next;
    }),
    [setParams],
  );

  if (!Number.isInteger(ch) || ch < 1) return <Navigate to="/read/John/1" replace />;
  const books = meta.data?.books ?? [];

  return (
    <div className="workspace">
      <aside className="sidebar">{meta.data && <BookNav books={books} current={book} chapter={ch} />}</aside>
      <main>
        {data.isLoading && <div className="loading">Loading…</div>}
        {data.error && <div className="error">Could not load {book} {chapter}: {String(data.error)}</div>}
        {data.data && meta.data && (
          <Reader data={data.data} editions={meta.data.editions} selected={selected} onSelect={select} onWord={openWord} />
        )}
      </main>
      <aside className="guide" aria-label="Passage guide">
        {word ? (
          <WordStudy strong={word} books={books} onBack={closeWord} onWord={openWord} />
        ) : selected ? (
          <PassageGuide osis={selected} books={books} onWord={openWord} />
        ) : (
          <div className="guide-empty">
            <h2>Passage guide</h2>
            <p>Click any verse to see its words, textual variants, church fathers who cite it, cross references, Old ↔ New Testament links, commentary and chronology.</p>
            <p>Click a Greek or Hebrew word for a full word study.</p>
            {meta.data && (
              <p className="muted" style={{ fontSize: 13 }}>
                {meta.data.editions.length} editions · {meta.data.counts.works.toLocaleString()} ancient works ·{" "}
                {meta.data.counts.citations.toLocaleString()} patristic citations ·{" "}
                {meta.data.counts.commentary.toLocaleString()} commentary excerpts
              </p>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
