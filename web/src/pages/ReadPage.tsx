import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { chapterQuery, useChapter, useMeta } from "../api";
import { markNav, reducedMotion, takeNav } from "../chapterNav";
import { rememberReading } from "../lib";
import { Reader } from "../components/Reader";
import { Mark } from "../components/Marks";
import { Splitter } from "../components/Splitter";
import { WikiCard } from "../components/Wiki";
import type { Book } from "../types";
import { StudyPanel, type Tab } from "../components/StudyPanel";
import { useSettings } from "../settings";

const TABS: Tab[] = ["about", "text", "fathers", "commentary", "links", "words"];

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
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const mainRef = useRef<HTMLElement>(null);
  const prevCh = data.data?.prev ?? null;
  const nextCh = data.data?.next ?? null;
  // the chapters either side are loaded quietly, so turning the page is instant
  const edKey = editions.join(",");
  useEffect(() => {
    if (!data.data) return;
    const t = setTimeout(() => {
      for (const n of [nextCh, prevCh]) if (n) void queryClient.prefetchQuery(chapterQuery(n.book, n.chapter, edKey.split(",")));
    }, 400);
    return () => clearTimeout(t);
  }, [data.data, nextCh, prevCh, edKey, queryClient]);
  // a new chapter slides in from the side the reader was heading (arrows and swipes mark the direction)
  useLayoutEffect(() => {
    const el = mainRef.current;
    const dir = takeNav();
    if (!el) return;
    el.style.transition = el.style.transform = el.style.opacity = "";
    el.classList.remove("ch-in-next", "ch-in-prev");
    if (!dir || reducedMotion()) return;
    void el.offsetWidth; // restart the animation
    el.classList.add(`ch-in-${dir}`);
    const done = () => el.classList.remove("ch-in-next", "ch-in-prev");
    el.addEventListener("animationend", done, { once: true });
  }, [book, ch]);
  // phones: swipe the text sideways to turn the chapter; it follows the finger, then slides away
  const turn = useRef({ prev: prevCh, next: nextCh });
  turn.current = { prev: prevCh, next: nextCh };
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    let sx = 0;
    let sy = 0;
    let dx = 0;
    let lock: "x" | "y" | null = null;
    let active = false;
    const start = (e: TouchEvent) => {
      active = false;
      if (window.innerWidth > 760 || e.touches.length > 1) return;
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, button, .reader-tools.open, .picker-pop, .no-swipe")) return;
      const sel = window.getSelection?.();
      if (sel && !sel.isCollapsed) return;
      sx = e.touches[0]!.clientX;
      sy = e.touches[0]!.clientY;
      dx = 0;
      lock = null;
      active = true;
    };
    const move = (e: TouchEvent) => {
      if (!active) return;
      const mx = e.touches[0]!.clientX - sx;
      const my = e.touches[0]!.clientY - sy;
      if (!lock) {
        if (Math.abs(mx) > 12 && Math.abs(mx) > Math.abs(my) * 1.4) lock = "x";
        else if (Math.abs(my) > 10) {
          lock = "y";
          active = false;
          return;
        } else return;
      }
      e.preventDefault();
      dx = mx;
      const target = dx < 0 ? turn.current.next : turn.current.prev;
      const shown = target ? dx : dx * 0.25; // nothing that way: resist
      el.style.transition = "none";
      el.style.transform = `translateX(${shown}px) rotate(${shown / 90}deg)`;
      el.style.opacity = String(1 - Math.min(Math.abs(shown) / window.innerWidth, 0.6) * 0.7);
    };
    const end = () => {
      if (!active || lock !== "x") return;
      active = false;
      const target = dx < 0 ? turn.current.next : turn.current.prev;
      if (target && Math.abs(dx) > 70) {
        el.style.transition = "transform .2s cubic-bezier(.4,0,1,1), opacity .2s";
        el.style.transform = `translateX(${dx < 0 ? -110 : 110}%) rotate(${dx < 0 ? -3 : 3}deg)`;
        el.style.opacity = "0";
        const dir = dx < 0 ? "next" : "prev";
        setTimeout(() => {
          markNav(dir);
          navigate(`/read/${target.book}/${target.chapter}`);
        }, 190);
      } else {
        el.style.transition = "transform .45s cubic-bezier(.2,1.4,.4,1), opacity .3s";
        el.style.transform = "";
        el.style.opacity = "";
      }
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
    };
  }, [navigate]);
  const selected = params.get("v");
  // each chapter (and verse) gets its own title, for bookmarks, history and search results
  const bookName = data.data?.name ?? book;
  useEffect(() => {
    const at = selected ? `${bookName} ${selected.split(".").slice(1).join(":")}` : `${bookName} ${ch}`;
    document.title = `${at}: Greek, Hebrew and Commentary | Testimonia`;
    return () => {
      document.title = "Testimonia | Free Online Study Bible with Greek, Hebrew and Commentary";
    };
  }, [bookName, ch, selected]);
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
  // phones: the study panel is a sheet that snaps to half or full height and slides away when flicked down
  const asideRef = useRef<HTMLElement>(null);
  const [sheet, setSheet] = useState<"half" | "full">("half");
  const [closing, setClosing] = useState(false);
  const closeRef = useRef(closeVerse);
  closeRef.current = closeVerse;
  const closeSheet = useCallback(() => {
    if (window.innerWidth > 760 || reducedMotion()) return closeRef.current();
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      setSheet("half");
      closeRef.current();
    }, 230);
  }, []);
  const sheetNow = useRef(sheet);
  sheetNow.current = sheet;
  useEffect(() => {
    const el = asideRef.current;
    if (!el) return;
    let y0 = 0;
    let t0 = 0;
    let h0 = 0;
    let dy = 0;
    let scroll0 = 0;
    let mode: "drag" | "scroll" | null = null;
    const start = (e: TouchEvent) => {
      mode = null;
      if (window.innerWidth > 760 || e.touches.length > 1) return;
      y0 = e.touches[0]!.clientY;
      t0 = performance.now();
      h0 = el.getBoundingClientRect().height;
      scroll0 = el.scrollTop;
      dy = 0;
    };
    const move = (e: TouchEvent) => {
      if (window.innerWidth > 760 || mode === "scroll") return;
      dy = e.touches[0]!.clientY - y0;
      if (!mode) {
        if (Math.abs(dy) < 6) return;
        const atTop = scroll0 <= 0 && el.scrollTop <= 0;
        mode = (dy > 0 && atTop) || (dy < 0 && sheetNow.current === "half") ? "drag" : "scroll";
        if (mode === "scroll") return;
      }
      e.preventDefault();
      el.classList.add("dragging");
      el.style.height = `${Math.max(90, Math.min(window.innerHeight * 0.94, h0 - dy))}px`;
    };
    const end = () => {
      if (mode !== "drag") return;
      mode = null;
      el.classList.remove("dragging");
      const vh = window.innerHeight;
      const h = h0 - dy;
      const v = dy / Math.max(1, performance.now() - t0); // px per ms, + is down
      el.style.height = "";
      if (dy > 0 && (h < vh * 0.38 || (v > 0.7 && sheetNow.current === "half"))) closeSheet();
      else if (h > vh * 0.72 || v < -0.5) setSheet("full");
      else setSheet("half");
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
    };
  }, [closeSheet]);
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
      <main ref={mainRef}>
        {data.isLoading && (
          <div className="skel-reader" aria-busy="true" aria-label="Loading the chapter">
            <div className="skel skel-head" />
            {[96, 88, 93, 71, 90, 84, 95, 62, 89, 80].map((w, i) => <div key={i} className="skel skel-line" style={{ width: `${w}%` }} />)}
          </div>
        )}
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
      {selected && open && <div className={`sheet-scrim${closing ? " out" : ""}`} onClick={closeSheet} aria-hidden />}
      <aside ref={asideRef} className={`guide${sheet === "full" ? " sheet-full" : ""}${closing ? " sheet-out" : ""}`} aria-label="Study panel" hidden={!open}>
        <button className="panel-hide icon-btn" onClick={() => setOpen(false)} title="Hide the study panel ( ] )" aria-label="Hide the study panel">
          ›
        </button>
        {selected ? (
          <StudyPanel osis={selected} books={books} tab={tab} word={word} onTab={setTab} onWord={openWord} onCloseWord={closeWord} onClose={closeSheet} />
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
