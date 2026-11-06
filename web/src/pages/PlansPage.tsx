import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { verseUrl } from "../lib";
import { dateOf, dayOf, isoDate, loadProgress, saveProgress, usePlan, usePlans, type PlanProgress, type PlanReading } from "../readingApi";

/** The reading plans, with each one's progress in this browser. */
export function PlansPage() {
  const { data, isLoading, error } = usePlans();
  const today = isoDate(new Date());
  return (
    <div className="page rd-page">
      <header className="rd-head">
        <h1>Reading plans</h1>
        <p className="rd-lede">A portion for each day. Your progress is kept in this browser only — no account needed.</p>
      </header>
      {isLoading && <div className="loading">Loading…</div>}
      {error && <div className="error">{String(error)}</div>}
      <div className="rd-plan-cards">
        {data?.map((p) => {
          const prog = loadProgress(p.id);
          const done = prog.done.length;
          return (
            <Link key={p.id} to={`/plans/${p.id}`} className="rd-plan-card">
              <h2>{p.title}</h2>
              <p>{p.description}</p>
              <div className="rd-plan-foot">
                <span className="muted small">{p.days} days</span>
                {prog.start && (
                  <span className="small">
                    Day {dayOf(prog.start, today, p.days)} · {done} read
                  </span>
                )}
              </div>
              {prog.start && <Progress value={done / p.days} />}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function Progress({ value }: { value: number }) {
  return (
    <div className="rd-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
      <span style={{ width: `${Math.min(100, value * 100)}%` }} />
    </div>
  );
}

/** One plan: today's portion first, then every day with a tick box. */
export function PlanPage() {
  const { id = "" } = useParams();
  const { data, isLoading, error } = usePlan(id);
  const [progress, setProgress] = useState<PlanProgress>(() => loadProgress(id));
  const [current, setCurrent] = useState(id);
  if (current !== id) {
    setCurrent(id);
    setProgress(loadProgress(id));
  }
  const today = isoDate(new Date());
  const total = data?.days.length ?? 0;
  const todayDay = progress.start && total ? dayOf(progress.start, today, total) : null;
  const done = useMemo(() => new Set(progress.done), [progress.done]);
  const todayRef = useRef<HTMLLIElement>(null);
  const [showAll, setShowAll] = useState(false);

  function update(p: PlanProgress) {
    setProgress(p);
    saveProgress(id, p);
  }
  const toggle = (day: number) => update({ ...progress, done: done.has(day) ? progress.done.filter((d) => d !== day) : [...progress.done, day] });

  useEffect(() => {
    if (showAll) {
      todayRef.current?.scrollIntoView({ block: "center" });
    }
  }, [showAll]);

  if (isLoading) return <div className="loading">Loading…</div>;
  if (error || !data) return <div className="error">Could not load this plan: {String(error)}</div>;

  // without a start date, the next unread day is "today's" portion
  const focus = todayDay ?? (data.days.find((d) => !done.has(d.day))?.day ?? 1);
  const focusDay = data.days[focus - 1];
  // the list shows a window around today unless asked for every day
  const lo = showAll ? 1 : Math.max(1, focus - 3);
  const hi = showAll ? total : Math.min(total, focus + 10);

  return (
    <div className="page rd-page rd-plan-page">
      <Link to="/plans" className="rd-back">
        ← All plans
      </Link>
      <header className="rd-head">
        <h1>{data.title}</h1>
        <p className="rd-lede">{data.description}</p>
        <div className="rd-plan-status">
          <Progress value={done.size / total} />
          <span className="small">
            {done.size} of {total} days read
          </span>
          {progress.start ? (
            <span className="small muted">
              · started{" "}
              <input
                type="date"
                className="rd-date"
                value={progress.start}
                onChange={(e) => e.target.value && update({ ...progress, start: e.target.value })}
                aria-label="Start date"
              />
            </span>
          ) : (
            <button className="btn" onClick={() => update({ ...progress, start: today })}>
              Start today
            </button>
          )}
          {(progress.start || done.size > 0) && (
            <button
              className="link-btn small"
              onClick={() => {
                if (window.confirm("Forget the start date and every ticked day for this plan?")) update({ start: null, done: [] });
              }}
            >
              Reset
            </button>
          )}
        </div>
      </header>

      {focusDay && (
        <section className="rd-today">
          <div className="rd-today-head">
            <span className="rd-label">{todayDay ? "Today" : "Next"}</span>
            <span>
              Day {focusDay.day}
              {progress.start && <span className="muted"> · {formatDate(dateOf(progress.start, focusDay.day))}</span>}
            </span>
          </div>
          <div className="rd-today-readings">
            {focusDay.readings.map((r) => (
              <Reading key={r.osis} r={r} large />
            ))}
          </div>
          <div className="rd-today-actions">
            {focusDay.readings[0] && (
              <Link className="btn" to={readUrl(focusDay.readings[0])}>
                Read →
              </Link>
            )}
            <label className="rd-check">
              <input type="checkbox" checked={done.has(focusDay.day)} onChange={() => toggle(focusDay.day)} /> Done
            </label>
          </div>
        </section>
      )}

      <ol className="rd-days">
        {data.days.slice(lo - 1, hi).map((d) => (
          <li key={d.day} ref={d.day === focus ? todayRef : undefined} className={`${d.day === focus ? "today" : ""}${done.has(d.day) ? " done" : ""}`}>
            <label className="rd-day-check" title={done.has(d.day) ? "Mark as unread" : "Mark as read"}>
              <input type="checkbox" checked={done.has(d.day)} onChange={() => toggle(d.day)} />
              <span className="rd-day-n">Day {d.day}</span>
            </label>
            <div className="rd-day-readings">
              {d.readings.map((r) => (
                <Reading key={r.osis} r={r} />
              ))}
            </div>
            {progress.start && <span className="rd-day-date muted small">{formatDate(dateOf(progress.start, d.day))}</span>}
          </li>
        ))}
      </ol>
      {!showAll && (
        <button className="more" onClick={() => setShowAll(true)}>
          Show all {total} days
        </button>
      )}
    </div>
  );
}

function Reading({ r, large = false }: { r: PlanReading; large?: boolean }) {
  if (r.end_osis) {
    // a passage (the early-church plan)
    return (
      <div className={`rd-reading${large ? " large" : ""}`}>
        <Link to={verseUrl(r.osis)}>{r.label}</Link>
        {r.title && <span className="rd-reading-title"> {r.title}</span>}
        {r.cited_by && r.cited_by.length > 0 && (
          <div className="muted small">
            Cited {r.citations}× before Nicaea · {r.cited_by.join(", ")}
          </div>
        )}
      </div>
    );
  }
  const name = r.label.replace(/\s[\d–]+$/, "");
  return (
    <div className={`rd-reading${large ? " large" : ""}`}>
      <span>{name} </span>
      {r.chapters.map((c, i) => (
        <span key={c}>
          {i > 0 && <span className="muted">, </span>}
          <Link to={`/read/${r.book}/${c}`} title={`Read ${name} ${c}`}>
            {c}
          </Link>
        </span>
      ))}
    </div>
  );
}

function readUrl(r: PlanReading): string {
  return r.end_osis ? verseUrl(r.osis) : `/read/${r.book}/${r.chapters[0] ?? 1}`;
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
