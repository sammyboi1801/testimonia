import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useVerse } from "../api";
import { formatYear, osisLabel, PRE_NICENE, verseUrl } from "../lib";
import { useSettings, type FathersScope } from "../settings";
import type { Book, VerseGuide } from "../types";
import { Html } from "./Html";

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

function Section({ title, count, open = false, children }: { title: string; count?: number; open?: boolean; children: ReactNode }) {
  return (
    <details className="section" open={open}>
      <summary>
        {title}
        {count !== undefined && <span className="count">{count}</span>}
      </summary>
      <div className="section-body">{children}</div>
    </details>
  );
}

export function PassageGuide({ osis, books, onWord }: { osis: string; books: Book[]; onWord: (s: string) => void }) {
  const { data, isLoading, error } = useVerse(osis);
  if (isLoading) return <div className="loading">Loading {osisLabel(osis, books)}…</div>;
  if (error || !data) return <div className="error">Could not load {osis}: {String(error)}</div>;
  return <GuideBody g={data} books={books} onWord={onWord} />;
}

function GuideBody({ g, books, onWord }: { g: VerseGuide; books: Book[]; onWord: (s: string) => void }) {
  const { settings, update } = useSettings();
  const scope = settings.fathers;
  const fathers = useMemo(() => g.fathers.filter((f) => inScope(f.year, f.era, scope)), [g.fathers, scope]);
  const commentary = useMemo(() => g.commentary.filter((c) => inScope(c.year, c.era, scope)), [g.commentary, scope]);
  const [xrefLimit, setXrefLimit] = useState(12);
  const nt = g.words.tagnt?.length ? "tagnt" : "tahot";
  const words = g.words[nt] ?? [];
  const quotes = g.quotations.filter((q) => q.direction === "quotes");
  const quotedBy = g.quotations.filter((q) => q.direction === "quoted_by");
  const era = g.periods.find((p) => !p.parent_id)?.name;
  const period = g.periods.find((p) => p.parent_id)?.name;

  return (
    <div className="guide-inner">
      <h2>{osisLabel(g.verse.osis, books)}</h2>
      <div className="sub">
        {g.heading && <span>{g.heading.title}</span>}
        {g.chronology?.label && <span> · {g.chronology.label}</span>}
      </div>
      {(era || period) && (
        <div>
          {era && <span className="pill">{era}</span>}
          {period && <span className="pill">{period}</span>}
        </div>
      )}

      <Section title="Words" count={words.length} open>
        <table className="word-table">
          <tbody>
            {words.map((w) => (
              <tr key={w.pos} onClick={() => w.lemma_id && onWord(w.lemma_id)}>
                <td className={nt === "tagnt" ? "greek" : "hebrew"} style={{ fontSize: 17 }} dir={nt === "tahot" ? "rtl" : undefined}>
                  {w.surface}
                </td>
                <td>
                  <div>{w.gloss}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {w.lemma} {w.translit ? `· ${w.translit}` : ""} · {w.morph}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Variants" count={g.variants.length} open={g.variants.some((v) => v.significance === "meaning")}>
        {g.variants.length === 0 && <div className="muted">No differences recorded between the editions for this verse.</div>}
        {g.variants.map((v) => (
          <div key={v.id} className="item">
            <span className={`pill${v.significance === "meaning" ? " rubric" : ""}`}>{v.significance}</span>
            {v.readings.map((r) => (
              <div key={r.n} className="reading">
                <span className={`r-text${nt === "tahot" ? " hebrew" : ""}`}>{r.text || "—omit—"}</span>
                {r.gloss && <span>“{r.gloss}”</span>}
                <span className="r-wit">{formatWitnesses(r.witnesses)}</span>
              </div>
            ))}
            {v.note && <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>{v.note}</div>}
          </div>
        ))}
      </Section>

      <Section title="Church fathers" count={fathers.length} open={fathers.length > 0}>
        <div className="seg">
          {SCOPES.map((s) => (
            <button key={s.id} className={scope === s.id ? "on" : ""} onClick={() => update({ fathers: s.id })}>
              {s.label}
            </button>
          ))}
        </div>
        {fathers.length === 0 && <div className="muted">No citations of this verse in this period.</div>}
        {fathers.slice(0, 80).map((f, i) => (
          <div key={`${f.work_id}-${f.cite}-${i}`} className="item">
            <div className="item-head">
              <span className="who">
                {f.author ?? "Anonymous"} ·{" "}
                {f.edition_id && f.section_ord ? (
                  <Link to={`/library/${encodeURIComponent(f.edition_id)}/${f.section_ord}`}>
                    {f.work_title} {f.cite}
                  </Link>
                ) : (
                  f.work_title
                )}
              </span>
              <span className="when">
                {f.times > 1 && <span className="pill">{f.times}×</span>}
                {formatYear(f.year)}
              </span>
            </div>
            {f.snippet && <div className="text">{f.snippet}</div>}
          </div>
        ))}
      </Section>

      <Section title="Commentary" count={commentary.length}>
        {commentary.length === 0 && <div className="muted">No commentary in this period — try “All”.</div>}
        {commentary.slice(0, 40).map((c) => (
          <div key={c.id} className="item">
            <div className="item-head">
              <span className="who">{c.author}</span>
              <span className="when">{formatYear(c.year)}</span>
            </div>
            {c.work_title && <div className="muted" style={{ fontSize: 12 }}>{c.work_title}</div>}
            <Html html={c.html} className="quote" onWord={onWord} />
          </div>
        ))}
      </Section>

      <Section title="Old ↔ New Testament" count={g.quotations.length} open={g.quotations.length > 0}>
        {g.quotations.length === 0 && <div className="muted">No quotation links for this verse.</div>}
        {quotes.length > 0 && <div className="muted">This verse quotes:</div>}
        {quotes.map((q) => (
          <RefItem key={`q${q.other}`} osis={q.osis} books={books} text={q.text} tag={q.via ?? undefined} />
        ))}
        {quotedBy.length > 0 && <div className="muted">Quoted in:</div>}
        {quotedBy.map((q) => (
          <RefItem key={`b${q.other}`} osis={q.osis} books={books} text={q.text} />
        ))}
      </Section>

      <Section title="Cross references" count={g.crossrefs.length}>
        {g.crossrefs.slice(0, xrefLimit).map((x) => (
          <RefItem key={`${x.dst_start}-${x.source_id}`} osis={x.osis} books={books} text={x.text} tag={x.votes ? `${x.votes} votes` : x.source_id} />
        ))}
        {g.crossrefs.length > xrefLimit && (
          <button className="more" onClick={() => setXrefLimit(xrefLimit + 20)}>
            Show more ({g.crossrefs.length - xrefLimit})
          </button>
        )}
      </Section>

      <Section title="Treasury of Scripture Knowledge" count={g.notes.length}>
        {g.notes.map((n) => (
          <Html key={n.n} html={n.body} className="item" onWord={onWord} />
        ))}
      </Section>

      <Section title="Topics" count={g.topics.length}>
        {g.topics.map((t) => (
          <Link key={t.id} className="pill" to={`/search?q=${encodeURIComponent(t.name)}`}>
            {t.name}
          </Link>
        ))}
      </Section>

      <Section title="Translations" count={g.texts.length}>
        {g.texts.map((t) => (
          <div key={t.edition_id} className="item">
            <div className="item-head">
              <span className="who">{t.abbrev ?? t.edition_id}</span>
              {t.native_ref && <span className="when">{t.native_ref}</span>}
            </div>
            <div className={`text${t.language === "hbo" ? " hebrew" : ""}`} dir={t.script_dir === "rtl" ? "rtl" : undefined}>
              {t.text}
            </div>
          </div>
        ))}
      </Section>
    </div>
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

function formatWitnesses(w: string | null): string {
  if (!w) return "";
  return w
    .split(" ")
    .map((x) => {
      const [, id, qual] = x.split(":");
      const name = (id ?? "").replace(/^GA:/, "").replace(/^HEB:/, "");
      return qual ? `${name} (${qual})` : name;
    })
    .join(", ");
}
