import { useCallback } from "react";
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { useChapter, useMeta } from "../api";
import { Reader } from "../components/Reader";
import { Mark } from "../components/Marks";
import { StudyPanel, type Tab } from "../components/StudyPanel";
import { useSettings } from "../settings";

const TABS: Tab[] = ["text", "fathers", "links", "words"];

export function ReadPage() {
  const { book = "John", chapter = "1" } = useParams();
  const [params, setParams] = useSearchParams();
  const { settings } = useSettings();
  const meta = useMeta();
  const ch = Number(chapter);
  const needsWords = settings.mode === "interlinear" || settings.mode === "original";
  const editions = needsWords ? [...settings.editions, "tagnt", "tahot"] : settings.editions;
  const data = useChapter(book, ch, editions);
  const selected = params.get("v");
  const word = params.get("w");
  const tabParam = params.get("t") as Tab | null;
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : settings.panel.tab;

  const setParam = useCallback(
    (patch: Record<string, string | null>, replace = false) =>
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          for (const [k, v] of Object.entries(patch)) {
            if (v === null) next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace },
      ),
    [setParams],
  );
  const select = useCallback((osis: string) => setParam({ v: osis, w: null }, true), [setParam]);
  const openWord = useCallback((strong: string) => setParam({ w: strong, t: "words" }), [setParam]);
  const closeWord = useCallback(() => setParam({ w: null }), [setParam]);
  const setTab = useCallback((t: Tab) => setParam({ t, w: null }, true), [setParam]);

  if (!Number.isInteger(ch) || ch < 1) return <Navigate to="/read/John/1" replace />;
  const books = meta.data?.books ?? [];

  return (
    <div className="workspace">
      <main>
        {data.isLoading && <div className="loading">Loading…</div>}
        {data.error && <div className="error">Could not load {book} {chapter}: {String(data.error)}</div>}
        {data.data && meta.data && (
          <Reader data={data.data} books={books} editions={meta.data.editions} selected={selected} onSelect={select} onWord={openWord} />
        )}
      </main>
      <aside className="guide" aria-label="Study panel">
        {selected ? (
          <StudyPanel osis={selected} books={books} tab={tab} word={word} onTab={setTab} onWord={openWord} onCloseWord={closeWord} />
        ) : (
          <div className="guide-empty">
            <h2>Study panel</h2>
            <p>Choose a verse to see what stands behind it — how the editions and manuscripts differ, which early Christians quoted it, where the Old and New Testaments meet, and every word in Greek or Hebrew.</p>
            <p className="legend">
              <span><Mark kind="var" /> editions differ</span>
              <span><Mark kind="fat" /> quoted by the fathers (faded: only after AD 325)</span>
              <span><Mark kind="quo" /> Old ↔ New Testament</span>
              <span className="muted">Change these in Settings ⚙</span>
            </p>
            {meta.data && (
              <p className="muted small">
                {meta.data.editions.length} editions · {meta.data.counts.works.toLocaleString()} early Christian works ·{" "}
                {meta.data.counts.citations.toLocaleString()} citations of Scripture · {meta.data.counts.commentary.toLocaleString()} comments
              </p>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
