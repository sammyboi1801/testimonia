import { useCallback, useState, type FormEvent } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { resolveRef } from "../api";
import { verseUrl } from "../lib";
import { useSettings, type Theme } from "../settings";
import { SettingsPane } from "./SettingsPane";

const NEXT_THEME: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
const THEME_ICON: Record<Theme, string> = { system: "◐", light: "☀", dark: "☾" };

const narrow = typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches;

export function TopBar() {
  const navigate = useNavigate();
  // phones: a ‹ back button whenever there is somewhere in the app to go back to (installed apps have no browser Back)
  const canGoBack = useLocation().key !== "default";
  const { settings, update } = useSettings();
  const [q, setQ] = useState("");
  // ?settings in the URL opens the pane (handy for screenshots and links to settings)
  const [showSettings, setShowSettings] = useState(() => new URLSearchParams(window.location.search).has("settings"));
  const closeSettings = useCallback(() => setShowSettings(false), []);
  const [menu, setMenu] = useState(false); // phones: links and tools fold into a menu
  const close = () => setMenu(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const text = q.trim();
    if (!text) return;
    try {
      const ref = await resolveRef(text);
      navigate(ref.verse ? verseUrl(ref.osis, undefined, ref.to) : `/read/${ref.book}/${ref.chapter}`);
    } catch {
      navigate(`/search?q=${encodeURIComponent(text)}`);
    }
  }

  return (
    <header className={`topbar${menu ? " menu-open" : ""}`}>
      {canGoBack && (
        <button className="icon-btn back-btn" onClick={() => navigate(-1)} aria-label="Back" title="Back">
          ‹
        </button>
      )}
      <NavLink to="/" className={`brand${canGoBack ? " has-back" : ""}`} title="Testimonia">
        <img className="brand-mark" src="/favicon.svg" alt="" width="28" height="28" />
        <span className="brand-name">Testimonia</span>
      </NavLink>
      <form className="omnibox" onSubmit={submit} role="search">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={narrow ? "Passage or search…" : "Go to a passage (jn 1:18, Isa 53) or search everything…"}
          aria-label="Passage or search"
        />
      </form>
      <button className="icon-btn menu-btn" aria-label="Display and settings" title="Display and settings" aria-expanded={menu} onClick={() => setMenu(!menu)}>
        {menu ? "✕" : "⋯"}
      </button>
      <div className="topbar-menu" onClick={(e) => (e.target as HTMLElement).closest("a") && close()}>
      <nav className="topnav">
        <NavLink to="/read/John/1">Bible</NavLink>
        <NavLink to="/library">Library</NavLink>
        <NavLink to="/search">Search</NavLink>
        <NavLink to="/notes">Notes</NavLink>
        <NavLink to="/ask">Ask</NavLink>
      </nav>
      <div className="topbar-tools">
        <button
          className="icon-btn"
          title="Smaller text"
          onClick={() => update({ fontScale: Math.max(0.8, +(settings.fontScale - 0.1).toFixed(2)) })}
        >
          A−
        </button>
        <button
          className="icon-btn"
          title="Larger text"
          onClick={() => update({ fontScale: Math.min(1.6, +(settings.fontScale + 0.1).toFixed(2)) })}
        >
          A+
        </button>
        <button
          className="icon-btn"
          title={`Theme: ${settings.theme} (click to change)`}
          onClick={() => update({ theme: NEXT_THEME[settings.theme] })}
        >
          {THEME_ICON[settings.theme]}
        </button>
        <button
          className="icon-btn gear"
          title="Settings"
          aria-label="Settings"
          onClick={() => {
            close();
            setShowSettings(true);
          }}
        >
          <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden>
            <path
              d="M10 6.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8Zm7 4.5v-2.2l-2-.4a5.6 5.6 0 0 0-.6-1.4l1.1-1.7-1.5-1.5-1.7 1.1a5.6 5.6 0 0 0-1.4-.6l-.4-2H8.9l-.4 2a5.6 5.6 0 0 0-1.4.6L5.4 3.9 3.9 5.4 5 7.1a5.6 5.6 0 0 0-.6 1.4l-2 .4v2.2l2 .4c.1.5.3 1 .6 1.4l-1.1 1.7 1.5 1.5 1.7-1.1c.4.3.9.5 1.4.6l.4 2h2.2l.4-2c.5-.1 1-.3 1.4-.6l1.7 1.1 1.5-1.5-1.1-1.7c.3-.4.5-.9.6-1.4l2-.4Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      </div>
      {showSettings && <SettingsPane onClose={closeSettings} />}
    </header>
  );
}
