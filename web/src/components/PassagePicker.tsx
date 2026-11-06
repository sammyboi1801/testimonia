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
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const current = books.find((b) => b.osis === book);
  const chosen = books.find((b) => b.osis === (picked ?? book));

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
            {GROUPS.map((g) => (
              <section key={g.id}>
                <h4>{g.label}</h4>
                <div className="book-grid">
                  {books
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
                    className={chosen.osis === book && c === chapter ? "on" : ""}
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
