// Personal notes and highlights, kept in this browser only (no account, nothing sent anywhere).
// Export/import moves them between devices.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { onRemoteChange } from "./sync";

export const HIGHLIGHTS = [
  { id: "gold", label: "Gold" },
  { id: "green", label: "Green" },
  { id: "blue", label: "Blue" },
  { id: "rose", label: "Rose" },
  { id: "violet", label: "Violet" },
] as const;
export type Highlight = (typeof HIGHLIGHTS)[number]["id"];

/** A highlighted phrase: character range [start, end) of the verse text in one edition. */
export interface Mark {
  ed: string;
  start: number;
  end: number;
  color: Highlight;
}

export interface Note {
  osis: string; // 'John.1.18'
  text: string;
  highlight: Highlight | null; // the whole verse
  marks?: Mark[]; // phrases
  created: string; // ISO
  updated: string;
}

const KEY = "testimonia.notes.v1";

function load(): Record<string, Note> {
  try {
    const raw = localStorage.getItem(KEY);
    const data = raw ? (JSON.parse(raw) as Record<string, Note>) : {};
    return typeof data === "object" && data ? data : {};
  } catch {
    return {};
  }
}

interface Ctx {
  notes: Record<string, Note>;
  get: (osis: string) => Note | undefined;
  set: (osis: string, patch: Partial<Pick<Note, "text" | "highlight" | "marks">>) => void;
  addMark: (osis: string, mark: Mark) => void;
  clearMarks: (osis: string, ed: string, start: number, end: number) => void;
  remove: (osis: string) => void;
  importNotes: (incoming: unknown) => number;
}

const NotesContext = createContext<Ctx | null>(null);

export function NotesProvider({ children }: { children: ReactNode }) {
  const [notes, setNotes] = useState<Record<string, Note>>(load);
  const latest = useRef(notes);
  latest.current = notes;
  // signed in: notes changed on another device arrive here
  useEffect(() => {
    return onRemoteChange(KEY, () => setNotes(load()));
  }, []);

  // keep tabs in step: a note written in one tab appears in the others
  useEffect(() => {
    const on = (e: StorageEvent) => e.key === KEY && setNotes(load());
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
  }, []);

  const persist = useCallback((next: Record<string, Note>) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* storage full or unavailable: keep in memory */
    }
    return next;
  }, []);

  const set = useCallback(
    (osis: string, patch: Partial<Pick<Note, "text" | "highlight" | "marks">>) =>
      setNotes((all) => {
        const now = new Date().toISOString();
        const prev = all[osis] ?? { osis, text: "", highlight: null, created: now, updated: now };
        const note = { ...prev, ...patch, updated: now };
        const next = { ...all };
        if (!note.text.trim() && !note.highlight && !note.marks?.length) delete next[osis];
        else next[osis] = note;
        return persist(next);
      }),
    [persist],
  );

  const remove = useCallback(
    (osis: string) =>
      setNotes((all) => {
        const next = { ...all };
        delete next[osis];
        return persist(next);
      }),
    [persist],
  );

  /** Merge notes from an export (newer edits win; empty or malformed entries are skipped). Returns how many were added or updated. */
  const importNotes = useCallback(
    (incoming: unknown) => {
      const list = Array.isArray(incoming) ? incoming : incoming && typeof incoming === "object" ? Object.values(incoming as object) : [];
      const next = { ...latest.current };
      let n = 0;
      for (const raw of list as Partial<Note>[]) {
        if (!raw || typeof raw.osis !== "string" || !/^[1-4]?[A-Za-z]+\.\d+\.\d+$/.test(raw.osis)) continue;
        const note: Note = {
          osis: raw.osis,
          text: typeof raw.text === "string" ? raw.text : "",
          highlight: HIGHLIGHTS.some((h) => h.id === raw.highlight) ? (raw.highlight as Highlight) : null,
          marks: cleanMarks(raw.marks),
          created: typeof raw.created === "string" ? raw.created : new Date().toISOString(),
          updated: typeof raw.updated === "string" ? raw.updated : new Date().toISOString(),
        };
        if (!note.text.trim() && !note.highlight && !note.marks?.length) continue;
        const cur = next[note.osis];
        if (!cur || cur.updated < note.updated) {
          next[note.osis] = note;
          n++;
        }
      }
      if (n) {
        latest.current = next;
        setNotes(persist(next));
      }
      return n;
    },
    [persist],
  );

  /** Highlight a phrase; it replaces any overlapping highlight in the same edition. */
  const addMark = useCallback(
    (osis: string, mark: Mark) => {
      const others = (latest.current[osis]?.marks ?? []).filter((m) => m.ed !== mark.ed || m.end <= mark.start || m.start >= mark.end);
      set(osis, { marks: [...others, mark].sort((a, b) => a.start - b.start) });
    },
    [set],
  );
  const clearMarks = useCallback(
    (osis: string, ed: string, start: number, end: number) => {
      const marks = (latest.current[osis]?.marks ?? []).filter((m) => m.ed !== ed || m.end <= start || m.start >= end);
      set(osis, { marks });
    },
    [set],
  );

  const value = useMemo(
    () => ({ notes, get: (o: string) => notes[o], set, remove, importNotes, addMark, clearMarks }),
    [notes, set, remove, importNotes, addMark, clearMarks],
  );
  return <NotesContext.Provider value={value}>{children}</NotesContext.Provider>;
}

export function useNotes(): Ctx {
  const ctx = useContext(NotesContext);
  if (!ctx) throw new Error("useNotes must be used inside <NotesProvider>");
  return ctx;
}

function cleanMarks(raw: unknown): Mark[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw.filter(
    (m): m is Mark =>
      !!m &&
      typeof m.ed === "string" &&
      Number.isInteger(m.start) &&
      Number.isInteger(m.end) &&
      m.start >= 0 &&
      m.end > m.start &&
      HIGHLIGHTS.some((h) => h.id === m.color),
  );
  return out.length ? out : undefined;
}
