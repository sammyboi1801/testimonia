import { useRef, useState, type ReactNode } from "react";
import { useWiki } from "../api";

export function wikiUrl(title: string): string {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(" ", "_"))}`;
}

/** Wikipedia's lead paragraph and picture for a title, with attribution (text is CC BY-SA 4.0). */
export function WikiCard({ title, compact = false }: { title: string; compact?: boolean }) {
  const { data, isLoading, error } = useWiki(title);
  if (isLoading) return <div className={`wiki-card${compact ? " compact" : ""} loading-wiki`}>Loading Wikipedia…</div>;
  if (error || !data) {
    return (
      <div className={`wiki-card${compact ? " compact" : ""}`}>
        <a href={wikiUrl(title)} target="_blank" rel="noreferrer">
          {title} on Wikipedia ↗
        </a>
      </div>
    );
  }
  const extract = compact && data.extract.length > 420 ? `${data.extract.slice(0, 400).replace(/\s+\S*$/, "")}…` : data.extract;
  return (
    <div className={`wiki-card${compact ? " compact" : ""}`}>
      {data.thumbnail && <img src={data.thumbnail.source} alt="" loading="lazy" />}
      <div>
        {data.description && <div className="wiki-desc">{data.description}</div>}
        <p>{extract}</p>
        <div className="wiki-foot">
          <a href={data.content_urls?.desktop.page ?? wikiUrl(title)} target="_blank" rel="noreferrer">
            Read on Wikipedia ↗
          </a>
          <span>Wikipedia · CC BY-SA 4.0</span>
        </div>
      </div>
    </div>
  );
}

/** Wrap a name: resting on it shows the Wikipedia summary in a small card; clicking opens the article. */
export function WikiHover({ title, children }: { title: string | null | undefined; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  if (!title) return <>{children}</>;
  return (
    <span
      className="wiki-hover"
      onMouseEnter={() => {
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setOpen(true), 350);
      }}
      onMouseLeave={() => {
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setOpen(false), 150);
      }}
    >
      {children}
      <a className="wiki-link" href={wikiUrl(title)} target="_blank" rel="noreferrer" title={`${title} on Wikipedia`} onClick={(e) => e.stopPropagation()}>
        W
      </a>
      {open && (
        <span className="wiki-pop" role="tooltip">
          <WikiCard title={title} compact />
        </span>
      )}
    </span>
  );
}
