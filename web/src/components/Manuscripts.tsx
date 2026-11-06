import { Link } from "react-router-dom";
import { manuscriptUrl, msDate, useVerseManuscripts, type ManuscriptSummary } from "../manuscriptsApi";

/** A siglum as printed: papyri as 𝔓 with a raised number (𝔓⁵²), others as listed (01 א, 1QIsaᵃ). */
export function Siglum({ m }: { m: Pick<ManuscriptSummary, "sigla" | "id"> }) {
  const s = m.sigla ?? m.id.replace(/^[A-Z]+:/, "");
  const p = /^P(\d+)$/.exec(s);
  if (p) {
    return (
      <span className="ms-siglum">
        𝔓<sup>{p[1]}</sup>
      </span>
    );
  }
  return <span className="ms-siglum">{s}</span>;
}

/** Licence line for links into the INTF's Virtual Manuscript Room (images belong to the holding institutions). */
export function NtvmrNote() {
  return <span className="ms-note">images © holding institutions, on NTVMR</span>;
}

/** Study panel: the earliest manuscripts that contain this verse and, for the Old Testament, the Qumran scrolls. */
export function VerseManuscripts({ osis }: { osis: string }) {
  const { data } = useVerseManuscripts(osis);
  if (!data || (data.manuscripts.length === 0 && data.dss.length === 0)) return null;
  const shown = data.manuscripts.slice(0, 5);
  const scrolls = data.dss;
  return (
    <section className="block ms-verse">
      <h3>
        Manuscripts <span className="count">{data.total + scrolls.length}</span>
      </h3>
      {scrolls.length > 0 && (
        <p className="ms-qumran">
          Attested at Qumran in{" "}
          {scrolls.slice(0, 6).map((s, i) => (
            <span key={s.id}>
              {i > 0 && (i === Math.min(scrolls.length, 6) - 1 && scrolls.length <= 6 ? " and " : ", ")}
              <Link to={manuscriptUrl(s.id)} title={[s.name, msDate(s)].filter(Boolean).join(" · ")}>
                <Siglum m={s} />
              </Link>
            </span>
          ))}
          {scrolls.length > 6 && <span className="muted"> and {scrolls.length - 6} more</span>}
          {scrolls[0]?.date_from != null && <span className="muted"> · earliest {msDate(scrolls[0])}</span>}
        </p>
      )}
      {shown.length > 0 && (
        <ul className="ms-early">
          {shown.map((m) => (
            <li key={m.id}>
              <Link to={manuscriptUrl(m.id)} className="ms-early-name">
                <Siglum m={m} />
                {m.name && m.name !== m.sigla && <span className="ms-early-title">{m.name}</span>}
              </Link>
              <span className="ms-early-date">{msDate(m)}</span>
              {m.ntvmr && (
                <a className="ms-early-img" href={m.ntvmr.images} target="_blank" rel="noreferrer" title="View images (NTVMR) — images © holding institutions">
                  images ↗
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="ms-verse-foot">
        {data.total > shown.length && (
          <span className="muted">
            Earliest {shown.length} of {data.total} listed
          </span>
        )}
        {data.ntvmr_verse && (
          <span>
            <a href={data.ntvmr_verse} target="_blank" rel="noreferrer">
              Every Greek manuscript of this verse (NTVMR) ↗
            </a>{" "}
            <NtvmrNote />
          </span>
        )}
      </div>
    </section>
  );
}
