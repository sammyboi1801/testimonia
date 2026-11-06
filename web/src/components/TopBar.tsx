import { useState, type FormEvent } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { resolveRef } from "../api";
import { verseUrl } from "../lib";
import { DESIGNS, useSettings, type Design, type Theme } from "../settings";

const NEXT_THEME: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
const THEME_ICON: Record<Theme, string> = { system: "◐", light: "☀", dark: "☾" };

export function TopBar() {
  const navigate = useNavigate();
  const { settings, update } = useSettings();
  const [q, setQ] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    const text = q.trim();
    if (!text) return;
    try {
      const ref = await resolveRef(text);
      navigate(ref.verse ? verseUrl(ref.osis) : `/read/${ref.book}/${ref.chapter}`);
    } catch {
      navigate(`/search?q=${encodeURIComponent(text)}`);
    }
  }

  return (
    <header className="topbar">
      <NavLink to="/" className="brand" title="Testimonia">
        <span className="brand-mark" aria-hidden>
          ☧
        </span>
        <span className="brand-name">Testimonia</span>
      </NavLink>
      <form className="omnibox" onSubmit={submit} role="search">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Go to a passage (jn 1:18, Isa 53) or search everything…"
          aria-label="Passage or search"
        />
      </form>
      <nav className="topnav">
        <NavLink to="/read/John/1">Bible</NavLink>
        <NavLink to="/library">Library</NavLink>
        <NavLink to="/search">Search</NavLink>
      </nav>
      <div className="topbar-tools">
        <select
          className="design-select"
          value={settings.design}
          onChange={(e) => update({ design: e.target.value as Design })}
          title="Design"
          aria-label="Design"
        >
          {DESIGNS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label} — {d.note}
            </option>
          ))}
        </select>
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
      </div>
    </header>
  );
}
