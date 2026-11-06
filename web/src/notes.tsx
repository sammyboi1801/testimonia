// Personal notes and highlights, kept in this browser only (no account, nothing sent anywhere).
// Export/import moves them between devices.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export const HIGHLIGHTS = [
  { id: "gold", label: "Gold" },
  { id: "green", label: "Green" },
  { id: "blue", label: "Blue" },
  { id: "rose", label: "Rose" },
  { id: "violet", label: "Violet" },
] as const;
export type Highlight = (typeof HIGHLIGHTS)[number]["id"];

export interface Note {
  osis: string; // 'John.1.18'
  text: string;
  highlight: Highlight | null;
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
  set: (osis: string, patch: Partial<Pick<Note, "text" | "highlight">>) => void;
  remove: (osis: string) => void;
  importNotes: (incoming: unknown) => number;
}

const NotesContext = createContext<Ctx | null>(null);

export function NotesProvider({ children }: { children: ReactNode }) {
  const [notes, setNotes] = useState<Record<string, Note>>(load);
  const latest = useRef(notes);
  latest.current = notes;

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
    (osis: string, patch: Partial<Pick<Note, "text" | "highlight">>) =>
      setNotes((all) => {
        const now = new Date().toISOString();
        const prev = all[osis] ?? { osis, text: "", highlight: null, created: now, updated: now };
        const note = { ...prev, ...patch, updated: now };
        const next = { ...all };
        if (!note.text.trim() && !note.highlight) delete next[osis];
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
          created: typeof raw.created === "string" ? raw.created : new Date().toISOString(),
          updated: typeof raw.updated === "string" ? raw.updated : new Date().toISOString(),
        };
        if (!note.text.trim() && !note.highlight) continue;
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

  const value = useMemo(() => ({ notes, get: (o: string) => notes[o], set, remove, importNotes }), [notes, set, remove, importNotes]);
  return <NotesContext.Provider value={value}>{children}</NotesContext.Provider>;
}

export function useNotes(): Ctx {
  const ctx = useContext(NotesContext);
  if (!ctx) throw new Error("useNotes must be used inside <NotesProvider>");
  return ctx;
}
