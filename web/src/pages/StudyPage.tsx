import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useQueries } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { chapterQuery, getJson, useMeta } from "../api";
import { askOnce, useAssistantState } from "../agent/ask";
import { Answer } from "../components/Chat";
import { openAsk } from "../components/AskDrawer";
import { Peek, peekable, type PeekTarget } from "../components/VersePeek";
import { VerseCard, type CardVerse } from "../components/VerseCard";
import type { VerseEntities } from "../geoApi";
import { formatYear, osisLabel, verseUrl } from "../lib";
import { useNotes, type Note } from "../notes";
import { useSettings } from "../settings";
import { studies, useStudy, type Study } from "../studies";
import { usePassage, type PassageGuide } from "../studyApi";
import { copyText, passageUrl } from "../studyLib";
import { METHODS, keyWords, listItems, repeatedWords, reviewQuestion, studyText, type AiAction, type StepDef } from "../studyMethods";

const SIGNIFICANT = new Set(["meaning", "omission", "ketiv-qere"]);

/** A Bible study, one step at a time, with the passage beside it. */
export function StudyPage() {
  const { id = "" } = useParams();
  const study = useStudy(id);
  const meta = useMeta();
  const { settings } = useSettings();
  const english = (meta.data?.editions ?? []).filter((e) => e.language === "eng").map((e) => e.id);
  const edition = settings.editions.find((e) => english.includes(e)) ?? "bsb";
  const guide = usePassage(study?.ref ?? "", edition);
  const [spot, setSpot] = useState<string | null>(null); // a word lit up in the passage
  const [textOpen, setTextOpen] = useState(false); // phones: the passage folds away after the first step

  useEffect(() => {
    if (study) document.title = `${study.label} · Bible study | Testimonia`;
  }, [study]);
  useEffect(() => {
    setSpot(null);
  }, [study?.step]);

  if (!study)
    return (
      <div className="page st-page">
        <div className="empty-state">
          This study is not here. It may have been deleted on another device. <Link to="/notes">Your studies</Link>
        </div>
      </div>
    );
  const m = METHODS[study.method];
  const steps = m.steps;
  const at = Math.min(study.step, steps.length); // steps.length: the finished page
  const go = (i: number) => {
    studies.update(study.id, { step: i });
    // the page scrolls inside .page, not the window
    document.querySelector(".st-page")?.scrollTo({ top: 0, behavior: "smooth" });
  };
  const g = guide.data;
  // phones: the passage shows on the first step and when choosing a verse from it; elsewhere it folds
  const textShown = at === 0 || steps[at]?.id === "carry" || textOpen;

  return (
    <div className="page st-page">
      <header className="st-head">
        <div className="st-eyebrow">
          <Link to="/notes#studies">Studies</Link>
          <span aria-hidden>·</span>
          <span>{m.name}</span>
        </div>
        <h1>{study.label}</h1>
        {study.title && <p className="st-sub">{study.title}</p>}
        <ol className="st-steps" aria-label="Steps">
          {steps.map((s, i) => (
            <li key={s.id} className={`${i === at ? "on" : ""}${study.done.includes(s.id) ? " done" : ""}`}>
              <button onClick={() => go(i)} aria-current={i === at ? "step" : undefined}>
                <span className="st-dot">{study.done.includes(s.id) ? "✓" : i + 1}</span>
                <span className="st-step-name">{s.title}</span>
              </button>
            </li>
          ))}
          <li className={at === steps.length ? "on" : ""}>
            <button onClick={() => go(steps.length)} aria-current={at === steps.length ? "step" : undefined}>
              <span className="st-dot">★</span>
              <span className="st-step-name">Review</span>
            </button>
          </li>
        </ol>
      </header>

      <div className="st-layout">
        <aside className={`st-text${textShown ? " open" : ""}`}>
          <button className="st-text-toggle" onClick={() => setTextOpen(!textOpen)} aria-expanded={textShown}>
            {g?.edition.abbrev ?? "Passage"} · {study.label}
            <span aria-hidden>{textShown ? "▴" : "▾"}</span>
          </button>
          <PassageText g={g} loading={guide.isLoading} error={guide.error ? String(guide.error) : null} spot={spot} carry={study.method === "devotional" && steps[at]?.id === "carry" ? study : null} />
        </aside>

        <main className="st-main">
          {at < steps.length ? (
            <StepView key={steps[at]!.id} study={study} step={steps[at]!} index={at} total={steps.length} g={g} spot={spot} onSpot={setSpot} go={go} />
          ) : (
            <Finished study={study} g={g} />
          )}
        </main>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------- the passage

function PassageText({ g, loading, error, spot, carry }: { g: PassageGuide | undefined; loading: boolean; error: string | null; spot: string | null; carry: Study | null }) {
  const { notes } = useNotes();
  if (loading) return <div className="st-skel" aria-label="Loading the passage" />;
  if (error || !g) return <p className="muted">Could not load the passage. {error}</p>;
  const starts = new Map(g.headings.map((h) => [h.osis, h.title]));
  let chapter = g.range.chapter;
  return (
    <div className="st-reading">
      {g.verses.map((v) => {
        const newCh = v.chapter !== chapter;
        chapter = v.chapter;
        const title = g.headings.length > 1 ? starts.get(v.osis) : undefined;
        const picked = carry?.carry === v.osis;
        return (
          <span key={v.vkey}>
            {title && <span className="st-pericope">{title}</span>}
            <span
              className={`st-verse${carry ? " pickable" : ""}${picked ? " picked" : ""}`}
              onClick={carry ? () => studies.update(carry.id, { carry: picked ? undefined : v.osis }) : undefined}
              role={carry ? "button" : undefined}
              aria-pressed={carry ? picked : undefined}
            >
              <sup className="st-vn">{newCh ? `${v.chapter}:${v.verse}` : v.verse}</sup>
              <Marked text={v.text ?? ""} note={notes[v.osis]} ed={g.edition.id} spot={spot} />{" "}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/** A verse with the reader's highlights, and a word lit up wherever it occurs. */
function Marked({ text, note, ed, spot }: { text: string; note: Note | undefined; ed: string; spot: string | null }) {
  const cls = new Array<string>(text.length).fill("");
  if (note?.highlight) cls.fill(`hl-${note.highlight}`);
  for (const m of note?.marks ?? []) if (m.ed === ed) for (let i = m.start; i < Math.min(m.end, text.length); i++) cls[i] = `hl-${m.color}`;
  if (spot) {
    const re = new RegExp(`\\b${spot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:['’]s)?\\b`, "gi");
    for (const x of text.matchAll(re)) for (let i = x.index!; i < x.index! + x[0].length; i++) cls[i] = `${cls[i]} st-spot`.trim();
  }
  const parts: ReactNode[] = [];
  let i = 0;
  while (i < text.length) {
    let j = i + 1;
    while (j < text.length && cls[j] === cls[i]) j++;
    parts.push(cls[i] ? <mark key={i} className={`st-mark ${cls[i]}`}>{text.slice(i, j)}</mark> : text.slice(i, j));
    i = j;
  }
  return <>{parts}</>;
}

// ----------------------------------------------------------------------------- one step

function StepView({ study, step, index, total, g, spot, onSpot, go }: { study: Study; step: StepDef; index: number; total: number; g: PassageGuide | undefined; spot: string | null; onSpot: (w: string | null) => void; go: (i: number) => void }) {
  const last = index === total - 1;
  const next = () => {
    if (!study.done.includes(step.id)) studies.update(study.id, { done: [...study.done, step.id], ...(last ? { finished: new Date().toISOString() } : {}) });
    go(index + 1);
  };
  return (
    <section className="st-card" aria-labelledby={`st-${step.id}`}>
      <div className="st-card-head">
        <span className="st-num">{index + 1}</span>
        <div>
          <h2 id={`st-${step.id}`}>{step.title}</h2>
          <p className="st-lead">{step.lead}</p>
        </div>
      </div>

      {g && <Library step={step.id} g={g} study={study} spot={spot} onSpot={onSpot} />}

      <label className="st-prompt" htmlFor={`st-a-${step.id}`}>
        {step.prompt}
      </label>
      <AnswerBox id={`st-a-${step.id}`} value={study.answers[step.id] ?? ""} placeholder={step.placeholder} onSave={(v) => studies.update(study.id, { answers: { ...study.answers, [step.id]: v } })} />

      {step.ai.length > 0 && <Helpers study={study} step={step} />}
      {step.id === "apply" && <GroupQuestions study={study} />}

      <div className="st-nav">
        {index > 0 ? (
          <button className="btn" onClick={() => go(index - 1)}>
            ← Back
          </button>
        ) : (
          <span />
        )}
        <span className="st-nav-right">
          {!study.done.includes(step.id) && !(study.answers[step.id] ?? "").trim() && (
            <button className="link-btn" onClick={() => go(index + 1)}>
              Skip
            </button>
          )}
          <button className="btn primary" onClick={next}>
            {last ? "Finish" : "Continue →"}
          </button>
        </span>
      </div>
    </section>
  );
}

/** Saves as you type (a moment after you stop), and grows with what you write. */
function AnswerBox({ id, value, placeholder, onSave }: { id: string; value: string; placeholder: string; onSave: (v: string) => void }) {
  const [text, setText] = useState(value);
  const timer = useRef<number | undefined>(undefined);
  const box = useRef<HTMLTextAreaElement>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(96, el.scrollHeight + 2)}px`;
  }, [text]);
  // another device changed it while this one is idle
  useEffect(() => {
    if (document.activeElement !== box.current) setText(value);
  }, [value]);
  const save = (v: string) => {
    window.clearTimeout(timer.current);
    if (v !== value) {
      onSave(v);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1400);
    }
  };
  return (
    <div className="st-answer">
      <textarea
        id={id}
        ref={box}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          window.clearTimeout(timer.current);
          const v = e.target.value;
          timer.current = window.setTimeout(() => save(v), 800);
        }}
        onBlur={() => save(text)}
      />
      <span className={`st-saved${saved ? " on" : ""}`} aria-live="polite">
        {saved ? "Saved" : ""}
      </span>
    </div>
  );
}

// ----------------------------------------------------------------------------- the library at each step

function Library({ step, g, study, spot, onSpot }: { step: string; g: PassageGuide; study: Study; spot: string | null; onSpot: (w: string | null) => void }) {
  if (step === "read") return <Context g={g} />;
  if (step === "observe" || (step === "reflect" && g.verses.length > 3))
    return (
      <>
        <Repeated g={g} spot={spot} onSpot={onSpot} />
        {step === "observe" && <PeoplePlaces g={g} />}
      </>
    );
  if (step === "understand")
    return (
      <>
        <KeyWords g={g} />
        <OldTestament g={g} />
        <EarlyReaders g={g} />
        <Manuscripts g={g} />
      </>
    );
  if (step === "carry") return <Carry study={study} g={g} />;
  return null;
}

function Panel({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <div className="st-lib">
      <div className="st-lib-head">
        <span>{title}</span>
        {note && <span className="st-lib-note">{note}</span>}
      </div>
      {children}
    </div>
  );
}

function Context({ g }: { g: PassageGuide }) {
  const era = g.periods.find((p) => !p.parent_id)?.name;
  const period = g.periods.find((p) => p.parent_id)?.name.replace(/^The Life of Christ: /, "");
  const facts = [era && (period ? `${era}: ${period}` : era), g.chronology?.labels.length ? g.chronology.labels.join(" → ") : null].filter(Boolean);
  if (!facts.length && !g.prev && !g.next) return null;
  return (
    <Panel title="Where it sits">
      {facts.length > 0 && <p className="st-facts">{facts.join(" · ")}</p>}
      <div className="st-around">
        {g.prev && (
          <Link to={passageUrl(g.prev.ref)} title="The section before">
            <span className="muted">Before</span> {g.prev.title}
          </Link>
        )}
        {g.next && (
          <Link to={passageUrl(g.next.ref)} title="The section after">
            <span className="muted">After</span> {g.next.title}
          </Link>
        )}
      </div>
    </Panel>
  );
}

function Repeated({ g, spot, onSpot }: { g: PassageGuide; spot: string | null; onSpot: (w: string | null) => void }) {
  const words = useMemo(() => repeatedWords(g.verses), [g.verses]);
  if (!words.length) return null;
  return (
    <Panel title="Words that repeat" note="Tap one to see it in the passage">
      <div className="st-chips">
        {words.map((w) => (
          <button key={w.word} className={`st-chip${spot === w.word ? " on" : ""}`} onClick={() => onSpot(spot === w.word ? null : w.word)} aria-pressed={spot === w.word}>
            {w.label} <span className="st-count">×{w.n}</span>
          </button>
        ))}
      </div>
    </Panel>
  );
}

function PeoplePlaces({ g }: { g: PassageGuide }) {
  const verses = g.verses.slice(0, 60);
  const results = useQueries({
    queries: verses.map((v) => ({ queryKey: ["verse-entities", v.osis], queryFn: () => getJson<VerseEntities>(`/api/verse/${v.osis}/entities`), staleTime: Infinity })),
  });
  const people = new Map<string, { name: string; n: number }>();
  const places = new Map<string, { name: string; lat: number | null }>();
  for (const r of results) {
    for (const p of r.data?.people ?? []) people.set(p.id, { name: p.name, n: (people.get(p.id)?.n ?? 0) + 1 });
    for (const p of r.data?.places ?? []) places.set(p.id, { name: p.name, lat: p.lat });
  }
  if (!people.size && !places.size) return null;
  const located = [...places.entries()].filter(([, p]) => p.lat !== null).map(([id]) => id);
  return (
    <Panel title="Who and where" note={located.length ? <Link to={`/atlas?show=${located.map(encodeURIComponent).join(",")}`}>Show on the map</Link> : undefined}>
      <div className="st-chips">
        {[...people.entries()]
          .sort((a, b) => b[1].n - a[1].n)
          .map(([id, p]) => (
            <Link key={id} className="st-chip person" to={`/person/${encodeURIComponent(id)}`}>
              {p.name}
            </Link>
          ))}
        {[...places.entries()].map(([id, p]) => (
          <Link key={id} className="st-chip place" to={`/place/${encodeURIComponent(id)}`}>
            {p.name}
          </Link>
        ))}
      </div>
    </Panel>
  );
}

function KeyWords({ g }: { g: PassageGuide }) {
  const ed = g.range.testament === "NT" ? "tagnt" : "tahot";
  const chapters = [...new Set(g.verses.map((v) => v.chapter))].slice(0, 4);
  const results = useQueries({ queries: chapters.map((c) => chapterQuery(g.range.book, c, [ed])) });
  const inRange = new Set(g.verses.map((v) => v.osis));
  const words = useMemo(
    () =>
      keyWords(
        results.flatMap((r) => (r.data?.verses ?? []).filter((v) => inRange.has(v.osis)).map((v) => ({ osis: v.osis, words: v.words[ed] ?? [] }))),
      ),
    [results.map((r) => r.dataUpdatedAt).join()], // eslint-disable-line react-hooks/exhaustive-deps
  );
  if (!words.length) return null;
  return (
    <Panel title={`Key words in the ${ed === "tagnt" ? "Greek" : "Hebrew"}`} note="Tap for a word study">
      <div className="st-words">
        {words.map((w) => (
          <Link key={w.id} className="st-word" to={verseUrl(w.first, w.id)}>
            <span className={`st-orig ${ed === "tagnt" ? "grc" : "hbo"}`}>{w.lemma}</span>
            <span className="st-gloss">{w.gloss}</span>
            <span className="st-count">×{w.n}</span>
          </Link>
        ))}
      </div>
    </Panel>
  );
}

function OldTestament({ g }: { g: PassageGuide }) {
  const books = useMeta().data?.books ?? [];
  const quotes = g.quotations.filter((q) => q.direction === "quotes").slice(0, 3);
  if (!quotes.length) return null;
  return (
    <Panel title="The Old Testament here">
      {quotes.map((q, i) => (
        <p key={i} className="st-row">
          <span className="muted">v. {q.here.split(".")[2]} quotes </span>
          <Link to={verseUrl(q.other)}>{osisLabel(q.other, books)}</Link>
          {q.text && <span className="st-quote"> “{q.text.length > 140 ? `${q.text.slice(0, 140)}…` : q.text}”</span>}
        </p>
      ))}
    </Panel>
  );
}

function EarlyReaders({ g }: { g: PassageGuide }) {
  const early = g.fathers.filter((f) => f.pre_nicene).sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999)).slice(0, 3);
  if (!early.length) return null;
  return (
    <Panel title="Early Christian readers" note={<Link to={passageUrl(g.range.ref)}>All {g.fathers.length}</Link>}>
      {early.map((w) => {
        const x = w.works.find((k) => k.snippet) ?? w.works[0];
        return (
          <div key={w.id} className="st-father">
            <div className="st-father-head">
              <strong>{w.name}</strong>
              <span className="muted">{formatYear(w.year)}</span>
            </div>
            {x?.snippet && (
              <p className="st-quote">
                “{x.snippet.length > 220 ? `${x.snippet.slice(0, 220)}…` : x.snippet}”{" "}
                {x.edition_id && x.section_ord ? (
                  <Link to={`/library/${encodeURIComponent(x.edition_id)}/${x.section_ord}`} className="st-cite">
                    {x.work_title}
                    {x.cite ? ` ${x.cite}` : ""}
                  </Link>
                ) : (
                  <span className="st-cite">{x.work_title}</span>
                )}
              </p>
            )}
          </div>
        );
      })}
    </Panel>
  );
}

function Manuscripts({ g }: { g: PassageGuide }) {
  const verses = [...new Set(g.variants.filter((v) => SIGNIFICANT.has(v.significance)).map((v) => Number(v.osis.split(".")[2])))].sort((a, b) => a - b);
  if (!verses.length) return null;
  return (
    <Panel title="Where the manuscripts differ" note={<Link to={passageUrl(g.range.ref)}>See them</Link>}>
      <p className="st-row">
        The old copies differ in wording that affects the meaning in {verses.length === 1 ? `v. ${verses[0]}` : `${verses.length} verses (vv. ${verses.join(", ")})`}.
      </p>
    </Panel>
  );
}

function Carry({ study, g }: { study: Study; g: PassageGuide }) {
  const books = useMeta().data?.books ?? [];
  const { set, get } = useNotes();
  const [card, setCard] = useState<CardVerse | null>(null);
  const v = g.verses.find((x) => x.osis === study.carry);
  if (!v)
    return (
      <div className="st-lib st-carry-empty">
        <span aria-hidden>☝</span> Tap a verse in the passage to choose it.
      </div>
    );
  const label = osisLabel(v.osis, books);
  const lit = !!get(v.osis)?.highlight;
  return (
    <div className="st-carry">
      <blockquote>“{v.text}”</blockquote>
      <div className="st-carry-ref">{label}</div>
      <div className="st-carry-actions">
        <button className="btn" onClick={() => set(v.osis, { highlight: lit ? null : "gold" })}>
          {lit ? "✓ Highlighted" : "Highlight it"}
        </button>
        <button className="btn" onClick={() => setCard({ text: v.text ?? "", label, edition: g.edition.abbrev ?? g.edition.id, url: `https://testimonia.web.app/v/${encodeURIComponent(v.osis)}` })}>
          Make an image
        </button>
      </div>
      {card && <VerseCard verse={card} onClose={() => setCard(null)} />}
    </div>
  );
}

// ----------------------------------------------------------------------------- the assistant

function Helpers({ study, step }: { study: Study; step: StepDef }) {
  const [active, setActive] = useState<AiAction | null>(null);
  const [typed, setTyped] = useState("");
  const [asking, setAsking] = useState<{ action: AiAction; question: string } | null>(null);
  const kept = study.help[step.id];
  return (
    <div className="st-ai">
      <div className="st-ai-row">
        <span className="st-ai-label">
          <Spark /> Ask the assistant
        </span>
        {step.ai.map((a) => (
          <button
            key={a.id}
            className={`st-ai-btn${active?.id === a.id ? " on" : ""}`}
            onClick={() => {
              if (a.input) {
                setActive(active?.id === a.id ? null : a);
                return;
              }
              setActive(a);
              setAsking({ action: a, question: a.ask(study) });
            }}
          >
            {a.label}
          </button>
        ))}
      </div>
      {active?.input && !asking && (
        <form
          className="st-ai-input"
          onSubmit={(e) => {
            e.preventDefault();
            if (typed.trim()) setAsking({ action: active, question: active.ask(study, typed.trim()) });
          }}
        >
          <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={active.input} />
          <button className="btn primary" disabled={!typed.trim()}>
            Ask
          </button>
        </form>
      )}
      {asking && (
        <AiAnswer
          key={asking.question}
          study={study}
          question={asking.question}
          questions={!!asking.action.questions}
          onKeep={(text) => studies.update(study.id, { help: { ...study.help, [step.id]: kept ? `${kept}\n\n${text}` : text } })}
          onClose={() => {
            setAsking(null);
            setActive(null);
            setTyped("");
          }}
        />
      )}
      {kept && (
        <details className="st-kept" open>
          <summary>Kept from the assistant</summary>
          <KeptText text={kept} />
          <button className="link-btn" onClick={() => window.confirm("Remove what you kept from the assistant here?") && studies.update(study.id, { help: { ...study.help, [step.id]: "" } })}>
            Remove
          </button>
        </details>
      )}
    </div>
  );
}

function KeptText({ text }: { text: string }) {
  const books = useMeta().data?.books ?? [];
  const peek = usePeek();
  return (
    <div onClick={peek.onClick}>
      <Answer text={text} books={books} />
      {peek.node}
    </div>
  );
}

/** Verse links in answers open in a small box instead of leaving the study. */
function usePeek() {
  const navigate = useNavigate();
  const [target, setTarget] = useState<PeekTarget | null>(null);
  return {
    onClick(e: MouseEvent) {
      const a = (e.target as HTMLElement).closest("a");
      const href = a?.getAttribute("href");
      if (!a || !href?.startsWith("/")) return;
      e.preventDefault();
      if (peekable(href)) setTarget({ href, rect: a.getBoundingClientRect(), label: a.textContent ?? undefined });
      else navigate(href);
    },
    node: target ? <Peek target={target} onClose={() => setTarget(null)} /> : null,
  };
}

function AiAnswer({ study, question, questions, onKeep, onClose }: { study: Study; question: string; questions: boolean; onKeep: (t: string) => void; onClose: () => void }) {
  const books = useMeta().data?.books ?? [];
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [kept, setKept] = useState(false);
  const state = useAssistantState();
  const ready = state === "ready";
  const peek = usePeek();
  useEffect(() => {
    if (!ready) return; // runs by itself once the assistant is set up, here or in another tab
    const ctrl = new AbortController();
    void askOnce(question, `a Bible study of ${study.label}${study.title ? ` (${study.title})` : ""}`, setText, ctrl.signal).then((err) => {
      if (!ctrl.signal.aborted) {
        setError(err);
        setBusy(false);
      }
    });
    return () => ctrl.abort();
  }, [question, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready)
    return (
      <div className="st-ai-card">
        {state === "no-key" ? (
          <p>
            Your assistant is set up, but this browser doesn't have your key right now. Keys are kept only until the browser closes, unless you tick “Remember the key on this
            device” in Ask.
          </p>
        ) : (
          <p>
            The assistant answers with your own AI account (Claude, ChatGPT, Gemini and others, or a model on your computer). Set it up once and it works everywhere in
            Testimonia.
          </p>
        )}
        <div className="st-ai-actions">
          <button className="btn primary" onClick={() => openAsk(study.label)}>
            {state === "no-key" ? "Add your key" : "Set up the assistant"}
          </button>
          <button className="link-btn" onClick={onClose}>
            Not now
          </button>
        </div>
      </div>
    );

  const items = questions && !busy ? listItems(text) : [];
  return (
    <div className="st-ai-card" aria-busy={busy}>
      {!text && busy && (
        <div className="st-ai-wait">
          <span className="st-pulse" /> Reading the passage…
        </div>
      )}
      {text && (
        <div onClick={peek.onClick}>
          {items.length ? <QuestionPicker study={study} items={items} /> : <Answer text={text} books={books} />}
        </div>
      )}
      {peek.node}
      {error && <p className="st-ai-error">{error}</p>}
      {!busy && (
        <div className="st-ai-actions">
          {!items.length && text && (
            <button
              className="btn"
              onClick={() => {
                onKeep(text);
                setKept(true);
              }}
              disabled={kept}
            >
              {kept ? "✓ Kept in your study" : "Keep in my study"}
            </button>
          )}
          <button className="link-btn" onClick={() => openAsk(study.label)}>
            Ask a follow-up
          </button>
          <button className="link-btn" onClick={onClose}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}

function QuestionPicker({ study, items }: { study: Study; items: string[] }) {
  return (
    <ul className="st-qpick">
      {items.map((q) => {
        const has = study.questions.includes(q);
        return (
          <li key={q}>
            <span>{q}</span>
            <button
              className={`st-add${has ? " on" : ""}`}
              onClick={() => studies.update(study.id, { questions: has ? study.questions.filter((x) => x !== q) : [...study.questions, q] })}
              aria-label={has ? "Remove from your questions" : "Add to your questions"}
            >
              {has ? "✓" : "+"}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function GroupQuestions({ study }: { study: Study }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const q = draft.trim();
    if (q && !study.questions.includes(q)) studies.update(study.id, { questions: [...study.questions, q] });
    setDraft("");
  };
  return (
    <div className="st-lib st-group">
      <div className="st-lib-head">
        <span>Questions for a group</span>
        <span className="st-lib-note">Optional, for leading a study</span>
      </div>
      {study.questions.length > 0 && (
        <ol className="st-qlist">
          {study.questions.map((q, i) => (
            <li key={q}>
              <span>{q}</span>
              <button className="link-btn" aria-label="Remove" onClick={() => studies.update(study.id, { questions: study.questions.filter((_, j) => j !== i) })}>
                ✕
              </button>
            </li>
          ))}
        </ol>
      )}
      <form
        className="st-qadd"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Write a question…" />
        <button className="btn" disabled={!draft.trim()}>
          Add
        </button>
      </form>
    </div>
  );
}

function Spark() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden fill="currentColor">
      <path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z" />
    </svg>
  );
}

// ----------------------------------------------------------------------------- the end: review, handout

function Finished({ study, g }: { study: Study; g: PassageGuide | undefined }) {
  const books = useMeta().data?.books ?? [];
  const navigate = useNavigate();
  const [review, setReview] = useState(false);
  const [copied, setCopied] = useState(false);
  const m = METHODS[study.method];
  const written = m.steps.filter((s) => study.answers[s.id]?.trim() || study.help[s.id]?.trim());
  const label = (o: string) => osisLabel(o, books);

  const print = () => {
    document.body.classList.add("printing-study");
    window.addEventListener("afterprint", () => document.body.classList.remove("printing-study"), { once: true });
    window.print();
  };

  return (
    <section className="st-card st-done">
      <div className="st-done-head">
        <span className="st-badge" aria-hidden>
          ✓
        </span>
        <div>
          <h2>{study.finished ? "Study complete" : "Your study so far"}</h2>
          <p className="st-lead">
            {written.length ? `${written.length} of ${m.steps.length} steps written` : "Nothing written yet"}
            {study.questions.length ? ` · ${study.questions.length} question${study.questions.length === 1 ? "" : "s"} for a group` : ""}
          </p>
        </div>
      </div>

      {written.length > 0 && (
        <div className="st-ai st-review">
          {!review ? (
            <button className="st-ai-btn big" onClick={() => setReview(true)}>
              <Spark /> Look over my study with the assistant
            </button>
          ) : (
            <AiAnswer study={study} question={reviewQuestion(study)} questions={false} onKeep={(t) => studies.update(study.id, { help: { ...study.help, review: t } })} onClose={() => setReview(false)} />
          )}
        </div>
      )}

      <div className="st-summary">
        {m.steps.map((s) => {
          const a = study.answers[s.id]?.trim();
          const h = study.help[s.id]?.trim();
          const carry = s.id === "carry" && study.carry;
          if (!a && !h && !carry) return null;
          return (
            <div key={s.id} className="st-sum">
              <h3>{s.title}</h3>
              {carry && (
                <p className="st-sum-verse">
                  <Link to={verseUrl(study.carry!)}>{label(study.carry!)}</Link> {g?.verses.find((v) => v.osis === study.carry)?.text}
                </p>
              )}
              {a && <p className="st-sum-a">{a}</p>}
              {h && (
                <div className="st-sum-help">
                  <KeptText text={h} />
                </div>
              )}
            </div>
          );
        })}
        {study.help.review && (
          <div className="st-sum">
            <h3>The assistant's look over it</h3>
            <div className="st-sum-help">
              <KeptText text={study.help.review} />
            </div>
          </div>
        )}
        {study.questions.length > 0 && (
          <div className="st-sum">
            <h3>Questions for a group</h3>
            <ol className="st-qlist plain">
              {study.questions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ol>
          </div>
        )}
      </div>

      <div className="st-nav">
        <span className="st-nav-left">
          <button className="btn" onClick={print}>
            Print
          </button>
          <button
            className="btn"
            onClick={() =>
              void copyText(studyText(study, label)).then((ok) => {
                setCopied(ok);
                window.setTimeout(() => setCopied(false), 1600);
              })
            }
          >
            {copied ? "✓ Copied" : "Copy as text"}
          </button>
        </span>
        <span className="st-nav-right">
          <button
            className="link-btn danger"
            onClick={() => {
              if (!window.confirm(`Delete your study of ${study.label}?`)) return;
              studies.remove(study.id);
              navigate("/notes#studies");
            }}
          >
            Delete
          </button>
          <Link className="btn primary" to={verseUrl(g?.range.start ?? study.ref.split("-")[0]!)}>
            Back to reading
          </Link>
        </span>
      </div>

      <Handout study={study} g={g} />
    </section>
  );
}

/** Printed: the passage, the questions with room to write, and (for the leader) the notes. Hidden on screen. */
function Handout({ study, g }: { study: Study; g: PassageGuide | undefined }) {
  const m = METHODS[study.method];
  return (
    <div className="st-print" aria-hidden>
      <h1>{study.label}</h1>
      {study.title && <p className="st-print-sub">{study.title}</p>}
      <p className="st-print-text">
        {g?.verses.map((v) => (
          <span key={v.vkey}>
            <sup>{v.verse}</sup>
            {v.text}{" "}
          </span>
        ))}
      </p>
      {g && <p className="st-print-ed">{g.edition.abbrev ?? g.edition.id}</p>}
      {study.questions.length > 0 && (
        <>
          <h2>Questions</h2>
          <ol>
            {study.questions.map((q) => (
              <li key={q}>
                {q}
                <div className="st-print-lines" />
              </li>
            ))}
          </ol>
        </>
      )}
      {m.steps.some((s) => study.answers[s.id]?.trim()) && (
        <>
          <h2>My notes</h2>
          {m.steps.map((s) =>
            study.answers[s.id]?.trim() ? (
              <div key={s.id}>
                <h3>{s.title}</h3>
                <p>{study.answers[s.id]}</p>
              </div>
            ) : null,
          )}
        </>
      )}
      <p className="st-print-foot">Testimonia · testimonia.web.app</p>
    </div>
  );
}
