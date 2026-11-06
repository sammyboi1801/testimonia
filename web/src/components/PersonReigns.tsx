import { Link } from "react-router-dom";
import { SHARED_LABEL, shortLabel, usePersonReigns } from "../rulersApi";
import { formatYear } from "../lib";

/** On a person page: the reigns or offices the person held, with dates under every chronology system. */
export function PersonReigns({ id }: { id: string }) {
  const { data } = usePersonReigns(id);
  if (!data?.reigns.length) return null;
  return (
    <section className="book-block person-reigns">
      <h3>{data.reigns.length === 1 ? "Reign" : "Reigns"}</h3>
      {data.reigns.map((r) => {
        const systems = Object.keys(r.dates).sort((a, b) => Number(a === "wikidata") - Number(b === "wikidata"));
        return (
          <div key={r.id} className="pr-reign">
            <div className="pr-office">
              {r.office}
              {r.style === "of" && !r.office.includes(r.realm_short) ? `, ${r.realm_name}` : ""}
            </div>
            <table className="rl-systems-table">
              <tbody>
                {systems.map((s) => {
                  const d = r.dates[s]!;
                  return (
                    <tr key={s} className={s === r.system ? "on" : ""}>
                      <th scope="row">{(data.systems[s] ?? s).replace(/\s*\(.*\)$/, "")}</th>
                      <td>
                        {shortLabel(d)}
                        {d.shared_from !== null && (
                          <span className="muted small">
                            {" "}
                            ({SHARED_LABEL[d.shared_kind ?? "coregency"]} from {formatYear(d.shared_from)})
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Link to={`/rulers?sel=${encodeURIComponent(r.id)}`} className="small">
              Who else ruled then →
            </Link>
          </div>
        );
      })}
    </section>
  );
}
