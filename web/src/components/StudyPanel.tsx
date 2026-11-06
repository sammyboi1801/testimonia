import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useVerse } from "../api";
import { formatYear, osisLabel, PRE_NICENE, verseUrl } from "../lib";
import { useSettings, type FathersScope, type MarkKind, type PanelTab } from "../settings";
import type { Book, VerseGuide } from "../types";
import { openAsk } from "./AskDrawer";
import { CompareTranslations } from "./CompareTranslations";
import { GospelParallels } from "./ReadingLinks";
import { NOTE_KIND } from "./Footnotes";
import { Html } from "./Html";
import { VerseManuscripts } from "./Manuscripts";
import { VerseTranscriptions } from "./Transcription";
import { VerseEntities } from "./VerseEntities";
import { VerseNote } from "./VerseNote";
import { Mark } from "./Marks";
import { PassageLink } from "./PassageLink";
import { Speak } from "./Speak";
import { WordStudy } from "./WordStudy";

export type Tab = PanelTab;
const TABS: { id: Tab; label: string }[] = [
  { id: "text", label: "Text" },
  { id: "fathers", label: "Fathers" },
  { id: "links", label: "Links" },
  { id: "words", label: "Words" },
];
const SCOPES: { id: FathersScope; label: string }[] = [
  { id: "pre-nicene", label: "Pre-Nicene" },
  { id: "to-451", label: "to 451" },
  { id: "all", label: "All" },
];

function inScope(year: number | null, era: string | null, scope: FathersScope): boolean {
  if (scope === "all") return true;
  if (scope === "pre-nicene") return era ? PRE_NICENE.has(era) : year !== null && year <= 325;
  return year !== null ? year <= 451 : era ? PRE_NICENE.has(era) || era === "nicene" : false;
}

interface Props {
  osis: string;
  books: Book[];
  tab: Tab;
  word: string | null;
  onTab: (t: Tab) => void;
  onWord: (strong: string) => void;
  onCloseWord: () => void;
}

export function StudyPanel(props: Props) {
  const { data, isLoading, error } = useVerse(props.osis);
  if (isLoading) return <div className="loading">Loading {osisLabel(props.osis, props.books)}…</div>;
  if (error || !data) return <div className="error">Could not load {props.osis}: {String(error)}</div>;
  return <Panel g={data} {...props} />;
}

function Panel({ g, books, tab, word, onTab, onWord, onCloseWord }: Props & { g: VerseGuide }) {
  const { settings } = useSettings();
  const scope = settings.fathers;
  const fathers = useMemo(() => g.fathers.filter((f) => inScope(f.year, f.era, scope)), [g.fathers, scope]);
  const commentary = useMemo(() => g.commentary.filter((c) => inScope(c.year, c.era, scope)), [g.commentary, scope]);
  const preNicene = g.fathers.filter((f) => inScope(f.year, f.era, "pre-nicene")).length;
  // meaning changes first, so the glance row names the variant that matters most (θεὸς / υἱός, not ὁ / —)
  const major = g.variants
    .filter((v) => v.significance in RANK)
    .sort((a, b) => (RANK[a.significance] ?? 9) - (RANK[b.significance] ?? 9));
  const era = g.periods.find((p) => !p.parent_id)?.name;
  const period = g.periods.find((p) => p.parent_id)?.name;
  const quotes = g.quotations;
  const active: Tab = word ? "words" : tab;

  return (
    <div className="guide-inner">
      <header className="panel-head">
        <h2>{osisLabel(g.verse.osis, books)}</h2>
        <div className="sub">
          {g.heading?.title}
          {g.chronology?.label && <span> · {g.chronology.label}</span>}
          {era && <span> · {era}</span>}
          {period && <span className="muted"> — {period}</span>}
        </div>
        <PassageLink osis={g.verse.osis} title={g.heading?.title} />
      </header>
      <VerseNote osis={g.verse.osis} label={osisLabel(g.verse.osis, books)} />

      {settings.panel.glance && (
      <div className="glance">
        <GlanceRow kind="var" on={major.length > 0} onClick={() => onTab("text")}>
          {major.length ? (
            <>
              {major.length} significant variant{major.length > 1 ? "s" : ""}:{" "}
              <span className="greek">{major[0]!.label}</span>
            </>
          ) : g.variants.length ? (
            `${g.variants.length} minor edition difference${g.variants.length > 1 ? "s" : ""}`
          ) : (
            "The printed editions agree here"
          )}
        </GlanceRow>
        <GlanceRow kind="fat" on={preNicene > 0} onClick={() => onTab("fathers")}>
          {preNicene} pre-Nicene citation{preNicene === 1 ? "" : "s"} · {g.fathers.length} in all ·{" "}
          {g.commentary.length} comments
        </GlanceRow>
        <GlanceRow kind="quo" on={quotes.length > 0} onClick={() => onTab("links")}>
          {quotes.length ? `${quotes.length} Old ↔ New Testament link${quotes.length > 1 ? "s" : ""}` : "No OT ↔ NT quotation"} ·{" "}
          {g.crossrefs.length} cross references
        </GlanceRow>
      </div>
      )}

      <nav className="tabs panel-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={active === t.id} className={active === t.id ? "on" : ""} onClick={() => (t.id === "words" && word ? undefined : onTab(t.id))}>
            {t.label}
            <span className="count">{tabCount(t.id, g, fathers.length)}</span>
          </button>
        ))}
      </nav>

      {active === "text" && <TextTab g={g} />}
      {active === "fathers" && <FathersTab fathers={fathers} commentary={commentary} onWord={onWord} />}
      {active === "links" && <LinksTab g={g} books={books} onWord={onWord} />}
      {active === "words" &&
        (word ? <WordStudy strong={word} books={books} onBack={onCloseWord} onWord={onWord} /> : <WordsTab g={g} onWord={onWord} />)}
    </div>
  );
}

function tabCount(t: Tab, g: VerseGuide, fathers: number): string {
  if (t === "text") return String(g.variants.length);
  if (t === "fathers") return String(fathers);
  if (t === "links") return String(g.quotations.length + g.crossrefs.length + (g.witnesses?.length ?? 0));
  const w = g.words.tagnt?.length ? g.words.tagnt : g.words.tahot;
  return String(w?.length ?? 0);
}

const RANK: Record<string, number> = { meaning: 0, "ketiv-qere": 1, omission: 2 };

function GlanceRow({ kind, on, onClick, children }: { kind: MarkKind; on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button className={`glance-row${on ? " on" : ""}`} onClick={onClick}>
      <Mark kind={kind} minor={!on} />
      <span>{children}</span>
    </button>
  );
}

function Block({ title, children, note }: { title: string; children: ReactNode; note?: ReactNode }) {
  return (
    <section className="block">
      <h3>
        {title} {note && <span className="count">{note}</span>}
      </h3>
      {children}
    </section>
  );
}

// ----------------------------------------------------------------------------- tabs

function TextTab({ g }: { g: VerseGuide }) {
  const hebrew = !g.words.tagnt?.length;
  return (
    <>
      <Block title="Variants" note={g.variants.length}>
        {g.variants.length === 0 && <p className="muted">No differences recorded between the editions for this verse.</p>}
        {g.variants.map((v) => (
          <Variant key={v.id} v={v} hebrew={hebrew} />
        ))}
      </Block>
      <VerseTranscriptions key={g.verse.osis} osis={g.verse.osis} />
      {(g.footnotes?.length ?? 0) > 0 && <TranslatorsNotes notes={g.footnotes!} texts={g.texts} osis={g.verse.osis} />}
      <VerseManuscripts osis={g.verse.osis} />
      <CompareTranslations texts={g.texts} osis={g.verse.osis} />
    </>
  );
}

function FathersTab({ fathers, commentary, onWord }: { fathers: VerseGuide["fathers"]; commentary: VerseGuide["commentary"]; onWord: (s: string) => void }) {
  const { settings, update } = useSettings();
  const [more, setMore] = useState(40);
  return (
    <>
      <div className="seg">
        {SCOPES.map((s) => (
          <button key={s.id} className={settings.fathers === s.id ? "on" : ""} onClick={() => update({ fathers: s.id })}>
            {s.label}
          </button>
        ))}
      </div>
      <Block title="Cited by" note={fathers.length}>
        {fathers.length === 0 && <p className="muted">No citations of this verse in this period — try “All”.</p>}
        {fathers.slice(0, more).map((f, i) => (
          <div key={`${f.work_id}-${f.cite}-${i}`} className="item">
            <div className="item-head">
              <span className="who">
                {f.author ?? "Anonymous"},{" "}
                {f.edition_id && f.section_ord ? (
                  <Link to={`/library/${encodeURIComponent(f.edition_id)}/${f.section_ord}`}>
                    <i>{f.work_title}</i> {f.cite}
                  </Link>
                ) : (
                  <i>{f.work_title}</i>
                )}
              </span>
              <span className="when">
                {f.times > 1 && <span className="tag">{f.times}×</span>} {formatYear(f.year)}
              </span>
            </div>
            {f.snippet && <div className="text">{f.snippet}</div>}
          </div>
        ))}
        {fathers.length > more && (
          <button className="more" onClick={() => setMore(more + 60)}>
            Show more ({fathers.length - more})
          </button>
        )}
      </Block>
      <Block title="Commentary" note={commentary.length}>
        {commentary.slice(0, 30).map((c) => (
          <div key={c.id} className="item">
            <div className="item-head">
              <span className="who">{c.author}</span>
              <span className="when">{formatYear(c.year)}</span>
            </div>
            {c.work_title && <div className="muted small">{c.work_title}</div>}
            <Html html={c.html} className="quote" onWord={onWord} />
          </div>
        ))}
      </Block>
    </>
  );
}

function LinksTab({ g, books, onWord }: { g: VerseGuide; books: Book[]; onWord: (s: string) => void }) {
  const [limit, setLimit] = useState(12);
  const quotes = g.quotations.filter((q) => q.direction === "quotes");
  const quotedBy = g.quotations.filter((q) => q.direction === "quoted_by");
  return (
    <>
      <GospelParallels osis={g.verse.osis} />
      <VerseEntities osis={g.verse.osis} />
      {(quotes.length > 0 || quotedBy.length > 0) && (
        <Block title="Old ↔ New Testament" note={g.quotations.length}>
          {quotes.length > 0 && <p className="muted small">This verse quotes</p>}
          {quotes.map((q) => (
            <RefItem key={`q${q.other}`} osis={q.osis} books={books} text={q.text} tag={q.via ? `via ${q.via}` : undefined} />
          ))}
          {quotedBy.length > 0 && <p className="muted small">Quoted in</p>}
          {quotedBy.map((q) => (
            <RefItem key={`b${q.other}`} osis={q.osis} books={books} text={q.text} />
          ))}
        </Block>
      )}
      {(g.witnesses?.length ?? 0) > 0 && (
        <Block title="Jewish & Roman writers" note={g.witnesses!.length}>
          {g.witnesses!.map((w, i) => (
            <div key={`${w.work_id}-${w.cite}-${i}`} className="item">
              <div className="item-head">
                <strong>{w.author}</strong>
                {w.edition_id && w.section_ord ? (
                  <Link to={`/library/${encodeURIComponent(w.edition_id)}/${w.section_ord}`}>
                    <i>{w.work_title}</i> {w.cite}
                  </Link>
                ) : (
                  <span>
                    <i>{w.work_title}</i> {w.cite}
                  </span>
                )}
                {w.kind === "comment" && <span className="tag">translator's note</span>}
              </div>
              {w.snippet && <p className="note-text">{w.snippet}</p>}
            </div>
          ))}
        </Block>
      )}
      <Block title="Cross references" note={g.crossrefs.length}>
        {g.crossrefs.slice(0, limit).map((x) => (
          <RefItem key={`${x.dst_start}-${x.source_id}`} osis={x.osis} books={books} text={x.text} tag={x.votes ? `${x.votes} votes` : undefined} />
        ))}
        {g.crossrefs.length > limit && (
          <button className="more" onClick={() => setLimit(limit + 20)}>
            Show more ({g.crossrefs.length - limit})
          </button>
        )}
      </Block>
      {g.notes.length > 0 && (
        <Block title="Treasury of Scripture Knowledge" note={g.notes.length}>
          {g.notes.map((n) => (
            <Html key={n.n} html={n.body} className="item tsk" onWord={onWord} />
          ))}
        </Block>
      )}
      {g.topics.length > 0 && (
        <Block title="Topics" note={g.topics.length}>
          <div className="topic-list">
            {g.topics.map((t) => (
              <Link key={t.id} to={`/topic/${encodeURIComponent(t.id)}`}>
                {t.name}
              </Link>
            ))}
          </div>
        </Block>
      )}
    </>
  );
}

function WordsTab({ g, onWord }: { g: VerseGuide; onWord: (s: string) => void }) {
  const nt = !!g.words.tagnt?.length;
  const words = (nt ? g.words.tagnt : g.words.tahot) ?? [];
  const lang = nt ? "grc" : "hbo";
  return (
    <>
      <div className="listen-verse">
        <Speak text={words.map((w) => w.surface).join(" ")} lang={lang} label={`Listen to the ${nt ? "Greek" : "Hebrew"} (modern voice)`} />
      </div>
      <table className="word-table">
        <tbody>
          {words.map((w) => (
            <tr key={w.pos} onClick={() => w.lemma_id && onWord(w.lemma_id)}>
              <td className={nt ? "greek" : "hebrew"} dir={nt ? undefined : "rtl"}>
                <span className="wt-surface">{w.surface}</span>
              </td>
              <td>
                <div className="wt-gloss">{w.gloss}</div>
                <div className="muted small">
                  {w.lemma} {w.translit ? `· ${w.translit}` : ""} · {w.morph}
                </div>
              </td>
              <td className="wt-speak">
                <Speak text={w.surface} lang={lang} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function RefItem({ osis, books, text, tag }: { osis: string; books: Book[]; text: string | null; tag?: string }) {
  return (
    <div className="item">
      <div className="item-head">
        <Link to={verseUrl(osis)} className="who">
          {osisLabel(osis, books)}
        </Link>
        {tag && <span className="when">{tag}</span>}
      </div>
      {text && <div className="text">{text}</div>}
    </div>
  );
}

// ----------------------------------------------------------------------------- variants & translators' notes

const VARIANT_KIND: Record<string, [string, string]> = {
  meaning: ["Different wording", "the editions print different words here"],
  omission: ["Omission", "some editions leave this out"],
  order: ["Word order", "the same word, in another position"],
  spelling: ["Spelling", "the same word spelled differently; meaning unchanged"],
  "ketiv-qere": ["Written / read", "the written text (ketiv) is read aloud differently (qere)"],
};

const EDITION_NAME: Record<string, string> = {
  NA28: "Nestle–Aland, 28th edition (2012)",
  NA27: "Nestle–Aland, 27th edition (1993)",
  SBL: "SBL Greek New Testament (2010)",
  WH: "Westcott & Hort (1881)",
  Treg: "Tregelles (1857–79)",
  Tyn: "Tyndale House Greek New Testament (2017)",
  TR: "Textus Receptus (Stephanus 1550 / Scrivener)",
  Byz: "Byzantine text (Robinson–Pierpont)",
  L: "Leningrad Codex",
};

const stripPunct = (t: string) => t.replace(/[.,·;:]+$/u, "");

/** Mark the letters where `text` differs from `other` (common prefix and suffix left plain). */
function DiffText({ text, other }: { text: string; other: string }) {
  const a = [...text];
  const b = [...other];
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let q = 0;
  while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
  const mid = a.slice(p, a.length - q).join("");
  if (!mid) return <>{text}</>;
  return (
    <>
      {a.slice(0, p).join("")}
      <mark className="vdiff">{mid}</mark>
      {a.slice(a.length - q).join("")}
    </>
  );
}

function Sigla({ witnesses }: { witnesses: string | null }) {
  const list = formatWitnesses(witnesses).split(" · ").filter(Boolean);
  return (
    <span className="r-wit">
      {list.map((w, i) => (
        <span key={w}>
          {i > 0 && " · "}
          <abbr title={EDITION_NAME[w] ?? (/^\d/.test(w) ? `Manuscript ${w}` : w)}>{w}</abbr>
        </span>
      ))}
    </span>
  );
}

export function Variant({ v, hebrew }: { v: VerseGuide["variants"][number]; hebrew: boolean }) {
  const [label, explain] = VARIANT_KIND[v.significance] ?? [v.significance, ""];
  const strong = ["meaning", "omission", "ketiv-qere"].includes(v.significance);
  const showGloss = v.significance === "meaning" || v.significance === "ketiv-qere";
  const texts = v.readings.map((r) => stripPunct(r.text));
  return (
    <div className="item variant">
      <div className="v-head">
        <span className={`v-kind${strong ? " strong" : ""}`}>{label}</span>
        {explain && <span className="muted"> · {explain}</span>}
      </div>
      <div className="v-readings">
        {v.readings.map((r, i) => (
          <div key={r.n} className="v-reading">
            <span className={`r-text ${hebrew ? "hebrew" : "greek"}`}>
              {!texts[i] ? (
                <span className="muted">— omitted —</span>
              ) : v.significance === "spelling" ? (
                <DiffText text={texts[i]} other={texts[i === 0 ? 1 : 0] ?? ""} />
              ) : (
                texts[i]
              )}
              {showGloss && r.gloss && <span className="r-gloss"> “{r.gloss}”</span>}
            </span>
            <Sigla witnesses={r.witnesses} />
          </div>
        ))}
      </div>
      {v.note && <p className="note-text">{v.note}</p>}
    </div>
  );
}

const LANGUAGE: Record<string, string> = { lat: "Latin", grc: "Greek", hbo: "Hebrew", deu: "German", fra: "French" };

type VerseFootnote = NonNullable<VerseGuide["footnotes"]>[number];

function TranslatorsNotes({ notes, texts, osis }: { notes: VerseFootnote[]; texts: VerseGuide["texts"]; osis: string }) {
  const lang = Object.fromEntries(texts.map((t) => [t.edition_id, t.language]));
  const languageOf = (f: VerseFootnote) => lang[f.edition_id] ?? "eng";
  const main = notes.filter((f) => languageOf(f) === "eng");
  const other = notes.filter((f) => languageOf(f) !== "eng");
  const otherLangs = [...new Set(other.map((f) => LANGUAGE[languageOf(f)] ?? languageOf(f)))].join(", ");
  return (
    <Block title="Translators' notes" note={notes.length}>
      {main.map((f) => (
        <FootnoteItem key={`${f.edition_id}-${f.n}`} f={f} />
      ))}
      {other.length > 0 && (
        <details className="fn-other">
          <summary>
            {other.length} {otherLangs} note{other.length > 1 ? "s" : ""}
          </summary>
          {other.map((f) => (
            <FootnoteItem key={`${f.edition_id}-${f.n}`} f={f} translate={{ osis, language: LANGUAGE[languageOf(f)] ?? languageOf(f) }} />
          ))}
        </details>
      )}
    </Block>
  );
}

function FootnoteItem({ f, translate }: { f: VerseFootnote; translate?: { osis: string; language: string } }) {
  const [open, setOpen] = useState(false);
  const plain = f.body.replace(/<[^>]+>/g, "");
  const long = plain.length > 260;
  const kind = f.kind && f.kind !== "note" ? (NOTE_KIND[f.kind] ?? f.kind) : null;
  return (
    <div className="fn-item">
      <div className="fn-head">
        <span className="who">{f.abbrev ?? f.edition_id}</span>
        {f.anchor && <span className="fn-anchor">at “…{f.anchor.split(" ").slice(-3).join(" ")}”</span>}
      </div>
      <div className={`fn-body-wrap${long && !open ? " clamped" : ""}`}>
        {kind && <span className={`fn-kind fn-${f.kind}`}>{kind}</span>}
        <Html html={f.body} className="fn-text" />
      </div>
      <div className="fn-actions">
        {long && (
          <button className="link-btn" onClick={() => setOpen((o) => !o)}>
            {open ? "Show less" : "Show all"}
          </button>
        )}
        {translate && (
          <button
            className="link-btn"
            onClick={() =>
              openAsk(
                translate.osis,
                `Translate this ${translate.language} note from the ${f.abbrev ?? f.edition_id} on ${osisLabel(translate.osis)} into English, then explain briefly what it says about the verse:\n\n${plain}`,
              )
            }
          >
            ✦ Translate
          </button>
        )}
      </div>
    </div>
  );
}

function formatWitnesses(w: string | null): string {
  if (!w) return "";
  return w
    .split(" ")
    .map((x) => {
      const [, id, qual] = x.split(":");
      const name = (id ?? "").replace(/^GA:/, "").replace(/^HEB:/, "");
      return qual ? `${name} (${qual})` : name;
    })
    .join(" · ");
}
