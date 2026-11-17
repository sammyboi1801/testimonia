import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { useQueries } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { chapterQuery, useMeta } from "../api";
import { osisLabel, verseUrl } from "../lib";
import { HIGHLIGHTS, useNotes, type Note } from "../notes";
import { useSync } from "../sync";
import { useSettings } from "../settings";
import { spanLabel } from "../components/SelectionToolbar";
import { CopyMenu } from "../components/CopyCitation";
import { colourOf, groupNotes, type NoteGroup } from "./noteGroups";
import type { Book } from "../types";

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
  const sync = useSync();
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
    return Object.values(notes).sort((a, b) => key(a) - key(b));
  }, [notes, order]);
  const groups = useMemo(() => groupNotes(list), [list]);
  const label = (g: NoteGroup) => spanLabel(g.notes[0]!.osis, g.notes[g.notes.length - 1]!.osis, (o) => osisLabel(o, books));
  const shown = groups.filter(
    (g) => (!only || g.colour === only) && (!q || `${label(g)} ${g.notes.map((n) => n.text).join(" ")}`.toLowerCase().includes(q.toLowerCase())),
  );
  const total = groups.length;

  function exportMarkdown() {
    const lines = ["# My highlights and notes (Testimonia)", ""];
    for (const g of shown) {
      const text = g.notes.map((n) => n.text.trim()).filter(Boolean).join("\n\n");
      lines.push(`## ${label(g)}${g.colour ? ` (${g.colour})` : ""}`, "", text || "_highlighted_", "");
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
      <h1>My highlights and notes</h1>
      <p className="muted">
        {countLine(groups.filter((g) => g.colour).length, list.filter((n) => n.text.trim()).length)}{" "}
        {sync.user
          ? "Saved in this browser and synced to your account."
          : "Saved in this browser. Sign in to sync them between devices, or export them to keep a copy."}
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
          <button className="btn" onClick={exportMarkdown} disabled={!shown.length}>
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
          Nothing here yet. In the <Link to="/read/John/1">reader</Link>, tap a verse and choose Highlight or Note. Everything you mark shows up here.
        </div>
      )}
      <ul className="notes-list">
        {shown.map((g) => (
          <NoteCard key={g.notes[0]!.osis} group={g} label={label(g)} books={books} onSet={set} onRemove={remove} />
        ))}
      </ul>
    </div>
  );
}

/** "3 highlights and 1 note." */
function countLine(highlights: number, notes: number): string {
  const n = (k: number, word: string) => `${k} ${word}${k === 1 ? "" : "s"}`;
  if (!highlights && !notes) return "No highlights or notes yet.";
  if (!notes) return `${n(highlights, "highlight")}.`;
  if (!highlights) return `${n(notes, "note")}.`;
  return `${n(highlights, "highlight")} and ${n(notes, "note")}.`;
}

/** One highlight: the passage as highlighted (whole verses, or the words picked), and its note. */
function NoteCard({
  group,
  label,
  books,
  onSet,
  onRemove,
}: {
  group: NoteGroup;
  label: string;
  books: Book[];
  onSet: (osis: string, patch: { text: string }) => void;
  onRemove: (osis: string) => void;
}) {
  const { settings } = useSettings();
  const first = group.notes[0]!;
  const last = group.notes[group.notes.length - 1]!;
  const [book, ch] = first.osis.split(".");
  // the words were picked in one translation: show that one, else the reader's first column
  const ed = first.marks?.[0]?.ed ?? settings.editions[0] ?? "kjva";
  const [chapter] = useQueries({ queries: [chapterQuery(book!, Number(ch), [ed])] });
  const verses = chapter?.data?.verses;
  const holder = group.notes.find((n) => n.text.trim()) ?? first; // the note this card edits
  const updated = group.notes.reduce((t, n) => (n.updated > t ? n.updated : t), "");
  const many = group.notes.length > 1;
  const abbrev = useMeta().data?.editions.find((e) => e.id === ed)?.abbrev ?? ed;
  // to share: the words highlighted (the whole verse when it was highlighted whole)
  const shared = verses
    ? group.notes.flatMap((n) => {
        const t = verses.find((v) => v.osis === n.osis)?.texts[ed]?.text;
        if (!t) return [];
        const marks = (n.marks ?? []).filter((m) => m.ed === ed).sort((x, y) => x.start - y.start);
        const text = n.highlight || !marks.length ? t : marks.map((m) => t.slice(m.start, m.end)).join(" … ");
        return [{ verse: Number(n.osis.split(".")[2]), text }];
      })
    : [];
  const shareUrl = `https://testimonia.web.app/v/${encodeURIComponent(many ? `${first.osis}-${last.osis}` : first.osis)}`;

  return (
    <li className={group.colour ? `hl-${group.colour}` : ""}>
      <div className="note-head">
        <Link to={verseUrl(first.osis, undefined, many ? Number(last.osis.split(".")[2]) : undefined)}>{label}</Link>
        <span className="muted small">{updated ? new Date(updated).toLocaleDateString() : ""}</span>
        <CopyMenu passage={shared.length ? { label, edition: abbrev, verses: shared } : null} className="link-btn" shareUrl={shareUrl} />
        <button
          className="link-btn"
          onClick={() => window.confirm(`Delete your ${group.colour ? "highlight" : "note"} on ${label}?`) && group.notes.forEach((n) => onRemove(n.osis))}
        >
          Delete
        </button>
      </div>
      {group.colour && (
        <p className="note-passage">
          {group.notes.map((n) => {
            const t = verses?.find((v) => v.osis === n.osis)?.texts[ed]?.text;
            if (!t) return null;
            const marks = (n.marks ?? []).filter((m) => m.ed === ed).sort((x, y) => x.start - y.start);
            const parts: React.ReactNode[] = [];
            if (n.highlight || !marks.length) parts.push(<span key="all" className={`note-hl hl-${colourOf(n)}`}>{t}</span>);
            else {
              let at = 0;
              for (const m of marks) {
                if (m.start > at) parts.push(<span key={`r${at}`} className="note-rest">{t.slice(at, m.start)}</span>);
                parts.push(<span key={m.start} className={`note-hl hl-${m.color}`}>{t.slice(m.start, m.end)}</span>);
                at = Math.max(at, m.end);
              }
              if (at < t.length) parts.push(<span key="rest" className="note-rest">{t.slice(at)}</span>);
            }
            return (
              <span key={n.osis}>
                {many && <sup className="note-vn">{n.osis.split(".")[2]}</sup>}
                {parts}{" "}
              </span>
            );
          })}
          {!verses && <span className="skel skel-line" aria-label={`Loading ${osisLabel(first.osis, books)}`} />}
        </p>
      )}
      <textarea
        className="my-note-text"
        defaultValue={holder.text}
        rows={Math.min(8, Math.max(2, holder.text.split("\n").length))}
        onBlur={(e) => e.target.value !== holder.text && onSet(holder.osis, { text: e.target.value })}
        placeholder="Add a note…"
      />
    </li>
  );
}
