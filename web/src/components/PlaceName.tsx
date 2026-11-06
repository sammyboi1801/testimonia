import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import type { TextMark } from "./Footnotes";

/** A place named in a verse (from /api/chapter/{book}/{chapter}/places). */
export interface PlaceInText {
  id: string;
  name: string;
  alt_names: string | null;
  kind: string | null;
  modern_name: string | null;
  lat: number | null;
  lon: number | null;
  verses: number;
}

/** Where each place's name (or one of its other names) occurs in a verse text, as non-overlapping marks. */
export function placeMarks(text: string, places: PlaceInText[] | undefined): TextMark[] {
  if (!places?.length) return [];
  const out: TextMark[] = [];
  for (const p of places) {
    let names = [p.name];
    try {
      const alt = p.alt_names ? (JSON.parse(p.alt_names) as unknown) : [];
      if (Array.isArray(alt)) names = names.concat(alt.filter((x): x is string => typeof x === "string"));
    } catch {
      /* not a list */
    }
    for (const name of names.filter((n) => n.length > 2).sort((a, b) => b.length - a.length)) {
      const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
      const m = re.exec(text);
      if (!m) continue;
      const start = m.index;
      const end = start + m[0].length;
      if (out.some((o) => start < o.end && end > o.start)) continue;
      out.push({ start, end, color: "", place: p });
      break;
    }
  }
  return out;
}

/** A place name in the Bible text: a quiet underline; hover (or tap) shows a card with links to the map. */
export function PlaceName({ place, children }: { place: PlaceInText; children: ReactNode }) {
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const ref = useRef<HTMLSpanElement>(null);
  const open = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const up = r.bottom + 170 > window.innerHeight;
    setPos({ left: Math.max(8, Math.min(r.left - 12, window.innerWidth - 268)), top: up ? r.top - 6 : r.bottom + 6, up });
  };
  const show = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(open, 250);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPos(null), 200);
  };
  const keep = () => window.clearTimeout(timer.current);
  return (
    <span
      ref={ref}
      className="place-name"
      onMouseEnter={show}
      onMouseLeave={hide}
      onClick={(e) => {
        e.stopPropagation(); // a tap shows the card instead of selecting the verse
        if (pos) setPos(null);
        else open();
      }}
    >
      {children}
      {pos &&
        createPortal(
          <span
            className={`place-card${pos.up ? " up" : ""}`}
            style={{ left: pos.left, top: pos.top }}
            onMouseEnter={keep}
            onMouseLeave={hide}
            onClick={(e) => e.stopPropagation()}
          >
            <strong>{place.name}</strong>
            <span className="place-card-meta">
              {[place.kind, place.modern_name ? `today ${place.modern_name}` : null].filter(Boolean).join(" · ")}
            </span>
            <span className="place-card-meta">Named in {place.verses} verses</span>
            <span className="place-card-links">
              {place.lat != null && <Link to={`/atlas?place=${encodeURIComponent(place.id)}`}>Show on map</Link>}
              <Link to={`/place/${encodeURIComponent(place.id)}`}>Place page</Link>
            </span>
          </span>,
          document.body,
        )}
    </span>
  );
}
