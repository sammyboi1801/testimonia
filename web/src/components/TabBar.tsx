import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { lastReadingPath } from "../lib";
import { openAsk, useAskStatus } from "./AskDrawer";

/** Phones: the app's sections in a bar under the thumb, like any native app. (Wide screens keep the top bar.) */
const ICON: Record<string, ReactNode> = {
  bible: <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5m0-15v15m0 0A1.5 1.5 0 0 0 6.5 21H19M12 7v6m-2.5-3.5h5" />,
  library: <path d="M4 20V5m4 15V5m4 15 4-15 4 1-4 15M2 20h20" />,
  search: <path d="m20 20-4.2-4.2M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z" />,
  notes: <path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8l-5-5Zm0 0v5h5M8.5 13h7m-7 3.5h4.5" />,
  ask: <path d="M12 3c.6 4.2 2.8 6.4 7 7-4.2.6-6.4 2.8-7 7-.6-4.2-2.8-6.4-7-7 4.2-.6 6.4-2.8 7-7Zm6 11c.3 1.7 1.2 2.6 3 3-1.8.4-2.7 1.3-3 3-.3-1.7-1.2-2.6-3-3 1.8-.4 2.7-1.3 3-3Z" />,
};

const LIBRARY = /^\/(library|rulers|topics?|plans|parallels|manuscripts?|atlas|place|person|event|domains)\b/;

function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICON[name]}
    </svg>
  );
}

export function TabBar() {
  const { pathname, search } = useLocation();
  const status = useAskStatus();
  const tabs = [
    { id: "bible", label: "Bible", to: pathname.startsWith("/read") ? pathname : lastReadingPath(), on: /^\/(read|book|passage)\b/.test(pathname) },
    { id: "library", label: "Library", to: "/library", on: LIBRARY.test(pathname) },
    { id: "search", label: "Search", to: "/search", on: pathname.startsWith("/search") },
    { id: "notes", label: "Notes", to: "/notes", on: pathname.startsWith("/notes") },
  ];
  const verse = new URLSearchParams(search).get("v");
  const about = verse ? verse.replace(/^([1-4]?[A-Za-z]+)\.(\d+)\.(\d+)$/, "$1 $2:$3") : (/^\/read\/([^/]+)\/(\d+)/.exec(pathname)?.slice(1).join(" ") ?? null);
  return (
    <nav className="tabbar" aria-label="Sections">
      {tabs.map((t) => (
        <Link key={t.id} to={t.to} className={t.on ? "on" : ""} aria-current={t.on ? "page" : undefined}>
          <Icon name={t.id} />
          <span>{t.label}</span>
        </Link>
      ))}
      <button className={`${pathname.startsWith("/ask") ? "on" : ""} ask-${status}`} onClick={() => openAsk(about)} aria-label={status === "ready" ? "Ask — an answer is ready" : status === "working" ? "Ask — working on an answer" : "Ask"}>
        <Icon name="ask" />
        <span>Ask</span>
      </button>
    </nav>
  );
}
