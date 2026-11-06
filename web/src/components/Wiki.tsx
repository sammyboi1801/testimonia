import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
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

/** Wrap a name: resting on it shows the Wikipedia summary in a small card; clicking opens the article.
 *  The card is rendered at page level (a portal), so panels that clip or scroll never hide it. */
export function WikiHover({ title, children }: { title: string | null | undefined; children: ReactNode }) {
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const anchor = useRef<HTMLSpanElement>(null);
  if (!title) return <>{children}</>;
  const show = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const up = r.bottom + 260 > window.innerHeight;
      setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 356)), top: up ? r.top - 6 : r.bottom + 6, up });
    }, 300);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPos(null), 180);
  };
  return (
    <span className="wiki-hover" ref={anchor} onMouseEnter={show} onMouseLeave={hide}>
      {children}
      <a className="wiki-link" href={wikiUrl(title)} target="_blank" rel="noreferrer" title={`${title} on Wikipedia`} onClick={(e) => e.stopPropagation()}>
        W
      </a>
      {pos &&
        createPortal(
          <span
            className={`wiki-pop${pos.up ? " up" : ""}`}
            role="tooltip"
            style={{ left: pos.left, top: pos.top }}
            onMouseEnter={() => window.clearTimeout(timer.current)}
            onMouseLeave={hide}
          >
            <WikiCard title={title} compact />
          </span>,
          document.body,
        )}
    </span>
  );
}
