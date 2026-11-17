// Sources looked up live by the server, beyond the library: modern scholarship (OpenAlex), Jewish readers of the
// Hebrew Bible (Sefaria, when the reader turns it on) and art (Wikimedia Commons). Each says where it comes from,
// and leaves itself out quietly when its source cannot be reached.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { getJson } from "../api";
import { useBackClose } from "../backClose";
import { formatYear } from "../lib";

const KEEP = { staleTime: 24 * 3600_000, gcTime: 24 * 3600_000, retry: 0, refetchOnWindowFocus: false } as const;

export interface Work {
  title: string;
  year: number | null;
  authors: string[];
  more_authors: number;
  venue: string | null;
  cited_by: number;
  url: string;
  free_url: string | null;
  abstract: string;
}

export interface JewishSource {
  kind: "Targum" | "Mishnah" | "Talmud" | "Midrash" | "Commentary";
  title: string;
  ref: string;
  year: number | null;
  url: string;
  text?: string;
  licence?: string;
  translation?: string;
}

export interface ArtImage {
  title: string;
  thumb: string;
  width: number | null;
  height: number | null;
  page: string;
  artist: string | null;
  date: string | null;
  licence: string;
  description: string | null;
}

export const useScholarship = (q: string) =>
  useQuery({ queryKey: ["online", "scholarship", q], queryFn: () => getJson<{ works: Work[] }>("/api/online/scholarship", { q }), enabled: q.length > 1, ...KEEP });

export const useJewish = (osis: string, enabled: boolean) =>
  useQuery({
    queryKey: ["online", "jewish", osis],
    queryFn: () => getJson<{ ref: string | null; url?: string; sources: JewishSource[] }>(`/api/online/jewish/${encodeURIComponent(osis)}`),
    enabled,
    ...KEEP,
  });

export const useArt = (q: string) =>
  useQuery({ queryKey: ["online", "art", q], queryFn: () => getJson<{ images: ArtImage[] }>("/api/online/art", { q }), enabled: q.length > 1, ...KEEP });

// ----------------------------------------------------------------------------- modern scholarship

/** Published scholarship on a passage, with a free copy where there is one. */
export function Scholarship({ query, limit = 5 }: { query: string; limit?: number }) {
  const { data, isLoading } = useScholarship(query);
  const [all, setAll] = useState(false);
  if (isLoading) return <div className="skel skel-line" style={{ width: "70%" }} aria-label="Looking for scholarship" />;
  const works = data?.works ?? [];
  if (!works.length) return null;
  return (
    <section className="book-block online-block">
      <h3>
        Modern scholarship <span className="count">{works.length}</span>
      </h3>
      {(all ? works : works.slice(0, limit)).map((w) => (
        <WorkItem key={w.url} w={w} />
      ))}
      {works.length > limit && (
        <button className="link-btn" onClick={() => setAll(!all)}>
          {all ? "Fewer" : `${works.length - limit} more`}
        </button>
      )}
      <p className="muted small credit">
        Found by <a href="https://openalex.org">OpenAlex</a>, an open index of scholarly work. Secondary sources: read them beside the texts, not in place of them.
      </p>
    </section>
  );
}

function WorkItem({ w }: { w: Work }) {
  const [open, setOpen] = useState(false);
  const who = w.authors.join(", ") + (w.more_authors ? " et al." : "");
  return (
    <div className="item ol-work">
      <a className="ol-title" href={w.url} target="_blank" rel="noreferrer">
        {w.title}
      </a>
      <div className="ol-meta">
        {[who, w.year, w.venue].filter(Boolean).join(" · ")}
        {w.cited_by > 0 && <span className="muted"> · cited {w.cited_by}×</span>}
      </div>
      <div className="ol-actions">
        {w.free_url && (
          <a href={w.free_url} target="_blank" rel="noreferrer">
            Free to read ↗
          </a>
        )}
        {w.abstract && (
          <button className="link-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? "Hide abstract" : "Abstract"}
          </button>
        )}
      </div>
      {open && <p className="ol-abstract">{w.abstract}</p>}
    </div>
  );
}

// ----------------------------------------------------------------------------- Jewish readers (opt-in)

const KIND_LABEL: Record<JewishSource["kind"], string> = { Targum: "Targum", Mishnah: "Mishnah", Talmud: "Talmud", Midrash: "Midrash", Commentary: "Commentators" };

/** The Targum, Mishnah, Talmud, Midrash and commentators on a verse of the Hebrew Bible, oldest first. */
export function JewishReaders({ osis }: { osis: string }) {
  const { data, isLoading, error } = useJewish(osis, true);
  if (isLoading) return <div className="skel skel-line" style={{ width: "80%" }} aria-label="Looking up Jewish readers" />;
  if (error || !data) return <p className="muted">Sefaria could not be reached just now.</p>;
  if (!data.sources.length) return <p className="muted">Sefaria links no Targum, Talmud, Midrash or commentary to this verse.</p>;
  const groups = [...new Set(data.sources.map((s) => s.kind))];
  return (
    <>
      {groups.map((k) => (
        <section key={k} className="block jr-group">
          <h3>
            {KIND_LABEL[k]} <span className="count">{data.sources.filter((s) => s.kind === k).length}</span>
          </h3>
          {data.sources
            .filter((s) => s.kind === k)
            .map((s) => (
              <div key={s.ref} className="item jr-item">
                <div className="item-head">
                  <a className="who" href={s.url} target="_blank" rel="noreferrer">
                    {s.title}
                  </a>
                  {!!s.year && <span className="when">{formatYear(s.year)}</span>}
                </div>
                {s.text ? (
                  <p className="text jr-text">
                    {s.text}
                    <span className="muted small"> · tr. {s.translation}, {s.licence}</span>
                  </p>
                ) : (
                  <p className="muted small">
                    <a href={s.url} target="_blank" rel="noreferrer">
                      Read on Sefaria ↗
                    </a>
                    {s.licence ? " (its English translation is not openly licensed, so it is not shown here)" : ""}
                  </p>
                )}
              </div>
            ))}
        </section>
      ))}
      <p className="muted small credit">
        From <a href={data.url ?? "https://www.sefaria.org"}>Sefaria</a>, verse {data.ref}. Quoted only where the translation is public domain or openly licensed;
        the rest are linked. Jewish interpretation, in its own terms. Turn this off in Settings › More sources.
      </p>
    </>
  );
}

// ----------------------------------------------------------------------------- art

/** A strip of paintings and images of a passage or person, each credited; tap one to see it large. */
export function ArtStrip({ query, title = "In art" }: { query: string; title?: string }) {
  const { data } = useArt(query);
  const [open, setOpen] = useState<ArtImage | null>(null);
  useBackClose(!!open, () => setOpen(null));
  const images = (data?.images ?? []).slice(0, 6);
  if (images.length < 2) return null; // one stray match is more likely noise than the scene
  return (
    <section className="book-block online-block art-block">
      <h3>{title}</h3>
      <div className="art-strip">
        {images.map((i) => (
          <button key={i.page} className="art-thumb" onClick={() => setOpen(i)} title={i.title}>
            <img src={i.thumb} alt={i.title} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
          </button>
        ))}
      </div>
      <p className="muted small credit">
        Freely licensed images from <a href="https://commons.wikimedia.org">Wikimedia Commons</a>; tap one for its artist and licence.
      </p>
      {open &&
        createPortal(
          <div className="art-view" role="dialog" aria-label={open.title} onClick={() => setOpen(null)}>
            <figure onClick={(e) => e.stopPropagation()}>
              <img src={open.thumb} alt={open.title} referrerPolicy="no-referrer" />
              <figcaption>
                <strong>{open.title}</strong>
                <span>
                  {[open.artist, open.date].filter(Boolean).join(", ")}
                  {open.artist || open.date ? " · " : ""}
                  {open.licence} ·{" "}
                  <a href={open.page} target="_blank" rel="noreferrer">
                    Wikimedia Commons ↗
                  </a>
                </span>
              </figcaption>
              <button className="icon-btn art-close" onClick={() => setOpen(null)} aria-label="Close">
                ✕
              </button>
            </figure>
          </div>,
          document.body,
        )}
    </section>
  );
}
