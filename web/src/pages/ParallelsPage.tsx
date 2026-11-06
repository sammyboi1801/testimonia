import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useMeta } from "../api";
import { verseUrl } from "../lib";
import {
  GOSPELS,
  parallelUrl,
  preferredTranslation,
  sharedWords,
  tokens,
  useParallel,
  useParallels,
  type ParallelSection,
  type ParallelVerse,
  type SynopsisSection,
} from "../readingApi";
import { useSettings } from "../settings";

type Order = "harmony" | "Matt" | "Mark" | "Luke" | "John";
const ORDERS: { id: Order; label: string }[] = [{ id: "harmony", label: "Harmony" }, ...GOSPELS.map((g) => ({ id: g.osis as Order, label: g.name }))];

const CREDIT =
  "Sections follow the pericopes and parallels of the Bruhman Translator's Bible (CC BY-SA 4.0); word agreement in the Greek is from the UBS Parallel Passage Database, © 2023 United Bible Societies (CC BY-SA 4.0).";

/** The synopsis: every section with its passage in each Gospel. */
export function ParallelsPage() {
  const { data, isLoading, error } = useParallels();
  const [params, setParams] = useSearchParams();
  const raw = params.get("order");
  const order: Order = ORDERS.some((o) => o.id === raw) ? (raw as Order) : "harmony";
  const [q, setQ] = useState("");
  const sections = useMemo(() => {
    let list = data?.sections ?? [];
    if (order !== "harmony") {
      const first = (s: SynopsisSection) => s.passages[order]?.[0]?.osis ?? "";
      const key = (s: SynopsisSection) => first(s).split(".").slice(1).map(Number);
      list = list.filter((s) => s.passages[order]?.length).sort((a, b) => cmp(key(a), key(b)));
    }
    const needle = q.trim().toLowerCase();
    return needle ? list.filter((s) => s.title.toLowerCase().includes(needle)) : list;
  }, [data, order, q]);

  return (
    <div className="page rd-page">
      <header className="rd-head">
        <h1>Gospel parallels</h1>
        <p className="rd-lede">
          The same event or saying as Matthew, Mark, Luke and John tell it, side by side, with the words each Gospel has on its own marked.
        </p>
        <div className="rd-toolbar">
          <div className="seg" role="tablist" aria-label="Order">
            {ORDERS.map((o) => (
              <button
                key={o.id}
                className={order === o.id ? "on" : ""}
                onClick={() => setParams(o.id === "harmony" ? {} : { order: o.id }, { replace: true })}
                title={o.id === "harmony" ? "In the order of the BTB chronology" : `In ${o.label}'s order (sections ${o.label} has)`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <input className="rd-filter small-filter" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a section" aria-label="Find a section" />
        </div>
      </header>
      {isLoading && <div className="loading">Loading…</div>}
      {error && <div className="error">{String(error)}</div>}
      {data && sections.length === 0 && <div className="empty-state">No sections{q ? ` match “${q}”` : ""}.</div>}
      {sections.length > 0 && (
        <table className="rd-syn-table">
          <thead>
            <tr>
              <th className="n" aria-label="Number" />
              <th>Section</th>
              {GOSPELS.map((g) => (
                <th key={g.osis} className="ref">
                  {g.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sections.map((s) => (
              <tr key={s.id}>
                <td className="n muted small">{s.n}</td>
                <td className="title">
                  <Link to={parallelUrl(s.id)}>{s.title}</Link>
                </td>
                {GOSPELS.map((g) => (
                  <td key={g.osis} className="ref small" data-g={g.short}>
                    {(s.passages[g.osis] ?? []).map((p) => (
                      <div key={p.osis}>{p.label.replace(/^\S+\s/, "")}</div>
                    ))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted small rd-credit">{CREDIT}</p>
    </div>
  );
}

function cmp(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
}

const PHONE = "(max-width: 760px)";

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(PHONE).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(PHONE);
    if (!mq) return;
    const on = () => {
      setNarrow(mq.matches);
    };
    mq.addEventListener("change", on);
    return () => {
      mq.removeEventListener("change", on);
    };
  }, []);
  return narrow;
}

/** One section: the Gospels in columns (two at a time on a phone), in a translation or in Greek. */
export function ParallelPage() {
  const { id = "" } = useParams();
  const { settings } = useSettings();
  const meta = useMeta();
  const [edition, setEdition] = useState(() => preferredTranslation(settings.editions));
  // the Greek view is part of the address, so a link can open a section in Greek
  const [params, setParams] = useSearchParams();
  const greek = params.get("text") === "greek";
  const setGreek = (on: boolean) => setParams(on ? { text: "greek" } : {}, { replace: true });
  const [marks, setMarks] = useState(true);
  const { data, isLoading, error } = useParallel(id, edition);
  const narrow = useNarrow();
  const [pair, setPair] = useState<string[]>([]);
  const translations = (meta.data?.editions ?? []).filter((e) => e.language === "eng" && e.kind === "translation" && e.testament !== "OT");

  if (isLoading && !data) return <div className="loading">Loading…</div>;
  if (error || !data) return <div className="error">Could not load this section: {String(error)}</div>;

  const all = data.columns.map((c) => c.gospel);
  const chosen = pair.filter((g) => all.includes(g));
  const phonePair = [...chosen, ...all.filter((g) => !chosen.includes(g))].slice(0, 2);
  const visible = narrow ? data.columns.filter((c) => phonePair.includes(c.gospel)) : data.columns;
  function choose(g: string) {
    // on a phone two Gospels show at once: tapping a third replaces the one chosen longest ago
    const current = phonePair.includes(g) ? phonePair : [phonePair[1] ?? phonePair[0]!, g];
    setPair(phonePair.includes(g) ? current : current.filter(Boolean));
  }

  return (
    <div className="page rd-page rd-syn-page">
      <nav className="rd-syn-nav">
        <Link to="/parallels" className="rd-back">
          ← All sections
        </Link>
        <span className="rd-syn-pager">
          {data.prev ? (
            <Link to={parallelUrl(data.prev.id)} title={data.prev.title}>
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="muted small">
            {data.n} of {data.total}
          </span>
          {data.next ? (
            <Link to={parallelUrl(data.next.id)} title={data.next.title}>
              Next →
            </Link>
          ) : (
            <span />
          )}
        </span>
      </nav>
      <header className="rd-head">
        <h1>{data.title}</h1>
        <div className="rd-toolbar">
          <div className="seg" role="tablist" aria-label="Text">
            <button className={!greek ? "on" : ""} onClick={() => setGreek(false)}>
              English
            </button>
            <button className={greek ? "on" : ""} onClick={() => setGreek(true)}>
              Greek
            </button>
          </div>
          {!greek && translations.length > 0 && (
            <select className="design-select rd-select" value={edition} onChange={(e) => setEdition(e.target.value)} aria-label="Translation">
              {translations.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.abbrev ?? e.id} — {e.title}
                </option>
              ))}
            </select>
          )}
          <label className="toggle">
            <input type="checkbox" checked={marks} onChange={(e) => setMarks(e.target.checked)} /> Mark differences
          </label>
        </div>
        {narrow && all.length > 2 && (
          <div className="rd-pair" role="group" aria-label="Gospels to compare">
            {data.columns.map((c) => (
              <button key={c.gospel} className={phonePair.includes(c.gospel) ? "on" : ""} onClick={() => choose(c.gospel)}>
                {c.name}
              </button>
            ))}
          </div>
        )}
        {marks && <Legend greek={greek} />}
      </header>
      <Synopsis columns={visible} greek={greek} marks={marks} />
      <p className="muted small rd-credit">{CREDIT}</p>
    </div>
  );
}

function Legend({ greek }: { greek: boolean }) {
  return (
    <p className="rd-legend small muted">
      <span className="syn-own">highlighted</span> words are in this Gospel only
      {greek ? (
        <>
          ; <span className="syn-part">underlined</span> words are partly shared (another form of the word)
        </>
      ) : (
        " (compared word by word with the other columns)"
      )}
      .
    </p>
  );
}

type Column = ParallelSection["columns"][number];

function Synopsis({ columns, greek, marks }: { columns: Column[]; greek: boolean; marks: boolean }) {
  // the comparison runs over each column's whole text, so a word moved to the next verse still counts as shared
  const shared = useMemo(() => {
    if (!marks) return null;
    const words = columns.map((c) => c.passages.flatMap((p) => p.verses.flatMap((v) => verseWords(v, greek).map((w) => w.key))));
    return sharedWords(words);
  }, [columns, greek, marks]);

  return (
    <div className="rd-syn" style={{ ["--syn-cols" as string]: columns.length }}>
      {columns.map((c, ci) => {
        let offset = 0;
        return (
          <section key={c.gospel} className="rd-syn-col">
            <h2>{c.name}</h2>
            {c.passages.map((p) => (
              <div key={p.osis} className="rd-syn-passage">
                <Link to={verseUrl(p.osis)} className="rd-syn-ref small">
                  {p.label}
                </Link>
                <div className={greek ? "rd-syn-text greek" : "rd-syn-text"}>
                  {p.verses.map((v) => {
                    const words = verseWords(v, greek);
                    const start = offset;
                    offset += words.length;
                    return (
                      <span key={v.osis} className="rd-syn-verse">
                        <sup className="vnum">{v.verse === 1 ? `${v.chapter}:1` : v.verse}</sup>
                        {words.length === 0 && <span className="muted">— </span>}
                        {runs(
                          words.map((_, wi) => {
                            const own = marks && shared ? !shared[ci]![start + wi] : false;
                            const code = greek && marks ? v.codes?.[wi] : undefined;
                            // UBS codes, where given, are the editors' judgement; the computed comparison fills the gaps
                            return code === "0" ? "syn-own" : code === "1" ? "syn-part" : code === "2" ? "" : own ? "syn-own" : "";
                          }),
                        ).map(([cls, from, to]) => (
                          <span key={from}>
                            <span className={cls || undefined}>
                              {words.slice(from, to).map((w, i) => (
                                <span key={i} title={greek ? (v.greek[from + i]?.gloss ?? undefined) : undefined}>
                                  {i > 0 ? " " : ""}
                                  {w.word}
                                </span>
                              ))}
                            </span>{" "}
                          </span>
                        ))}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

/** Consecutive words with the same mark, as [class, from, to) — so a highlighted phrase reads as one. */
function runs(classes: string[]): [string, number, number][] {
  const out: [string, number, number][] = [];
  classes.forEach((c, i) => {
    const last = out[out.length - 1];
    if (last && last[0] === c) last[2] = i + 1;
    else out.push([c, i, i + 1]);
  });
  return out;
}

function verseWords(v: ParallelVerse, greek: boolean): { word: string; key: string }[] {
  if (greek) {
    return v.greek.map((g) => ({ word: g.surface.replace(/¶/g, ""), key: tokens(g.surface)[0]?.key ?? "" }));
  }
  return tokens(v.text ?? "");
}
