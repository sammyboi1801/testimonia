import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Book } from "../types";

const GROUPS: { id: Book["testament"]; label: string }[] = [
  { id: "OT", label: "Old Testament" },
  { id: "NT", label: "New Testament" },
  { id: "DC", label: "Deuterocanon" },
];

/** "John 1 ▾" — a popover with every book, then that book's chapters. Replaces the old sidebar. */
export function PassagePicker({ books, book, chapter }: { books: Book[]; book: string; chapter: number }) {
  // ?picker in the URL opens it (screenshots, links)
  const [open, setOpen] = useState(() => new URLSearchParams(window.location.search).has("picker"));
  const [picked, setPicked] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const current = books.find((b) => b.osis === book);
  const chosen = books.find((b) => b.osis === (picked ?? book));
  // "1 co", "rom 8", "song": match the start of the name or of any word in it, with an optional chapter
  const m = /^(.*?)\s*(\d+)?$/.exec(filter.trim().toLowerCase());
  const text = (m?.[1] || filter.trim().toLowerCase()).replace(/\s+/g, " ");
  const wantCh = m?.[2] && m[1] ? Number(m[2]) : null;
  const matches = (b: Book) => {
    if (!text) return true;
    const name = b.name.toLowerCase();
    return name.startsWith(text) || name.split(/\s+/).some((w) => w.startsWith(text)) || b.osis.toLowerCase().startsWith(text);
  };
  const shown = books.filter(matches);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  function go(osis: string, ch: number) {
    setOpen(false);
    setPicked(null);
    setFilter("");
    navigate(`/read/${osis}/${ch}`);
  }

  return (
    <div className="picker" ref={ref}>
      <button className="picker-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="picker-title">
          {current?.name ?? book} {chapter}
        </span>
        <span className="caret">▾</span>
      </button>
      {open && (
        <div className="picker-pop" role="dialog" aria-label="Choose a passage">
          <div className="picker-books">
            <input
              className="picker-filter"
              autoFocus
              value={filter}
              placeholder="Type a book — e.g. 1 co, rom 8, psalm 23"
              aria-label="Filter books"
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || !shown.length) return;
                const b = shown[0]!;
                if (wantCh && wantCh <= b.chapters) go(b.osis, wantCh);
                else if (b.chapters === 1) go(b.osis, 1);
                else setPicked(b.osis);
              }}
            />
            {!shown.length && <p className="muted small">No book matches “{filter}”.</p>}
            {GROUPS.filter((g) => shown.some((b) => b.testament === g.id)).map((g) => (
              <section key={g.id}>
                <h4>{g.label}</h4>
                <div className="book-grid">
                  {shown
                    .filter((b) => b.testament === g.id)
                    .map((b) => (
                      <button
                        key={b.osis}
                        className={b.osis === chosen?.osis ? "on" : ""}
                        onClick={() => (b.chapters === 1 ? go(b.osis, 1) : setPicked(b.osis))}
                        title={[b.hebrew_name, b.greek_name, b.latin_name].filter(Boolean).join(" · ")}
                      >
                        {b.name}
                      </button>
                    ))}
                </div>
              </section>
            ))}
          </div>
          {chosen && (
            <div className="picker-chapters">
              <h4>{chosen.name}</h4>
              <div className="chapter-grid">
                {Array.from({ length: chosen.chapters }, (_, i) => i + 1).map((c) => (
                  <button
                    key={c}
                    className={`${chosen.osis === book && c === chapter ? "on" : ""}${wantCh === c && shown[0]?.osis === chosen.osis ? " hint" : ""}`}
                    onClick={() => go(chosen.osis, c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
