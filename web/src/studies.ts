import { useSyncExternalStore } from "react";
import { onRemoteChange } from "./sync";

/**
 * Bible studies: a passage worked through step by step (a short devotional, or an in-depth study), with the
 * reader's answers, saved help from the assistant, and questions for a group. Kept in this browser like the notes,
 * and synced with the account when signed in.
 */
export type Method = "devotional" | "deep";

export interface Study {
  id: string;
  ref: string; // 'John.3.1-John.3.21'
  label: string; // 'John 3:1–21'
  title?: string; // the section's heading, 'Jesus and Nicodemus'
  method: Method;
  step: number; // where the reader is
  answers: Record<string, string>; // step id -> what the reader wrote
  help: Record<string, string>; // step id -> the assistant's answer the reader kept
  questions: string[]; // for a group
  carry?: string; // the verse to carry today (osis)
  done: string[]; // steps finished
  finished?: string; // ISO, when the last step was done
  created: string;
  updated: string;
}

const KEY = "testimonia.studies.v1";
let state: Record<string, Study> = load();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
onRemoteChange(KEY, () => {
  state = load();
  emit();
});
if (typeof window !== "undefined")
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) {
      state = load();
      emit();
    }
  });

function load(): Record<string, Study> {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as Record<string, Study> | null;
    return s && typeof s === "object" ? s : {};
  } catch {
    return {};
  }
}
function commit(next: Record<string, Study>) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage full or unavailable: kept for this visit */
  }
  emit();
}

export const studies = {
  get: (id: string): Study | undefined => state[id],
  all: () => state,
  create(ref: string, label: string, method: Method, title?: string): Study {
    const now = new Date().toISOString();
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const s: Study = { id, ref, label, title, method, step: 0, answers: {}, help: {}, questions: [], done: [], created: now, updated: now };
    commit({ ...state, [id]: s });
    return s;
  },
  update(id: string, patch: Partial<Omit<Study, "id" | "created">>) {
    const cur = state[id];
    if (!cur) return;
    commit({ ...state, [id]: { ...cur, ...patch, updated: new Date().toISOString() } });
  },
  remove(id: string) {
    const next = { ...state };
    delete next[id];
    commit(next);
  },
};

export function useStudies(): Record<string, Study> {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export function useStudy(id: string): Study | undefined {
  return useStudies()[id];
}

/** Newest first. */
export function sortedStudies(all: Record<string, Study>): Study[] {
  return Object.values(all).sort((a, b) => b.updated.localeCompare(a.updated));
}

/** The study in progress most recently touched (for "Continue your study"). */
export function currentStudy(all: Record<string, Study>): Study | undefined {
  return sortedStudies(all).find((s) => !s.finished);
}

/** Does a study's passage include this verse? Within one book, by chapter and verse. */
export function covers(ref: string, osis: string): boolean {
  const [from, to = from] = ref.split("-");
  const [b, c, v] = osis.split(".");
  const [fb, fc, fv] = from!.split(".");
  const [tb, tc, tv] = to!.split(".");
  if (b !== fb || b !== tb) return false;
  const k = (ch?: string, vs?: string) => Number(ch) * 1000 + Number(vs);
  return k(c, v) >= k(fc, fv) && k(c, v) <= k(tc, tv);
}
