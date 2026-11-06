import { Link } from "react-router-dom";
import { useVerseEntities } from "../geoApi";

/** "People & places" in the study panel: who and where this verse names, each linking to its page. */
export function VerseEntities({ osis }: { osis: string }) {
  const { data } = useVerseEntities(osis);
  if (!data || (!data.people.length && !data.places.length && !data.events.length)) return null;
  const located = data.places.filter((p) => p.lat !== null);
  const mapUrl =
    located.length === 1 ? `/atlas?place=${encodeURIComponent(located[0]!.id)}` : `/atlas?show=${located.map((p) => encodeURIComponent(p.id)).join(",")}`;
  return (
    <section className="block verse-entities">
      <h3>People &amp; places</h3>
      {data.people.length > 0 && (
        <p className="ve-row">
          <span className="ve-label">People</span>
          {data.people.map((p, i) => (
            <span key={p.id}>
              {i > 0 && <span className="ve-sep">, </span>}
              <Link to={`/person/${encodeURIComponent(p.id)}`} title={p.summary ?? undefined}>
                {p.name}
              </Link>
            </span>
          ))}
        </p>
      )}
      {data.places.length > 0 && (
        <p className="ve-row">
          <span className="ve-label">Places</span>
          {data.places.map((p, i) => (
            <span key={p.id}>
              {i > 0 && <span className="ve-sep">, </span>}
              <Link to={`/place/${encodeURIComponent(p.id)}`} title={p.modern_name ? `today ${p.modern_name}` : undefined}>
                {p.name}
              </Link>
            </span>
          ))}
          {located.length > 0 && (
            <Link className="ve-map" to={mapUrl} title="Show on the atlas">
              map
            </Link>
          )}
        </p>
      )}
      {data.events.length > 0 && (
        <p className="ve-row">
          <span className="ve-label">Event</span>
          {data.events.slice(0, 2).map((e, i) => (
            <span key={e.id}>
              {i > 0 && <span className="ve-sep"> · </span>}
              <Link to={`/event/${encodeURIComponent(e.id)}`}>{e.title}</Link>
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
