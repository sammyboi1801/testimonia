import { useState } from "react";
import { Link } from "react-router-dom";
import { useWordDomains, type SemanticField, type WordDomainsData, type WordSense } from "../wordsApi";

/** Semantic domains, senses, related words and Septuagint equivalents of a word (MACULA data).
 *  Renders nothing while loading or when the word has no such data, so the word study stays calm. */
export function WordDomains({ strong, onWord }: { strong: string; onWord: (s: string) => void }) {
  const { data } = useWordDomains(strong);
  if (!data) return null;
  return (
    <>
      {data.fields.length > 0 && <Meaning data={data} onWord={onWord} />}
      {data.lxx.words.length > 0 && <Septuagint data={data} onWord={onWord} />}
    </>
  );
}

function Meaning({ data, onWord }: { data: WordDomainsData; onWord: (s: string) => void }) {
  const hebrew = data.language === "hbo";
  const shown = new Set(data.fields.flatMap((f) => f.senses));
  const rest = data.senses.filter((s) => !shown.has(s.id));
  const [allRest, setAllRest] = useState(false);
  return (
    <details className="section wd" open>
      <summary>
        Meaning <span className="count">{hebrew ? "semantic domains (SDBH)" : "Louw–Nida senses"}</span>
      </summary>
      <div className="section-body">
        {data.fields.map((f) => (
          <Field key={f.id} field={f} senses={data.senses.filter((s) => f.senses.includes(s.id))} hebrew={hebrew} onWord={onWord} />
        ))}
        {rest.length > 0 && (
          <div className="wd-field">
            <div className="wd-field-head">
              <span className="wd-field-name">Other senses</span>
            </div>
            <SenseList senses={allRest ? rest : rest.slice(0, 5)} hebrew={hebrew} named />
            {rest.length > 5 && !allRest && (
              <button className="more" onClick={() => setAllRest(true)}>
                {rest.length - 5} more
              </button>
            )}
          </div>
        )}
        {data.credit && <p className="wd-credit">{data.credit}</p>}
      </div>
    </details>
  );
}

function Field({ field, senses, hebrew, onWord }: { field: SemanticField; senses: WordSense[]; hebrew: boolean; onWord: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  // words sharing one of this word's exact senses first, then the rest of the field by frequency
  const words = [...field.words].sort((a, b) => Number(b.same_sense) - Number(a.same_sense));
  const shown = open ? words : words.slice(0, 8);
  const context = field.description?.split(" › ").slice(0, -1).join(" › ");
  return (
    <div className="wd-field">
      <div className="wd-field-head">
        <Link className="wd-field-name" to={`/domains/${field.id}`} title={`${field.system_name}: all words in this domain`}>
          {field.label}
        </Link>
        {context && <span className="wd-context">{context}</span>}
      </div>
      <SenseList senses={senses} hebrew={hebrew} />
      {words.length > 0 && (
        <div className="wd-related">
          <span className="wd-related-label">Related</span>
          {shown.map((w) => (
            <button key={w.id} className={w.same_sense ? "wd-word same" : "wd-word"} onClick={() => onWord(w.id)} title={`${w.same_sense ? "Shares a sense with this word · " : ""}${w.n_field} of ${w.n} uses in this domain`}>
              <span className={hebrew ? "hebrew" : "greek"} dir={hebrew ? "rtl" : undefined}>
                {w.lemma ?? w.id}
              </span>
              {w.gloss && <span className="wd-word-gloss">{w.gloss}</span>}
            </button>
          ))}
          {words.length > 8 && !open && (
            <button className="more" onClick={() => setOpen(true)}>
              +{words.length - 8}
            </button>
          )}
          {open && field.total_words > words.length && (
            <Link className="more" to={`/domains/${field.id}`}>
              all {field.total_words} words →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

/** One line per sense: gloss, code (Greek: Louw–Nida number; Hebrew outside its field: the domain name) and count. */
function SenseList({ senses, hebrew, named = false }: { senses: WordSense[]; hebrew: boolean; named?: boolean }) {
  if (senses.length === 0) return null;
  return (
    <ul className="wd-senses">
      {senses.map((s) => (
        <li key={s.id}>
          <span className="wd-gloss">{s.gloss ?? s.label}</span>
          <span className="wd-code">{hebrew ? (named ? s.label : "") : `LN ${s.code}`}</span>
          <span className="wd-n">{s.n > 0 ? s.n.toLocaleString() : ""}</span>
        </li>
      ))}
    </ul>
  );
}

function Septuagint({ data, onWord }: { data: WordDomainsData; onWord: (s: string) => void }) {
  const [limit, setLimit] = useState(6);
  const toGreek = data.lxx.direction === "greek";
  const words = data.lxx.words;
  const max = Math.max(1, ...words.map((w) => w.n));
  return (
    <details className="section wd" open>
      <summary>
        Septuagint <span className="count">{data.lxx.total.toLocaleString()} places</span>
      </summary>
      <div className="section-body">
        <p className="wd-note">
          {toGreek ? "How the Greek translators rendered this word." : "Hebrew words this word renders in the Greek Old Testament."}
        </p>
        <div className="wd-lxx">
          {words.slice(0, limit).map((w) => (
            <div key={w.id} className="wd-lxx-row">
              <button className="wd-word" onClick={() => onWord(w.id)} disabled={!w.lemma}>
                <span className={toGreek ? "greek" : "hebrew"} dir={toGreek ? undefined : "rtl"}>
                  {w.lemma ?? w.id}
                </span>
                {w.gloss && <span className="wd-word-gloss">{w.gloss}</span>}
              </button>
              <div className="wd-bar" style={{ width: `${Math.max(3, (w.n / max) * 100)}%` }} />
              <span className="wd-n">{w.n.toLocaleString()}</span>
            </div>
          ))}
        </div>
        {words.length > limit && (
          <button className="more" onClick={() => setLimit(limit + 20)}>
            Show more ({words.length - limit})
          </button>
        )}
      </div>
    </details>
  );
}
