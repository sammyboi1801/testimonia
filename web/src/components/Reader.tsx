import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openMap } from "../pins";
import { useBackClose } from "../backClose";
import { Link } from "react-router-dom";
import { isRtl, langClass, nativeLabel } from "../lib";
import { MODES, useSettings } from "../settings";
import type { Book, Chapter, ChapterVerse, Edition, VerseMarks, Word } from "../types";
import { useQuery } from "@tanstack/react-query";
import { getJson } from "../api";
import { TextWithNotes, type TextMark } from "./Footnotes";
import { placeMarks, type PlaceInText } from "./PlaceName";
import { Marks } from "./Marks";
import { useNotes, type Note } from "../notes";
import { ReadAloud } from "./ReadAloud";
import { SelectionToolbar } from "./SelectionToolbar";
import { speechLang } from "../speech";
import { PassageLink } from "./PassageLink";
import { PassagePicker } from "./PassagePicker";
import { Speak } from "./Speak";

const ALL_GREEK = "NA28+NA27+Tyn+SBL+WH+Treg+TR+Byz";

interface Props {
  data: Chapter;
  books: Book[];
  editions: Edition[];
  selected: string | null;
  through?: number | null;
  onSelect: (osis: string) => void;
  onWord: (strong: string, osis?: string) => void;
}

export function Reader({ data, books, editions, selected, through, onSelect, onWord }: Props) {
  const first = selected ? Number(selected.split(".")[2]) : 0;
  const span: [number, number] | null = first && through && through > first ? [first, through] : null;
  const { settings, update } = useSettings();
  const mode = settings.mode;
  const [viewOpen, setViewOpen] = useState(false); // phones: the View sheet
  useBackClose(viewOpen, () => setViewOpen(false));
  const byId = useMemo(() => new Map(editions.map((e) => [e.id, e])), [editions]);
  // the words under the text: Greek NT, Hebrew OT, or the Septuagint's Greek where there is no Hebrew (the deuterocanon)
  const hasNT = data.verses.some((v) => v.words.tagnt?.length);
  const hasHebrew = data.verses.some((v) => v.words.tahot?.length);
  const wordEd = hasNT ? "tagnt" : hasHebrew ? "tahot" : "lxx";
  const isNT = wordEd !== "tahot"; // i.e. the words are Greek
  // the reader's own translations that have this chapter; if none does, the first fallback that does
  const hasText = (e: string) => data.verses.some((v) => v.texts[e]?.text);
  const chosen = settings.editions.filter((e) => e !== "tagnt" && e !== "tahot" && e !== "lxx");
  const available = chosen.filter(hasText);
  const fallback = available.length ? null : data.editions.find((e) => !chosen.includes(e) && e !== "tagnt" && e !== "tahot" && e !== "lxx" && hasText(e)) ?? null;
  const textEds = available.length ? available : fallback ? [fallback] : [];
  const primary = textEds[0];
  const missing = chosen.filter((e) => !hasText(e));
  const hasWords = data.verses.some((v) => v.words[wordEd]?.length);
  // no word-by-word text for this book (2 Esdras, the Prayer of Manasseh): the word modes show the translations instead
  const view = (mode === "interlinear" || mode === "original") && !hasWords ? "parallel" : mode;
  const headings = useMemo(() => new Map(data.headings.map((h) => [h.vkey, h.title])), [data.headings]);
  const container = useRef<HTMLDivElement>(null);
  const [speaking, setSpeaking] = useState<string | null>(null);
  const verseLabel = useCallback((osis: string) => osis.replace(/^([1-4]?[A-Za-z]+)\.(\d+)\.(\d+)$/, `${data.name} $2:$3`), [data.name]);
  const listenEd = primary ? byId.get(primary) : undefined;
  const listenVerses = useMemo(
    () =>
      primary
        ? data.verses.filter((v) => v.verse > 0 && v.texts[primary]?.text).map((v) => ({ osis: v.osis, text: v.texts[primary]!.text }))
        : [],
    [data.verses, primary],
  );
  // keep the verse being read in view
  useEffect(() => {
    if (!speaking) return;
    container.current?.querySelector<HTMLElement>(`[data-osis="${CSS.escape(speaking)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [speaking]);

  useEffect(() => {
    if (!selected) {
      container.current?.scrollTo({ top: 0 });
      return;
    }
    const el = container.current?.querySelector<HTMLElement>(`[data-osis="${CSS.escape(selected)}"]`);
    el?.scrollIntoView({ block: "center" });
  }, [selected, data.book, data.chapter]);

  const { notes } = useNotes();
  const placesQuery = useQuery({
    queryKey: ["chapter-places", data.book, data.chapter],
    queryFn: () => getJson<{ verses: Record<number, PlaceInText[]> }>(`/api/chapter/${data.book}/${data.chapter}/places`),
    staleTime: Infinity,
  });
  const places = placesQuery.data?.verses ?? {};
  const ctx: RowCtx = { byId, wordEd, isNT, hasWords, onSelect, onWord, selected, span, footnotes: settings.display.footnotes, speaking, notes, places };

  return (
    <div className="reader" ref={container}>
      <SelectionToolbar root={container} verseLabel={verseLabel} />
      <div className="reader-head">
        <div className="chapter-title">
          <NavArrow to={data.prev} dir="‹" />
          <PassagePicker books={books} book={data.book} chapter={data.chapter} />
          <NavArrow to={data.next} dir="›" />
          <button className="view-btn" onClick={() => setViewOpen(true)} aria-label="Reading view and translations">
            <span aria-hidden>Aa</span> {MODES.find((m) => m.id === mode)?.label}
          </button>
        </div>
        {/* inline on wider screens; on phones a sheet opened from the "Aa" button */}
        {viewOpen && <div className="view-scrim" onClick={() => setViewOpen(false)} />}
        <div className={`reader-tools${viewOpen ? " open" : ""}`}>
        <div className="view-head">
          <strong>View</strong>
          <button className="icon-btn" onClick={() => setViewOpen(false)} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="view-label">Reading mode</div>
        <div className="modes" role="tablist" aria-label="Reading mode">
          {MODES.map((m) => (
            <button key={m.id} role="tab" aria-selected={mode === m.id} className={mode === m.id ? "on" : ""} title={m.hint} onClick={() => update({ mode: m.id })}>
              {m.label}
            </button>
          ))}
        </div>
        <div className="view-label">{mode === "parallel" ? "Translations side by side" : "Translation"}</div>
        <EditionPicker editions={editions} chosen={settings.editions} onChange={(eds) => update({ editions: eds })} single={mode !== "parallel"} />
        <ReadAloud
          verses={listenVerses}
          lang={speechLang(listenEd?.language ?? "eng")}
          title={`${data.name} ${data.chapter} · ${listenEd?.abbrev ?? ""}`}
          next={data.next}
          onVerse={setSpeaking}
        />
        <button className="map-btn" onClick={() => {
          setViewOpen(false);
           openMap({ ref: `${data.book} ${data.chapter}`, title: `${data.name} ${data.chapter}` });
        }} title="The places in this chapter, on a map" aria-label="Map this chapter">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m9 4-6 2v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14" />
          </svg>
          <span>Map<span className="map-long"> this chapter</span></span>
        </button>
        </div>
      </div>

      {(missing.length > 0 || ((mode === "interlinear" || mode === "original") && !hasWords)) && (
        <p className="reader-note">
          {missing.length > 0 && (
            <>
              {missing.map((e) => byId.get(e)?.abbrev ?? e).join(", ")} {missing.length === 1 ? "does" : "do"} not include {data.name}
              {fallback ? <> — showing {byId.get(fallback)?.abbrev ?? fallback}</> : null}.{" "}
            </>
          )}
          {(mode === "interlinear" || mode === "original") && !hasWords && (
            <>{data.name} has no word-by-word Greek or Hebrew here{data.book === "2Esd" ? " (it survives in Latin, not Greek)" : ""}; the translation is shown.</>
          )}
        </p>
      )}

      {mode === "reading" ? (
        <ReadingView data={data} edition={primary} headings={headings} ctx={ctx} />
      ) : (
        <div className="verses">
          <ColumnHeads mode={view} textEds={textEds} primary={primary} ctx={ctx} />
          {data.verses.map((v) => (
            <Fragment key={v.vkey}>
              {headings.get(v.vkey) && (
                <h2 className="pericope">
                  {headings.get(v.vkey)} <PassageLink osis={v.osis} title={headings.get(v.vkey)} variant="heading" />
                </h2>
              )}
              <VerseRow v={v} mode={view} textEds={textEds} primary={primary} ctx={ctx} />
            </Fragment>
          ))}
        </div>
      )}
      <div className="chapter-foot">
        <NavArrow to={data.prev} dir="‹ Previous chapter" />
        <NavArrow to={data.next} dir="Next chapter ›" />
      </div>
    </div>
  );
}

interface RowCtx {
  byId: Map<string, Edition>;
  wordEd: string;
  isNT: boolean;
  hasWords: boolean; // the chapter has word-by-word text at all
  selected: string | null;
  span: [number, number] | null; // verses of a range opened from a reference (in this chapter)
  onSelect: (osis: string) => void;
  onWord: (strong: string, osis?: string) => void;
  footnotes: boolean;
  speaking: string | null;
  notes: Record<string, Note>;
  places: Record<number, PlaceInText[]>;
}

/** Highlights for one verse in one edition, plus the place names it mentions (English texts). */
function verseMarks(ctx: RowCtx, v: ChapterVerse, ed: string, text: string): TextMark[] {
  const marks: TextMark[] = ctx.notes[v.osis]?.marks?.filter((m) => m.ed === ed) ?? [];
  return ctx.byId.get(ed)?.language === "eng" ? [...marks, ...placeMarks(text, ctx.places[v.vkey])] : marks;
}

function NavArrow({ to, dir }: { to: Chapter["prev"]; dir: string }) {
  if (!to) return <span className="nav-arrow disabled">{dir}</span>;
  return (
    <Link className="nav-arrow" to={`/read/${to.book}/${to.chapter}`} title={`${to.name} ${to.chapter}`}>
      {dir}
    </Link>
  );
}

function ColumnHeads({ mode, textEds, primary, ctx }: { mode: string; textEds: string[]; primary?: string; ctx: RowCtx }) {
  const label = (id?: string) => (id ? ctx.byId.get(id)?.abbrev ?? id : "");
  const heads = mode === "parallel" ? textEds.map(label) : mode === "original" ? [ctx.wordEd === "lxx" ? "Greek (Septuagint)" : ctx.isNT ? "Greek (SBLGNT)" : "Hebrew (Leningrad)", label(primary)] : [];
  if (heads.length < 2) return null;
  return (
    <div className="verse-row column-heads" style={{ ["--cols" as string]: String(heads.length) }}>
      <span className="gutter" />
      {heads.map((h) => (
        <div key={h} className="col-head">
          {h}
        </div>
      ))}
    </div>
  );
}

const inSpan = (ctx: RowCtx, n: number) => !!ctx.span && n >= ctx.span[0] && n <= ctx.span[1];

function VerseRow({ v, mode, textEds, primary, ctx }: { v: ChapterVerse; mode: string; textEds: string[]; primary?: string; ctx: RowCtx }) {
  const words = v.words[ctx.wordEd] ?? [];
  const isSel = v.osis === ctx.selected;
  const cols = mode === "parallel" ? textEds.length : mode === "original" ? 2 : 1;
  return (
    <div
      className={`verse-row mode-${mode}${isSel ? " selected" : ""}${inSpan(ctx, v.verse) ? " in-range" : ""}${v.osis === ctx.speaking ? " speaking" : ""}${ctx.notes[v.osis]?.highlight ? ` hl-${ctx.notes[v.osis]!.highlight}` : ""}`}
      data-osis={v.osis}
      id={`v${v.verse}`}
      style={{ ["--cols" as string]: String(Math.max(cols, 1)) }}
      onClick={() => window.getSelection()?.isCollapsed !== false && ctx.onSelect(v.osis)}
    >
      <Gutter marks={v.marks} verse={v.verse} note={ctx.notes[v.osis]} />
      {mode === "parallel" && textEds.map((id) => <TextCell key={id} v={v} id={id} ctx={ctx} />)}
      {mode === "original" && (
        <>
          <OriginalCell words={words} ctx={ctx} />
          {primary && <TextCell v={v} id={primary} ctx={ctx} />}
        </>
      )}
      {mode === "interlinear" && (
        <div className="stack">
          {primary && <TextCell v={v} id={primary} ctx={ctx} />}
          {words.length > 0 ? (
            <div className={`cell words ${ctx.isNT ? "greek" : "hebrew"}`} dir={ctx.isNT ? "ltr" : "rtl"}>
              {words.map((w) => (
                <WordChip key={w.pos} w={w} lang={ctx.isNT ? "grc" : "hbo"} onWord={ctx.onWord} />
              ))}
            </div>
          ) : (
            ctx.hasWords && <div className="cell words-missing">not in the {ctx.isNT ? "Greek" : "Hebrew"} text</div>
          )}
        </div>
      )}
    </div>
  );
}

function Gutter({ marks, verse, note }: { marks?: VerseMarks; verse: number; note?: Note }) {
  const m = marks ?? {};
  const tips: string[] = [];
  if (m.variants) tips.push(`${m.variants} textual variant${m.variants > 1 ? "s" : ""}${m.major_variants ? ` (${m.major_variants} significant)` : ""}`);
  if (m.fathers) tips.push(`cited ${m.fathers}× by church fathers (${m.pre_nicene ?? 0} before AD 325)`);
  if (m.quotations) tips.push(`${m.quotations} Old ↔ New Testament link${m.quotations > 1 ? "s" : ""}`);
  return (
    <span className="gutter" title={tips.join("\n")}>
      <span className="vnum">{verse === 0 ? "title" : verse}</span>
      <span className="marks">
        <Marks marks={marks} />
        {note?.text && (
          <i className="mk mk-note" title={`My note: ${note.text.slice(0, 120)}`}>
            ✎
          </i>
        )}
      </span>
    </span>
  );
}

function TextCell({ v, id, ctx }: { v: ChapterVerse; id: string; ctx: RowCtx }) {
  const ed = ctx.byId.get(id);
  const t = v.texts[id];
  const rtl = ed ? isRtl(ed.language) : false;
  return (
    <div
      className={`cell ${ed ? langClass(ed.language) : ""}${v.red_letter && ed?.language === "eng" ? " red" : ""}`}
      dir={rtl ? "rtl" : undefined}
      lang={ed?.language}
      data-ed={ed?.abbrev ?? id}
    >
      {t ? (
        <>
          <span className="vtext" data-osis={v.osis} data-ed={id} data-text={t.text}>
            <TextWithNotes text={t.text} notes={ctx.footnotes ? t.notes : undefined} marks={verseMarks(ctx, v, id, t.text)} />
          </span>
          {t.native && (
            <span className="native" title={`Numbered ${nativeLabel(t.native, v.osis)} in ${ed?.abbrev ?? id}`}>
              {nativeLabel(t.native, v.osis)}
            </span>
          )}
        </>
      ) : (
        <span className="missing">—</span>
      )}
    </div>
  );
}

/** Running Greek (SBLGNT words) or Hebrew (Leningrad) text, every word hoverable and clickable. */
function OriginalCell({ words, ctx }: { words: Word[]; ctx: RowCtx }) {
  const shown = ctx.isNT ? words.filter((w) => !w.editions || w.editions.split("+").includes("SBL")) : words;
  const lang = ctx.isNT ? "grc" : "hbo";
  // a verse the Greek or Hebrew does not have (John 1:52 in some numberings, Sirach 24:18): say so
  if (shown.length === 0) return <div className="cell words-missing">not in the {ctx.isNT ? "Greek" : "Hebrew"} text</div>;
  return (
    <div className={`cell original ${ctx.isNT ? "greek" : "hebrew"}`} dir={ctx.isNT ? "ltr" : "rtl"} lang={lang}>
      {shown.map((w) => (
        <Fragment key={w.pos}>
          <HoverWord w={w} lang={lang} onWord={ctx.onWord}>
            <span className={`ow${w.editions && w.editions !== ALL_GREEK && ctx.isNT ? " variant" : ""}`}>{w.surface}</span>
          </HoverWord>{" "}
        </Fragment>
      ))}
      {shown.length > 0 && (
        <span className="verse-speak">
          <Speak text={shown.map((w) => w.surface).join(" ")} lang={lang} />
        </span>
      )}
    </div>
  );
}

function WordChip({ w, lang, onWord }: { w: Word; lang: "grc" | "hbo"; onWord: (s: string, osis?: string) => void }) {
  const variant = lang === "grc" && w.editions && w.editions !== ALL_GREEK ? w.editions : null;
  return (
    <HoverWord w={w} lang={lang} onWord={onWord}>
      <span className={`word${variant ? " variant" : ""}`}>
        <span className="w-surface">{w.surface}</span>
        <span className="w-gloss">{w.gloss}</span>
      </span>
    </HoverWord>
  );
}

function lemmaId(w: Word): string | null {
  return w.lemma_id ?? w.strong?.split(" ").find((s) => /^[GH]\d{4}/.test(s) && !/^H9\d{3}/.test(s)) ?? null;
}

/** Hover card for an original-language word: dictionary form, gloss, parsing, editions, pronunciation. */
function HoverWord({ w, lang, onWord, children }: { w: Word; lang: "grc" | "hbo"; onWord: (s: string, osis?: string) => void; children: React.ReactNode }) {
  const { settings } = useSettings();
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const id = lemmaId(w);
  const variant = lang === "grc" && w.editions && w.editions !== ALL_GREEK ? w.editions.replaceAll("+", ", ") : null;
  return (
    <span
      className="hover-word"
      onMouseEnter={() => {
        window.clearTimeout(timer.current);
        // touch screens skip the card: a tap opens the full word study instead
        if (settings.hover.cards && window.matchMedia("(hover: hover)").matches) timer.current = window.setTimeout(() => setOpen(true), settings.hover.delay);
      }}
      onMouseLeave={() => {
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setOpen(false), 120);
      }}
      onClick={(e) => {
        e.stopPropagation();
        setOpen(false);
        // the verse the word belongs to, so phones (where the panel shows only with a verse) open the study at once
        const osis = (e.currentTarget.closest("[data-osis]") as HTMLElement | null)?.dataset.osis;
        if (id) onWord(id, osis);
      }}
    >
      {children}
      {open && settings.hover.cards && (
        <span className="word-card" dir="ltr" role="tooltip" onClick={(e) => e.stopPropagation()}>
          <span className="wc-head">
            <span className={`wc-lemma ${lang === "grc" ? "greek" : "hebrew"}`}>{w.lemma ?? w.surface}</span>
            <Speak text={w.surface} lang={lang} />
          </span>
          {w.translit && <span className="wc-translit">{w.translit}</span>}
          <span className="wc-gloss">{w.gloss ?? w.lemma_gloss}</span>
          {(w.morph_text || w.morph) && <span className="wc-morph">{w.morph_text ?? w.morph}</span>}
          {variant && <span className="wc-var">Only in: {variant}</span>}
          {id && <span className="wc-hint">Click the word for its full study · {id}</span>}
        </span>
      )}
    </span>
  );
}

/** Book-like reading: one text in paragraphs that break at section headings. */
function ReadingView({ data, edition, headings, ctx }: { data: Chapter; edition?: string; headings: Map<number, string>; ctx: RowCtx }) {
  const ed = edition ? ctx.byId.get(edition) : undefined;
  const paragraphs: { title?: string; verses: ChapterVerse[] }[] = [];
  for (const v of data.verses) {
    const title = headings.get(v.vkey);
    if (title || !paragraphs.length) paragraphs.push({ title, verses: [] });
    paragraphs[paragraphs.length - 1]!.verses.push(v);
  }
  return (
    <div className={`reading-view ${ed ? langClass(ed.language) : ""}`} dir={ed && isRtl(ed.language) ? "rtl" : undefined}>
      {paragraphs.map((p, i) => (
        <section key={i}>
          {p.title && (
            <h2 className="pericope">
              {p.title} <PassageLink osis={p.verses[0]!.osis} title={p.title} variant="heading" />
            </h2>
          )}
          <p>
            {p.verses.map((v) => {
              const t = edition ? v.texts[edition] : undefined;
              if (!t) return null;
              return (
                <span
                  key={v.vkey}
                  className={`rv${v.osis === ctx.selected ? " selected" : ""}${inSpan(ctx, v.verse) ? " in-range" : ""}${v.osis === ctx.speaking ? " speaking" : ""}${v.red_letter && ed?.language === "eng" ? " red" : ""}${ctx.notes[v.osis]?.highlight ? ` hl-${ctx.notes[v.osis]!.highlight}` : ""}`}
                  data-osis={v.osis}
                  onClick={() => window.getSelection()?.isCollapsed !== false && ctx.onSelect(v.osis)}
                >
                  <sup className="vnum">
                    <span className="n">{v.verse === 0 ? "" : v.verse}</span>
                    <Marks marks={v.marks} />
                  </sup>
                  <span className="vtext" data-osis={v.osis} data-ed={edition} data-text={t.text}>
                    <TextWithNotes text={t.text} notes={ctx.footnotes ? t.notes : undefined} marks={edition ? verseMarks(ctx, v, edition, t.text) : undefined} />
                  </span>{" "}
                </span>
              );
            })}
          </p>
        </section>
      ))}
    </div>
  );
}

function EditionPicker({ editions, chosen, onChange, single }: { editions: Edition[]; chosen: string[]; onChange: (e: string[]) => void; single: boolean }) {
  const [open, setOpen] = useState(false);
  const texts = editions.filter((e) => e.kind !== "interlinear");
  const visible = single ? chosen.slice(0, 1) : chosen;
  const add = texts.filter((e) => !visible.includes(e.id));
  return (
    <div className="edition-picker">
      {visible.map((id) => {
        const e = editions.find((x) => x.id === id);
        if (!e) return null;
        return (
          <span key={id} className="chip" title={e.title}>
            {e.abbrev ?? e.id}
            {!single && chosen.length > 1 && (
              <button aria-label={`Remove ${e.title}`} onClick={() => onChange(chosen.filter((c) => c !== id))}>
                ×
              </button>
            )}
          </span>
        );
      })}
      <div className="add-wrap">
        <button className="chip add" onClick={() => setOpen(!open)} aria-expanded={open}>
          {single ? "Change" : "+ Add translation"}
        </button>
        {open && (
          <ul className="menu" onMouseLeave={() => setOpen(false)}>
            {add.map((e) => (
              <li key={e.id}>
                <button
                  onClick={() => {
                    onChange(single ? [e.id, ...chosen.filter((c) => c !== e.id)] : [...chosen, e.id].slice(0, 6));
                    setOpen(false);
                  }}
                >
                  <b>{e.abbrev ?? e.id}</b> {e.title}
                  {e.year ? <span className="muted"> · {e.year}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
