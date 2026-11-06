import { Link } from "react-router-dom";
import { rulerTitle, savedChronology, shortLabel, useVerseRulers, type UnderRuler } from "../rulersApi";

/** "Under: Hezekiah of Judah (716/15–687/86 BC, Thiele) · Sennacherib of Assyria (705–681 BC)": who ruled at the
 * time of the passage, from the verse's approximate date and the rulers its chapter names. */
export function UnderRulers({ osis }: { osis: string }) {
  const { data } = useVerseRulers(osis, savedChronology());
  if (!data?.window || data.rulers.length === 0) return null;
  return (
    <p className="under-rulers">
      <Link to="/rulers" className="under-label" title="Kings and rulers on a timeline">
        Under
      </Link>
      :{" "}
      {data.rulers.map((r, i) => (
        <span key={r.id}>
          {i > 0 && <span className="under-sep"> · </span>}
          <Link to={`/person/${encodeURIComponent(r.person_id)}`} title={title(r)}>
            {rulerTitle(r.name, r.office, r.realm_short, r.style)}
          </Link>
          <span className="under-dates">
            {" "}
            ({shortLabel(r)}
            {r.system && r.system !== "scholarly" && `, ${systemShort(r.system_name ?? r.system)}`}
            {r.coregent && `, ${r.shared_kind === "rival" ? "rival reign" : "coregent"}`})
          </span>
        </span>
      ))}
    </p>
  );
}

function systemShort(name: string): string {
  return name.replace(/\s*\(.*\)$/, "");
}

function title(r: UnderRuler): string {
  const where = r.named ? "named in this chapter" : r.realm_name;
  return `${r.office} — ${where}${r.system_name ? ` · dates: ${r.system_name}` : ""}`;
}
