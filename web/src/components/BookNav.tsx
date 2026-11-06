import { useState } from "react";
import { Link } from "react-router-dom";
import type { Book } from "../types";

const GROUPS: { id: Book["testament"]; label: string }[] = [
  { id: "OT", label: "Old Testament" },
  { id: "NT", label: "New Testament" },
  { id: "DC", label: "Deuterocanon / Apocrypha" },
];

export function BookNav({ books, current, chapter }: { books: Book[]; current: string; chapter: number }) {
  const [open, setOpen] = useState<string | null>(current);
  return (
    <nav className="booknav" aria-label="Books">
      {GROUPS.map((g) => {
        const list = books.filter((b) => b.testament === g.id);
        if (!list.length) return null;
        return (
          <section key={g.id}>
            <h3>{g.label}</h3>
            <ul>
              {list.map((b) => (
                <li key={b.osis} className={b.osis === current ? "current" : ""}>
                  <button
                    className="book-btn"
                    onClick={() => setOpen(open === b.osis ? null : b.osis)}
                    aria-expanded={open === b.osis}
                    title={[b.hebrew_name, b.greek_name, b.latin_name].filter(Boolean).join(" · ")}
                  >
                    {b.name}
                  </button>
                  {open === b.osis && (
                    <div className="chapter-grid">
                      {Array.from({ length: b.chapters }, (_, i) => i + 1).map((c) => (
                        <Link
                          key={c}
                          to={`/read/${b.osis}/${c}`}
                          className={b.osis === current && c === chapter ? "active" : ""}
                        >
                          {c}
                        </Link>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </nav>
  );
}
