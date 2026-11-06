import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { isRtl, langClass } from "../lib";
import { MODES, useSettings } from "../settings";
import type { Book, Chapter, ChapterVerse, Edition, VerseMarks, Word } from "../types";
import { TextWithNotes } from "./Footnotes";
import { Marks } from "./Marks";
import { useNotes, type Note } from "../notes";
import { ReadAloud } from "./ReadAloud";
import { speechLang } from "../speech";
import { PassagePicker } from "./PassagePicker";
import { Speak } from "./Speak";

const ALL_GREEK = "NA28+NA27+Tyn+SBL+WH+Treg+TR+Byz";

interface Props {
  data: Chapter;
  books: Book[];
  editions: Edition[];
  selected: string | null;
  onSelect: (osis: string) => void;
  onWord: (strong: string) => void;
}

export function Reader({ data, books, editions, selected, onSelect, onWord }: Props) {
  const { settings, update } = useSettings();
  const byId = useMemo(() => new Map(editions.map((e) => [e.id, e])), [editions]);
  const isNT = data.verses.some((v) => v.words.tagnt?.length);
  const wordEd = isNT ? "tagnt" : "tahot";
  const textEds = data.editions.filter((e) => e !== "tagnt" && e !== "tahot");
  const primary = textEds[0];
  const headings = useMemo(() => new Map(data.headings.map((h) => [h.vkey, h.title])), [data.headings]);
  const container = useRef<HTMLDivElement>(null);
  const mode = settings.mode;
  const [speaking, setSpeaking] = useState<string | null>(null);
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
  const ctx: RowCtx = { byId, wordEd, isNT, onSelect, onWord, selected, footnotes: settings.display.footnotes, speaking, notes };

  return (
    <div className="reader" ref={container}>
      <div className="reader-head">
        <div className="chapter-title">
          <NavArrow to={data.prev} dir="‹" />
          <PassagePicker books={books} book={data.book} chapter={data.chapter} />
          <NavArrow to={data.next} dir="›" />
        </div>
        <div className="modes" role="tablist" aria-label="Reading mode">
          {MODES.map((m) => (
            <button key={m.id} role="tab" aria-selected={mode === m.id} className={mode === m.id ? "on" : ""} title={m.hint} onClick={() => update({ mode: m.id })}>
              {m.label}
            </button>
          ))}
        </div>
        <EditionPicker editions={editions} chosen={settings.editions} onChange={(eds) => update({ editions: eds })} single={mode !== "parallel"} />
        <ReadAloud
          verses={listenVerses}
          lang={speechLang(listenEd?.language ?? "eng")}
          title={`${data.name} ${data.chapter} · ${listenEd?.abbrev ?? ""}`}
          next={data.next}
          onVerse={setSpeaking}
        />
      </div>

      {mode === "reading" ? (
        <ReadingView data={data} edition={primary} headings={headings} ctx={ctx} />
      ) : (
        <div className="verses">
          <ColumnHeads mode={mode} textEds={textEds} primary={primary} ctx={ctx} />
          {data.verses.map((v) => (
            <Fragment key={v.vkey}>
              {headings.get(v.vkey) && <h2 className="pericope">{headings.get(v.vkey)}</h2>}
              <VerseRow v={v} mode={mode} textEds={textEds} primary={primary} ctx={ctx} />
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
  selected: string | null;
  onSelect: (osis: string) => void;
  onWord: (strong: string) => void;
  footnotes: boolean;
  speaking: string | null;
  notes: Record<string, Note>;
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
  const heads = mode === "parallel" ? textEds.map(label) : mode === "original" ? [ctx.isNT ? "Greek (SBLGNT)" : "Hebrew (Leningrad)", label(primary)] : [];
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

function VerseRow({ v, mode, textEds, primary, ctx }: { v: ChapterVerse; mode: string; textEds: string[]; primary?: string; ctx: RowCtx }) {
  const words = v.words[ctx.wordEd] ?? [];
  const isSel = v.osis === ctx.selected;
  const cols = mode === "parallel" ? textEds.length : mode === "original" ? 2 : 1;
  return (
    <div
      className={`verse-row mode-${mode}${isSel ? " selected" : ""}${v.osis === ctx.speaking ? " speaking" : ""}${ctx.notes[v.osis]?.highlight ? ` hl-${ctx.notes[v.osis]!.highlight}` : ""}`}
      data-osis={v.osis}
      id={`v${v.verse}`}
      style={{ ["--cols" as string]: String(Math.max(cols, 1)) }}
      onClick={() => ctx.onSelect(v.osis)}
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
          <div className={`cell words ${ctx.isNT ? "greek" : "hebrew"}`} dir={ctx.isNT ? "ltr" : "rtl"}>
            {words.map((w) => (
              <WordChip key={w.pos} w={w} lang={ctx.isNT ? "grc" : "hbo"} onWord={ctx.onWord} />
            ))}
          </div>
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
    >
      {t ? (
        <>
          <span className="vtext">
            <TextWithNotes text={t.text} notes={ctx.footnotes ? t.notes : undefined} />
          </span>
          {t.native && (
            <span className="native" title={`Numbered ${t.native.replace(/^[^.]+\./, "").replace(".", ":")} in ${ed?.abbrev ?? id}`}>
              {t.native.replace(/^[^.]+\./, "").replace(".", ":")}
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

function WordChip({ w, lang, onWord }: { w: Word; lang: "grc" | "hbo"; onWord: (s: string) => void }) {
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
function HoverWord({ w, lang, onWord, children }: { w: Word; lang: "grc" | "hbo"; onWord: (s: string) => void; children: React.ReactNode }) {
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
        if (settings.hover.cards) timer.current = window.setTimeout(() => setOpen(true), settings.hover.delay);
      }}
      onMouseLeave={() => {
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setOpen(false), 120);
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (id) onWord(id);
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
          {id && <span className="wc-hint">Click for word study · {id}</span>}
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
          {p.title && <h2 className="pericope">{p.title}</h2>}
          <p>
            {p.verses.map((v) => {
              const t = edition ? v.texts[edition] : undefined;
              if (!t) return null;
              return (
                <span
                  key={v.vkey}
                  className={`rv${v.osis === ctx.selected ? " selected" : ""}${v.osis === ctx.speaking ? " speaking" : ""}${v.red_letter && ed?.language === "eng" ? " red" : ""}${ctx.notes[v.osis]?.highlight ? ` hl-${ctx.notes[v.osis]!.highlight}` : ""}`}
                  data-osis={v.osis}
                  onClick={() => ctx.onSelect(v.osis)}
                >
                  <sup className="vnum">
                    <span className="n">{v.verse === 0 ? "" : v.verse}</span>
                    <Marks marks={v.marks} />
                  </sup>
                  <TextWithNotes text={t.text} notes={ctx.footnotes ? t.notes : undefined} />{" "}
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
          {single ? "change" : "+ translation"}
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
