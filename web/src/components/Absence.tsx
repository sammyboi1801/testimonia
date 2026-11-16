import type { AbsentInfo } from "../api";

/** "Missing from some early manuscripts": which transcribed manuscripts lack a verse, and the earliest that has it.
 *  Facts only, from the CNTR transcriptions; no judgement on whether the verse belongs. */

/** "150-250" → "AD 150–250", "~250" → "c. AD 250", "4th" → "4th century", "4th/5th" → "4th–5th century". */
export function msDate(d: string | null | undefined): string {
  if (!d) return "date unknown";
  const t = d.trim();
  if (/^~\s*\d+$/.test(t)) return `c. AD ${t.replace(/\D/g, "")}`;
  if (/^\d+\s*-\s*\d+$/.test(t)) return `AD ${t.replace(/\s*-\s*/, "–")}`;
  if (/^\d+$/.test(t)) return `AD ${t}`;
  if (/^\d+(st|nd|rd|th)(\/\d+(st|nd|rd|th))?$/.test(t)) return `${t.replace("/", "–")} century`;
  return t;
}

const list = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/** The facts in one or two sentences. `what` is "this verse" or "John 8:1–11". */
export function absenceText(info: AbsentInfo, what: string): string {
  const names = info.lacking.map((m) => `${m.name} (${msDate(m.date)})`);
  const lack = `${list(names)} ${names.length === 1 ? "does" : "do"} not contain ${what}.`;
  const has = info.first
    ? ` The earliest transcribed manuscript that has it is ${info.first.name} (${msDate(info.first.date)}).`
    : ` None of the ${info.checked} transcribed manuscripts here has it.`;
  return lack + has;
}

export function AbsenceNotice({ info, what, onMore }: { info: AbsentInfo; what: string; onMore?: () => void }) {
  return (
    <aside className="absence">
      <strong>Missing from some early manuscripts</strong>
      <p>
        {absenceText(info, what)}
        {onMore && (
          <>
            {" "}
            <button className="link-btn" onClick={onMore}>
              See the manuscripts ›
            </button>
          </>
        )}
      </p>
    </aside>
  );
}

/** Runs of consecutive flagged verses: [first, last] pairs, for one notice per passage. */
export function absenceRuns(absent: Record<number, AbsentInfo> | undefined): [number, number][] {
  const vs = Object.keys(absent ?? {})
    .map(Number)
    .sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (const v of vs) {
    const last = runs.at(-1);
    if (last && v === last[1] + 1) last[1] = v;
    else runs.push([v, v]);
  }
  return runs;
}
