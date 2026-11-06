import DOMPurify from "dompurify";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { verseUrl } from "../lib";
import {
  msDate,
  transcriptionUrl,
  useManuscriptText,
  useVerseTranscriptions,
  type TranscriptionSummary,
} from "../manuscriptsApi";
import { Siglum } from "./Manuscripts";

/*
 * Manuscript transcriptions (CNTR, CC BY-SA 4.0) as the scribes wrote them. The markup is light HTML made at
 * ingest (testimonia/ingest/transcriptions.py): word spans `w` (`ns` nomina sacra, `sup` words lost and supplied),
 * lost letters `m`, damaged `d`, gaps `gap`, line/column/page breaks `lb`/`cb`/`pb`, corrections `corr` (other
 * hands' readings in data-x/-a/-b/-c), and from the API `diff`/`om` where the printed text (NA28) differs.
 */

const ALLOWED_ATTR = ["class", "data-n", "data-x", "data-a", "data-b", "data-c", "data-p"];
const HANDS: [string, string][] = [
  ["x", "first written"],
  ["a", "second hand"],
  ["b", "third hand"],
  ["c", "fourth hand"],
];

/** Capitals with the lunate sigma (Ϲ), as the majuscule scribes wrote; the transcription itself is lower case. */
export function toUncial(s: string): string {
  return lunate(s).toUpperCase();
}

/** The scribes' one sigma, ϲ, for the transcription's σ (no final ς: that is a later, minuscule distinction). */
export function lunate(s: string): string {
  return s.replace(/[σς]/g, "ϲ");
}

function reading(s: string | null, uncial: boolean): string {
  if (!s || s === "—") return "nothing";
  return uncial ? toUncial(s) : lunate(s);
}

/** What a tapped correction / difference means, in words. */
export function noteFor(el: Element, uncial: boolean): string | null {
  if (el.classList.contains("corr")) {
    const parts = HANDS.filter(([h]) => el.hasAttribute(`data-${h}`)).map(
      ([h, label]) => `${label}: ${reading(el.getAttribute(`data-${h}`), uncial)}`,
    );
    return `Corrected — ${parts.join(" · ")}`;
  }
  if (el.classList.contains("om")) return `The printed text (NA28) adds: ${el.getAttribute("data-p")}`;
  if (el.classList.contains("diff")) {
    const p = el.getAttribute("data-p");
    if (p === "…") return null;
    return p && p !== "—" ? `The printed text (NA28) reads: ${p}` : "Not in the printed text (NA28)";
  }
  return null;
}

/** Sanitise, give marked places a tooltip, and (uncial view) turn the letters into capitals. */
export function prepare(markup: string, uncial: boolean): string {
  const safe = DOMPurify.sanitize(markup, { ALLOWED_TAGS: ["span"], ALLOWED_ATTR });
  const doc = new DOMParser().parseFromString(`<div>${safe}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return safe;
  root.querySelectorAll(".corr, .diff, .om").forEach((el) => {
    const note = noteFor(el, uncial);
    if (note) el.setAttribute("title", note);
  });
  root.querySelectorAll(".sup.vid").forEach((el) => el.setAttribute("title", "lost; its presence inferred from the space"));
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    n.nodeValue = uncial ? toUncial(n.nodeValue ?? "") : lunate(n.nodeValue ?? "");
  }
  return root.innerHTML;
}

const ABSENT = /^<span class="absent( vid)?"><\/span>$/;
const LEAD = /^(?:<span class="(?:pb|cb|lb)"(?: data-n="\d*")?><\/span>)+/;

/** Split off the page/column/line breaks a verse starts with: [breaks, the rest]. */
export function splitLead(markup: string): [string, string] {
  const m = LEAD.exec(markup);
  return m ? [m[0], markup.slice(m[0].length)] : ["", markup];
}

/** One verse of a manuscript, as written. Tapping a correction or a difference explains it below the text. */
export function MsVerse({ markup, uncial }: { markup: string; uncial: boolean }) {
  const [note, setNote] = useState<string | null>(null);
  const html = useMemo(() => prepare(markup, uncial), [markup, uncial]);
  const absent = ABSENT.exec(markup);
  if (absent) {
    return (
      <span className="mst-absent">
        does not have this verse{absent[1] ? " (judged from the space in a lacuna)" : ""}
      </span>
    );
  }
  function onClick(e: MouseEvent<HTMLSpanElement>) {
    const el = (e.target as HTMLElement).closest(".corr, .diff, .om");
    const next = el ? noteFor(el, uncial) : null;
    setNote((cur) => (next && next !== cur ? next : null));
  }
  return (
    <>
      <span className="mst-text" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
      {note && (
        <span className="mst-note" role="status">
          {note}
        </span>
      )}
    </>
  );
}

// ----------------------------------------------------------------------------- display options

interface MsOptions {
  uncial: boolean;
  lines: boolean;
  filled: boolean;
}
const OPTIONS_KEY = "testimonia.transcription";
const DEFAULTS: MsOptions = { uncial: true, lines: false, filled: false };

function loadOptions(): MsOptions {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? "{}") as Partial<MsOptions>) };
  } catch {
    return DEFAULTS;
  }
}

function useMsOptions(): [MsOptions, (patch: Partial<MsOptions>) => void] {
  const [opts, setOpts] = useState<MsOptions>(loadOptions);
  function update(patch: Partial<MsOptions>) {
    setOpts((cur) => {
      const next = { ...cur, ...patch };
      try {
        localStorage.setItem(OPTIONS_KEY, JSON.stringify(next));
      } catch {
        /* private mode: the choice lasts for this page only */
      }
      return next;
    });
  }
  return [opts, update];
}

function classes(opts: MsOptions): string {
  return ["mst", opts.uncial && "uncial", opts.lines && "lines", opts.filled && "filled"].filter(Boolean).join(" ");
}

function Legend() {
  return (
    <p className="mst-legend">
      <span>
        <span className="mst-key gap-key" /> lost (lacuna)
      </span>
      <span>
        <span className="mst-key-ns">ΘϹ</span> nomen sacrum, written with an overline
      </span>
      <span>
        <span className="mst-key-d">Α</span> damaged letter
      </span>
      <span>
        <span className="mst-key-corr">Α</span> corrected (tap for the other hands)
      </span>
    </p>
  );
}

// ----------------------------------------------------------------------------- manuscript page

/** The manuscript page's "Transcription" section: read the manuscript's text chapter by chapter. */
export function TranscriptionSection({ msId, t }: { msId: string; t: TranscriptionSummary }) {
  const [params, setParams] = useSearchParams();
  const book = params.get("b");
  const chapter = Number(params.get("c")) || null;
  const { data, error, isFetching } = useManuscriptText(msId, book, chapter);
  const [opts, setOpts] = useMsOptions();
  const current = data ? { book: data.book, chapter: data.chapter } : null;
  const currentBook = t.books.find((b) => b.osis === current?.book) ?? t.books[0];
  const { hash } = useLocation();
  const section = useRef<HTMLElement>(null);
  const ready = !!data;
  useEffect(() => {
    // arriving from a verse ("…?b=John&c=1#transcription"): bring the text into view once it is there
    if (ready && hash === "#transcription") {
      section.current?.scrollIntoView({ block: "start" });
    }
  }, [ready, hash]);
  if (!currentBook) return null;

  function go(b: string, c: number) {
    setParams(
      (p) => {
        p.set("b", b);
        p.set("c", String(c));
        return p;
      },
      { replace: true },
    );
  }

  return (
    <section className="mst-section" id="transcription" ref={section}>
      <h2>
        Transcription <span className="count">{t.verses.toLocaleString()} verses</span>
      </h2>
      <div className="mst-picker">
        {t.books.length > 1 && (
          <select
            aria-label="Book"
            value={currentBook.osis}
            onChange={(e) => go(e.target.value, t.books.find((b) => b.osis === e.target.value)?.chapters[0]?.chapter ?? 1)}
          >
            {t.books.map((b) => (
              <option key={b.osis} value={b.osis}>
                {b.name}
              </option>
            ))}
          </select>
        )}
        <div className="mst-chapters" role="list" aria-label={`${currentBook.name}: chapters`}>
          {t.books.length === 1 && <span className="mst-book">{currentBook.name}</span>}
          {currentBook.chapters.map((c) => (
            <button
              key={c.chapter}
              role="listitem"
              className={current?.book === currentBook.osis && current.chapter === c.chapter ? "on" : ""}
              title={`${c.verses} verses`}
              onClick={() => go(currentBook.osis, c.chapter)}
            >
              {c.chapter}
            </button>
          ))}
        </div>
      </div>
      <div className="mst-options">
        <div className="seg" role="group" aria-label="Letters">
          <button className={opts.uncial ? "on" : ""} onClick={() => setOpts({ uncial: true })}>
            ΑΒΓ
          </button>
          <button className={opts.uncial ? "" : "on"} onClick={() => setOpts({ uncial: false })}>
            αβγ
          </button>
        </div>
        <label className="toggle">
          <input type="checkbox" checked={opts.lines} onChange={(e) => setOpts({ lines: e.target.checked })} /> lines as on
          the page
        </label>
        <label className="toggle">
          <input type="checkbox" checked={opts.filled} onChange={(e) => setOpts({ filled: e.target.checked })} /> fill
          gaps with the editor’s letters
        </label>
      </div>
      {error && <p className="error">Could not load the transcription: {String(error)}</p>}
      {data && (
        <>
          <h3 className="mst-heading">{data.label}</h3>
          <div className={`${classes(opts)} mst-chapter${isFetching ? " mst-busy" : ""}`} lang="grc">
            {data.verses.map((v) => {
              const [lead, rest] = splitLead(v.markup);
              return (
                <span key={v.osis} className="mst-v">
                  {/* a verse that begins a new page, column or line: the break comes before its number */}
                  {lead && <span dangerouslySetInnerHTML={{ __html: prepare(lead, false) }} />}
                  <Link to={verseUrl(v.osis)} className="vnum" title={v.native ? `numbered ${v.native} in the manuscript's edition` : undefined}>
                    {v.verse}
                  </Link>
                  <MsVerse markup={rest} uncial={opts.uncial} />{" "}
                </span>
              );
            })}
          </div>
          <div className="mst-nav">
            {data.prev ? <button onClick={() => go(data.prev!.book, data.prev!.chapter)}>← {data.prev.label}</button> : <span />}
            {data.next && <button onClick={() => go(data.next!.book, data.next!.chapter)}>{data.next.label} →</button>}
          </div>
        </>
      )}
      <Legend />
      <p className="ms-credit muted small">
        Transcription: {t.attribution ?? t.source_name} ({licence(t.license)}). It follows the manuscript letter by letter —
        its spelling, its abbreviations and its corrections; gaps are text lost from the page. No images are reproduced.
      </p>
    </section>
  );
}

function licence(id: string): string {
  return id.replace(/^CC-/, "CC ").replace(/-(\d)/, " $1");
}

// ----------------------------------------------------------------------------- study panel

/** Study panel: the verse as written in the earliest transcribed manuscripts that have it. */
export function VerseTranscriptions({ osis }: { osis: string }) {
  const [limit, setLimit] = useState(3);
  const { data } = useVerseTranscriptions(osis, limit);
  const [opts, setOpts] = useMsOptions();
  if (!data || data.manuscripts.length === 0) return null;
  const more = data.total - data.manuscripts.length;
  const anyDiff = data.manuscripts.some((m) => m.differs > 0);
  return (
    <section className="block mst-block">
      <h3>
        As the manuscripts read it <span className="count">{data.total}</span>
        <button
          className="mst-case"
          onClick={() => setOpts({ uncial: !opts.uncial })}
          title={opts.uncial ? "Show in lower case" : "Show in capitals, as written"}
        >
          {opts.uncial ? "αβγ" : "ΑΒΓ"}
        </button>
      </h3>
      <ul className="mst-lines">
        {data.manuscripts.map((m) => (
          <li key={m.id}>
            <Link to={transcriptionUrl(m.id, osis)} className="mst-who" title={m.name ?? undefined}>
              <Siglum m={m} />
              <span className="mst-date">{msDate(m)}</span>
            </Link>
            <span className={`${classes({ ...opts, lines: false })} mst-line`} lang="grc">
              <MsVerse markup={m.markup} uncial={opts.uncial} />
            </span>
          </li>
        ))}
      </ul>
      <div className="mst-foot">
        {more > 0 && (
          <button className="more" onClick={() => setLimit(50)}>
            {more} more manuscript{more === 1 ? "" : "s"}
          </button>
        )}
        <span className="muted">
          Earliest first. Shaded gaps: text lost; overline: nomen sacrum
          {anyDiff ? "; tinted: differs from the printed text (NA28), tap to see" : ""}.{" "}
          {data.source && <>Transcriptions: CNTR ({licence(data.source.license)}).</>}
        </span>
      </div>
    </section>
  );
}
