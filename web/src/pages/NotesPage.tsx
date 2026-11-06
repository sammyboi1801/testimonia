import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { Link } from "react-router-dom";
import { useMeta } from "../api";
import { osisLabel, verseUrl } from "../lib";
import { HIGHLIGHTS, useNotes, type Note } from "../notes";

function download(name: string, text: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Every note and highlight, in Bible order, with search, export and import. */
export function NotesPage() {
  const { notes, set, remove, importNotes } = useNotes();
  const books = useMeta().data?.books ?? [];
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<string>("");
  const [msg, setMsg] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const order = useMemo(() => new Map(books.map((b) => [b.osis, b.ord])), [books]);

  const list = useMemo(() => {
    const key = (n: Note) => {
      const [b, c, v] = n.osis.split(".");
      return (order.get(b!) ?? 999) * 1_000_000 + Number(c) * 1000 + Number(v);
    };
    return Object.values(notes)
      .filter((n) => (!only || n.highlight === only) && (!q || `${osisLabel(n.osis, books)} ${n.text}`.toLowerCase().includes(q.toLowerCase())))
      .sort((a, b) => key(a) - key(b));
  }, [notes, q, only, order, books]);

  const total = Object.keys(notes).length;

  function exportMarkdown() {
    const lines = ["# My notes — Testimonia", ""];
    for (const n of list) {
      lines.push(`## ${osisLabel(n.osis, books)}${n.highlight ? ` (${n.highlight})` : ""}`, "", n.text || "_highlighted_", "");
    }
    download("testimonia-notes.md", lines.join("\n"), "text/markdown");
  }
  async function importFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      const n = importNotes(JSON.parse(await f.text()));
      setMsg(`Imported ${n} note${n === 1 ? "" : "s"} from ${f.name}.`);
    } catch {
      setMsg(`${f.name} is not a Testimonia notes file.`);
    }
  }

  return (
    <div className="page notes-page">
      <h1>My notes</h1>
      <p className="muted">
        {total} note{total === 1 ? "" : "s"} and highlights, kept in this browser only — no account, nothing leaves your device. Export them to keep a copy or move
        them to another device.
      </p>
      <div className="notes-tools">
        <input className="shelf-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search my notes…" />
        <span className="hl-swatches">
          {HIGHLIGHTS.map((h) => (
            <button key={h.id} className={`hl-swatch hl-${h.id}${only === h.id ? " on" : ""}`} title={`Only ${h.label.toLowerCase()}`} onClick={() => setOnly(only === h.id ? "" : h.id)} />
          ))}
        </span>
        <span className="notes-io">
          <button className="btn" onClick={() => download("testimonia-notes.json", JSON.stringify(Object.values(notes), null, 2), "application/json")} disabled={!total}>
            Export
          </button>
          <button className="btn" onClick={exportMarkdown} disabled={!list.length}>
            Markdown
          </button>
          <button className="btn" onClick={() => file.current?.click()}>
            Import…
          </button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={importFile} />
        </span>
      </div>
      {msg && <p className="set-note">{msg}</p>}
      {total === 0 && (
        <div className="empty-state">
          No notes yet. In the <Link to="/read/John/1">reader</Link>, choose a verse and use “My note” in the study panel to highlight it or write a note.
        </div>
      )}
      <ul className="notes-list">
        {list.map((n) => (
          <li key={n.osis} className={n.highlight ? `hl-${n.highlight}` : ""}>
            <div className="note-head">
              <Link to={verseUrl(n.osis)}>{osisLabel(n.osis, books)}</Link>
              <span className="muted small">{new Date(n.updated).toLocaleDateString()}</span>
              <button className="link-btn" onClick={() => window.confirm(`Delete your note on ${osisLabel(n.osis, books)}?`) && remove(n.osis)}>
                Delete
              </button>
            </div>
            <textarea className="my-note-text" defaultValue={n.text} rows={Math.min(8, Math.max(2, n.text.split("\n").length))} onBlur={(e) => e.target.value !== n.text && set(n.osis, { text: e.target.value })} placeholder="Highlighted — add a note…" />
          </li>
        ))}
      </ul>
    </div>
  );
}
