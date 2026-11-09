import { useCallback, useEffect, useRef } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { useChapter, useMeta } from "../api";
import { rememberReading } from "../lib";
import { Reader } from "../components/Reader";
import { Mark } from "../components/Marks";
import { Splitter } from "../components/Splitter";
import { WikiCard } from "../components/Wiki";
import type { Book } from "../types";
import { StudyPanel, type Tab } from "../components/StudyPanel";
import { useSettings } from "../settings";

const TABS: Tab[] = ["about", "text", "fathers", "links", "words"];

export function ReadPage() {
  const { book = "John", chapter = "1" } = useParams();
  const [params, setParams] = useSearchParams();
  const { settings, update } = useSettings();
  const meta = useMeta();
  const ch = Number(chapter);
  useEffect(() => {
    rememberReading(book, ch);
  }, [book, ch]);
  const needsWords = settings.mode === "interlinear" || settings.mode === "original";
  // the reader's translations, then broad ones to fall back on (Psalm 151 is not in the KJV, Tobit not in the BSB)
  const FALLBACK = ["web", "kjva", "brenton", "dra"];
  const editions = [...new Set([...settings.editions, ...FALLBACK, ...(needsWords ? ["tagnt", "tahot", "lxx"] : [])])];
  const data = useChapter(book, ch, editions);
  const selected = params.get("v");
  const drag = useRef<number | null>(null); // pull-down-to-close on phones
  // closing a verse picked on this page steps Back (the pick added that entry); otherwise it replaces
  const pickedHere = useRef(false);
  useEffect(() => {
    if (!selected) pickedHere.current = false;
  }, [selected]);
  const closeVerse = () => {
    if (pickedHere.current) {
      pickedHere.current = false;
      window.history.back();
    } else setParam({ v: null, w: null, t: null, to: null }, true);
  };
  const through = Number(params.get("to")) || null; // a range from the selected verse, shaded in the text
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
  const open = settings.panel.open;
  const setOpen = useCallback((o: boolean) => update({ panel: { ...settings.panel, open: o } }), [update, settings.panel]);
  // choosing a verse brings the study panel back if it was hidden
  const select = useCallback(
    (osis: string) => {
      if (osis === selected) return closeVerse(); // tap again: deselect
      if (!selected) pickedHere.current = true;
      setParam({ v: osis, w: null, to: null }, Boolean(selected)); // first pick: Back deselects; switching replaces
      if (!open) setOpen(true);
    },
    [setParam, open, setOpen, selected],
  );
  // "]" shows or hides the study panel (ignored while typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "]" || e.ctrlKey || e.metaKey || e.altKey || t?.closest("input, textarea, select, [contenteditable]")) return;
      setOpen(!open);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);
  const openWord = useCallback(
    (strong: string, osis?: string) => {
      setParam({ w: strong, t: "words", ...(osis && osis !== selected ? { v: osis, to: null } : {}) });
      if (!open) setOpen(true);
    },
    [setParam, selected, open, setOpen],
  );
  const closeWord = useCallback(() => setParam({ w: null }), [setParam]);
  const setTab = useCallback((t: Tab) => setParam({ t, w: null }, true), [setParam]);

  if (!Number.isInteger(ch) || ch < 1) return <Navigate to="/read/John/1" replace />;
  const books = meta.data?.books ?? [];
  // a chapter with no text in this numbering (Additions to Esther 1–9): go to the first that has text
  const firstCh = books.find((b) => b.osis === book)?.first_chapter ?? 1;
  if (ch < firstCh) return <Navigate to={`/read/${book}/${firstCh}`} replace />;

  return (
    <div className={`workspace${open ? "" : " panel-closed"}${selected ? " has-verse" : ""}`} style={{ ["--study-w" as string]: `${settings.layout.study}px` }}>
      <main>
        {data.isLoading && <div className="loading">Loading…</div>}
        {data.error && <div className="error">Could not load {book} {chapter}: {String(data.error)}</div>}
        {data.data && meta.data && (
          <Reader data={data.data} books={books} editions={meta.data.editions} selected={selected} through={through} onSelect={select} onWord={openWord} />
        )}
      </main>
      <Splitter
        label="Study panel width"
        side="right"
        value={settings.layout.study}
        min={300}
        max={900}
        reset={440}
        onChange={(study) => update({ layout: { ...settings.layout, study } })}
      />
      {!open && (
        <button className="panel-rail" onClick={() => setOpen(true)} title="Show the study panel ( ] )" aria-label="Show the study panel">
          <span>‹ Study panel</span>
        </button>
      )}
      <aside
        className="guide"
        aria-label="Study panel"
        hidden={!open}
        // phones: pull the sheet down from its top to close the verse
        onTouchStart={(e) => {
          const el = e.currentTarget;
          drag.current = el.scrollTop <= 0 && window.innerWidth <= 760 ? e.touches[0]!.clientY : null;
        }}
        onTouchMove={(e) => {
          if (drag.current === null) return;
          const dy = e.touches[0]!.clientY - drag.current;
          e.currentTarget.style.transform = dy > 0 ? `translateY(${dy}px)` : "";
        }}
        onTouchEnd={(e) => {
          const el = e.currentTarget;
          const dy = drag.current === null ? 0 : e.changedTouches[0]!.clientY - drag.current;
          drag.current = null;
          el.style.transform = "";
          if (dy > 90 && selected) closeVerse();
        }}
      >
        <button className="panel-hide icon-btn" onClick={() => setOpen(false)} title="Hide the study panel ( ] )" aria-label="Hide the study panel">
          ›
        </button>
        {selected ? (
          <StudyPanel osis={selected} books={books} tab={tab} word={word} onTab={setTab} onWord={openWord} onCloseWord={closeWord} onClose={closeVerse} />
        ) : (
          <div className="guide-empty">
            <BookIntro book={books.find((b) => b.osis === (data.data?.book ?? book))} />
            <p className="muted small">
              Choose a verse to see what stands behind it — how the editions and manuscripts differ, which early Christians quoted it, where the Old
              and New Testaments meet, and every word in Greek or Hebrew.
            </p>
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

const TESTAMENT: Record<string, string> = { OT: "Old Testament", NT: "New Testament", DC: "Deuterocanon / Apocrypha" };

/** The study panel before a verse is chosen: an introduction to the book being read. */
function BookIntro({ book }: { book?: Book }) {
  if (!book) return <h2>Study panel</h2>;
  const names = [
    book.hebrew_name && { label: "Hebrew", value: book.hebrew_name, cls: "hebrew" },
    book.greek_name && { label: "Greek", value: book.greek_name, cls: "greek" },
    book.latin_name && { label: "Latin", value: book.latin_name, cls: "" },
  ].filter(Boolean) as { label: string; value: string; cls: string }[];
  return (
    <section className="book-intro">
      <div className="about-label">About this book</div>
      <h2>{book.name}</h2>
      <div className="ctx-meta">
        <span>{TESTAMENT[book.testament] ?? book.testament}</span>
        {book.genre && <span>{book.genre}</span>}
        <span>
          {book.chapters} chapter{book.chapters === 1 ? "" : "s"}
        </span>
      </div>
      {names.length > 0 && (
        <dl className="book-names">
          {names.map((n) => (
            <div key={n.label}>
              <dt>{n.label}</dt>
              <dd className={n.cls}>{n.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {book.wikipedia && <WikiCard title={book.wikipedia} />}
      <Link className="btn book-more" to={`/book/${book.osis}`}>
        More about {book.name} →
      </Link>
    </section>
  );
}
