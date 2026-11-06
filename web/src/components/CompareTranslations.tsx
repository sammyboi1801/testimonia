import { useMemo, useState } from "react";
import { langClass, nativeLabel } from "../lib";
import { diffWords, type DiffPart } from "../studyLib";
import type { VerseGuide } from "../types";
import { Speak } from "./Speak";

const KEY = "testimonia.compare";

function load(): { on: boolean; base: string } {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as { on?: boolean; base?: string } | null;
    return { on: !!v?.on, base: v?.base ?? "kjva" };
  } catch {
    return { on: false, base: "kjva" };
  }
}

function save(v: { on: boolean; base: string }) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* private mode: not remembered */
  }
}

type Text = VerseGuide["texts"][number];

/**
 * The study panel's Translations block, with a "Compare" switch: every translation in the same language as the
 * chosen base (KJV by default) has the words that differ from it marked.
 */
export function CompareTranslations({ texts, osis }: { texts: Text[]; osis: string }) {
  const [state, setState] = useState(load);
  const update = (patch: Partial<typeof state>) => {
    const next = { ...state, ...patch };
    setState(next);
    save(next);
  };
  const comparable = texts.filter((t) => t.language === "eng");
  const base = comparable.find((t) => t.edition_id === state.base) ?? comparable[0];
  const on = state.on && !!base && comparable.length > 1;
  const baseName = base?.abbrev ?? base?.edition_id ?? "";

  return (
    <section className="block">
      <h3 className="cmp-head">
        <span>
          Translations <span className="count">{texts.length}</span>
        </span>
        {comparable.length > 1 && (
          <button className={`cmp-toggle${on ? " on" : ""}`} aria-pressed={on} onClick={() => update({ on: !state.on })} title="Mark the words where each translation differs">
            Compare
          </button>
        )}
      </h3>
      {on && base && (
        <p className="cmp-legend">
          Marked: words that differ from{" "}
          <select aria-label="Compare against" value={base.edition_id} onChange={(e) => update({ base: e.target.value })}>
            {comparable.map((t) => (
              <option key={t.edition_id} value={t.edition_id}>
                {t.abbrev ?? t.edition_id}
              </option>
            ))}
          </select>
          <span className="cmp-key">
            <span className="cmp-gap-mark">‸</span> {baseName} has words here
          </span>
        </p>
      )}
      {texts.map((t) => (
        <div key={t.edition_id} className={`item${on && t === base ? " cmp-base" : ""}`}>
          <div className="item-head">
            <span className="who">
              {t.abbrev ?? t.edition_id}
              {on && t === base && <span className="cmp-base-tag">base</span>}
            </span>
            <span className="when">
              {t.native_ref && <span title="Numbered differently in this edition">{nativeLabel(t.native_ref, osis)} </span>}
              {(t.language === "hbo" || t.language === "grc") && <Speak text={t.text} lang={t.language === "grc" ? "grc" : "hbo"} />}
            </span>
          </div>
          <div className={`text ${langClass(t.language)}`} lang={t.language} dir={t.script_dir === "rtl" ? "rtl" : undefined}>
            {on && t !== base && t.language === base!.language ? <Diffed base={base!.text} text={t.text} baseName={baseName} /> : t.text}
          </div>
        </div>
      ))}
    </section>
  );
}

function Diffed({ base, text, baseName }: { base: string; text: string; baseName: string }) {
  const parts = useMemo(() => diffWords(base, text), [base, text]);
  return (
    <>
      {parts.map((p: DiffPart, i) => (
        <span key={i}>
          {p.gap && !p.changed && (
            <span className="cmp-gap" title={`${baseName}: “${p.gap}”`} aria-label={`${baseName} has: ${p.gap}`}>
              ‸
            </span>
          )}
          {p.changed ? (
            <mark className="cmp-diff" title={p.gap ? `${baseName}: “${p.gap}”` : `Not in ${baseName}`}>
              {p.text}
            </mark>
          ) : (
            p.text
          )}
        </span>
      ))}
    </>
  );
}
