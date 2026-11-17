import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useBackClose } from "../backClose";
import { useSettings } from "../settings";
import { sortedStudies, studies, useStudies, type Method, type Study } from "../studies";
import { usePassage } from "../studyApi";
import { METHODS } from "../studyMethods";

/**
 * Start a Bible study: the passage (given, or typed: "John 3", "Ps 23", "Rom 8:28-39"; a single verse opens its
 * section), then how to study it.
 */
export function StudyStart({ passage: given, onClose }: { passage?: string; onClose: () => void }) {
  useBackClose(true, onClose);
  const navigate = useNavigate();
  const { settings } = useSettings();
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState(given ?? "");
  const [method, setMethod] = useState<Method>("deep");
  // what is typed is looked up a moment after typing stops
  useEffect(() => {
    if (given) return;
    const t = window.setTimeout(() => setQuery(typed.trim()), 450);
    return () => window.clearTimeout(t);
  }, [typed, given]);
  const guide = usePassage(query, settings.editions[0] ?? "bsb");
  const g = query ? guide.data : undefined;
  const title = g?.headings.length === 1 ? g.headings[0]!.title : g?.headings[0]?.title;
  const open = sortedStudies(useStudies()).find((s) => g && s.ref === g.range.ref && !s.finished);

  const start = () => {
    if (!g) return;
    const s = studies.create(g.range.ref, g.range.label, method, title);
    onClose();
    navigate(`/study/${s.id}`);
  };

  return (
    <div className="ss-layer" onClick={onClose}>
      <div className="ss-sheet" role="dialog" aria-label="Start a Bible study" onClick={(e) => e.stopPropagation()}>
        <div className="ss-head">
          <h2>Start a Bible study</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {!given && (
          <label className="ss-field">
            <span>Passage</span>
            <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="John 3, Psalm 23, Romans 8:28-39" />
          </label>
        )}
        <div className="ss-passage" aria-live="polite">
          {g ? (
            <>
              <strong>{g.range.label}</strong>
              {title && <span>{title}</span>}
              <span className="muted">{g.verses.length} verses</span>
            </>
          ) : query && guide.isLoading ? (
            <span className="muted">Finding it…</span>
          ) : query && guide.error ? (
            <span className="muted">Not a passage we know. Try “John 3” or “Psalm 23”.</span>
          ) : (
            <span className="muted">Type a chapter or a few verses.</span>
          )}
        </div>

        <div className="ss-methods" role="radiogroup" aria-label="How to study it">
          {(Object.keys(METHODS) as Method[]).map((id) => {
            const m = METHODS[id];
            return (
              <button key={id} role="radio" aria-checked={method === id} className={`ss-method${method === id ? " on" : ""}`} onClick={() => setMethod(id)}>
                <span className="ss-m-top">
                  <strong>{m.name}</strong>
                  <span className="ss-time">{m.time}</span>
                </span>
                <span className="ss-blurb">{m.blurb}</span>
                <span className="ss-flow">{m.steps.map((s) => s.title).join(" → ")}</span>
              </button>
            );
          })}
        </div>

        <div className="ss-actions">
          {open && (
            <Link className="link-btn" to={`/study/${open.id}`} onClick={onClose}>
              Continue the one you started
            </Link>
          )}
          <button className="btn primary" onClick={start} disabled={!g}>
            Start
          </button>
        </div>
      </div>
    </div>
  );
}

/** "Step 2 of 4 · Observe", or "Complete". */
export function studyProgress(s: Study): { text: string; value: number } {
  const steps = METHODS[s.method].steps;
  if (s.finished) return { text: "Complete", value: 1 };
  const at = Math.min(s.step, steps.length - 1);
  return { text: `Step ${at + 1} of ${steps.length} · ${steps[at]!.title}`, value: s.done.length / steps.length };
}

/** The studies on the Notes page: each one to continue, and a button for a new one. */
export function StudyList() {
  const list = sortedStudies(useStudies());
  const [starting, setStarting] = useState(false);
  return (
    <section className="ss-list" id="studies">
      <div className="ss-list-head">
        <h2>Bible studies</h2>
        <button className="btn primary" onClick={() => setStarting(true)}>
          + New study
        </button>
      </div>
      {list.length === 0 ? (
        <button className="ss-empty" onClick={() => setStarting(true)}>
          <strong>Study a passage step by step</strong>
          <span>A 10-minute devotional, or an in-depth study with the Greek and Hebrew, the early church and the assistant beside you.</span>
        </button>
      ) : (
        <div className="ss-cards">
          {list.map((s) => {
            const p = studyProgress(s);
            return (
              <Link key={s.id} className={`ss-card${s.finished ? " done" : ""}`} to={`/study/${s.id}`}>
                <span className="ss-kind">{METHODS[s.method].name}</span>
                <strong>{s.label}</strong>
                {s.title && <span className="ss-title">{s.title}</span>}
                <span className="ss-prog">
                  <span className="ss-bar">
                    <i style={{ width: `${Math.round(p.value * 100)}%` }} />
                  </span>
                  {p.text}
                </span>
              </Link>
            );
          })}
        </div>
      )}
      {starting && <StudyStart onClose={() => setStarting(false)} />}
    </section>
  );
}
