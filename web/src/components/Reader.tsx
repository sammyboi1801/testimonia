import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { isRtl, langClass } from "../lib";
import { useSettings } from "../settings";
import type { Chapter, Edition, Word } from "../types";

const ALL_GREEK = "NA28+NA27+Tyn+SBL+WH+Treg+TR+Byz";

interface Props {
  data: Chapter;
  editions: Edition[];
  selected: string | null;
  onSelect: (osis: string) => void;
  onWord: (strong: string) => void;
}

export function Reader({ data, editions, selected, onSelect, onWord }: Props) {
  const { settings, update } = useSettings();
  const byId = useMemo(() => new Map(editions.map((e) => [e.id, e])), [editions]);
  const isNT = data.verses.some((v) => v.words.tagnt);
  const wordEd = isNT ? "tagnt" : "tahot";
  const textEds = data.editions.filter((e) => e !== "tagnt" && e !== "tahot");
  const showWords = settings.original && data.verses.some((v) => v.words[wordEd]?.length);
  const headings = useMemo(() => new Map(data.headings.map((h) => [h.vkey, h.title])), [data.headings]);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selected) {
      container.current?.scrollTo({ top: 0 });
      return;
    }
    const el = container.current?.querySelector<HTMLElement>(`[data-osis="${CSS.escape(selected)}"]`);
    el?.scrollIntoView({ block: "center" });
  }, [selected, data.book, data.chapter]);

  const columns = textEds.length + (showWords ? 1 : 0);

  return (
    <div className="reader" ref={container}>
      <div className="reader-head">
        <div className="chapter-title">
          {data.prev ? (
            <Link className="nav-arrow" to={`/read/${data.prev.book}/${data.prev.chapter}`} title={`${data.prev.name} ${data.prev.chapter}`}>
              ‹
            </Link>
          ) : (
            <span className="nav-arrow disabled">‹</span>
          )}
          <h1>
            {data.name} {data.chapter}
          </h1>
          {data.next ? (
            <Link className="nav-arrow" to={`/read/${data.next.book}/${data.next.chapter}`} title={`${data.next.name} ${data.next.chapter}`}>
              ›
            </Link>
          ) : (
            <span className="nav-arrow disabled">›</span>
          )}
        </div>
        <EditionPicker editions={editions} chosen={settings.editions} onChange={(eds) => update({ editions: eds })} />
        <label className="toggle">
          <input type="checkbox" checked={settings.original} onChange={(e) => update({ original: e.target.checked })} />
          {isNT ? "Greek" : "Hebrew"} interlinear
        </label>
      </div>

      <div className="verses" style={{ ["--cols" as string]: String(Math.max(columns, 1)) }}>
        {columns > 1 && (
          <div className="verse-row column-heads">
            {textEds.map((id) => (
              <div key={id} className="col-head" title={byId.get(id)?.title}>
                {byId.get(id)?.abbrev ?? id}
              </div>
            ))}
            {showWords && <div className="col-head">{isNT ? "Greek (TAGNT)" : "Hebrew (TAHOT)"}</div>}
          </div>
        )}
        {data.verses.map((v) => {
          const heading = headings.get(v.vkey);
          const isSel = v.osis === selected;
          return (
            <div key={v.vkey} className="verse-block">
              {heading && <h2 className="pericope">{heading}</h2>}
              <div
                className={`verse-row${isSel ? " selected" : ""}`}
                data-osis={v.osis}
                id={`v${v.verse}`}
                onClick={() => onSelect(v.osis)}
              >
                {textEds.map((id, i) => {
                  const ed = byId.get(id);
                  const t = v.texts[id];
                  const rtl = ed ? isRtl(ed.language) : false;
                  return (
                    <div
                      key={id}
                      className={`cell ${ed ? langClass(ed.language) : ""}${v.red_letter && ed?.language === "eng" ? " red" : ""}`}
                      dir={rtl ? "rtl" : undefined}
                      lang={ed?.language}
                    >
                      {i === 0 && <span className="vnum">{v.verse === 0 ? "title" : v.verse}</span>}
                      {t ? (
                        <>
                          {t.text}
                          {t.native && (
                            <span className="native" title="Numbered differently in this edition">
                              {t.native.replace(/^[^.]+\./, "").replace(".", ":")}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="missing">—</span>
                      )}
                    </div>
                  );
                })}
                {showWords && (
                  <div className={`cell words ${isNT ? "greek" : "hebrew"}`} dir={isNT ? "ltr" : "rtl"}>
                    {textEds.length === 0 && <span className="vnum">{v.verse}</span>}
                    {(v.words[wordEd] ?? []).map((w) => (
                      <WordChip key={w.pos} w={w} onWord={onWord} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WordChip({ w, onWord }: { w: Word; onWord: (s: string) => void }) {
  const variant = w.editions && w.editions !== ALL_GREEK && w.editions.includes("+") ? w.editions : null;
  const id = w.lemma_id ?? w.strong?.split(" ").find((s) => /^[GH]\d{4}/.test(s) && !/^H9\d{3}/.test(s)) ?? null;
  return (
    <button
      className={`word${variant ? " variant" : ""}`}
      title={[w.translit, w.morph, variant ? `Only in: ${variant.replaceAll("+", ", ")}` : null].filter(Boolean).join(" · ")}
      onClick={(e) => {
        e.stopPropagation();
        if (id) onWord(id);
      }}
    >
      <span className="w-surface">{w.surface}</span>
      <span className="w-gloss">{w.gloss}</span>
    </button>
  );
}

function EditionPicker({ editions, chosen, onChange }: { editions: Edition[]; chosen: string[]; onChange: (e: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const texts = editions.filter((e) => e.kind !== "interlinear");
  const add = texts.filter((e) => !chosen.includes(e.id));
  return (
    <div className="edition-picker">
      {chosen.map((id) => {
        const e = editions.find((x) => x.id === id);
        if (!e) return null;
        return (
          <span key={id} className="chip" title={e.title}>
            {e.abbrev ?? e.id}
            {chosen.length > 1 && (
              <button aria-label={`Remove ${e.title}`} onClick={() => onChange(chosen.filter((c) => c !== id))}>
                ×
              </button>
            )}
          </span>
        );
      })}
      <div className="add-wrap">
        <button className="chip add" onClick={() => setOpen(!open)} aria-expanded={open}>
          + translation
        </button>
        {open && (
          <ul className="menu" onMouseLeave={() => setOpen(false)}>
            {add.map((e) => (
              <li key={e.id}>
                <button
                  onClick={() => {
                    onChange([...chosen, e.id].slice(0, 6));
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
