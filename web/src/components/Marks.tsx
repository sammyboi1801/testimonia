import { useSettings, type MarkKind, type Settings } from "../settings";
import type { VerseMarks } from "../types";

export interface ShownMark {
  kind: MarkKind;
  minor: boolean;
}

/** Which margin marks a verse gets under the user's mark preferences. */
export function shownMarks(m: VerseMarks | undefined, prefs: Settings["marks"]): ShownMark[] {
  const out: ShownMark[] = [];
  if (!m) return out;
  if (prefs.var.show) {
    if (m.major_variants) out.push({ kind: "var", minor: false });
    else if (m.variants && prefs.var.minor) out.push({ kind: "var", minor: true });
  }
  if (prefs.fat.show) {
    if (m.pre_nicene) out.push({ kind: "fat", minor: false });
    else if (m.fathers && prefs.fat.minor) out.push({ kind: "fat", minor: true });
  }
  if (prefs.quo.show && m.quotations) out.push({ kind: "quo", minor: false });
  return out;
}

/** One margin mark, drawn with the user's chosen symbol and colour. */
export function Mark({ kind, minor = false, className = "" }: { kind: MarkKind; minor?: boolean; className?: string }) {
  const { settings } = useSettings();
  return <i className={`mk mk-${kind}${minor ? " minor" : ""} ${className}`}>{settings.marks[kind].symbol}</i>;
}

export function Marks({ marks }: { marks?: VerseMarks }) {
  const { settings } = useSettings();
  return (
    <>
      {shownMarks(marks, settings.marks).map((s) => (
        <Mark key={s.kind} kind={s.kind} minor={s.minor} />
      ))}
    </>
  );
}
