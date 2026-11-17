// What the reader keeps in this browser that the assistant may read: their Bible studies (with what they wrote at
// each step) and their reading plan progress. It travels with each question, like the notes.

import { isoDate } from "../readingApi";
import { studies, type Study } from "../studies";
import { METHODS } from "../studyMethods";

export interface ReaderState {
  studies: StudyBrief[];
  plans: Record<string, { start: string | null; done: number[] }>;
  today: string;
}

interface StudyBrief {
  id: string;
  label: string;
  title?: string;
  method: string;
  at: string;
  finished: boolean;
  updated: string;
  steps: { id: string; title: string; prompt: string; answer: string; help: string }[];
  questions: string[];
}

function brief(s: Study): StudyBrief {
  const steps = METHODS[s.method].steps;
  return {
    id: s.id,
    label: s.label,
    title: s.title,
    method: METHODS[s.method].name,
    at: steps[s.step]?.title ?? "Review",
    finished: !!s.finished,
    updated: s.updated,
    steps: steps.map((st) => ({ id: st.id, title: st.title, prompt: st.prompt, answer: s.answers[st.id] ?? "", help: s.help[st.id] ?? "" })),
    questions: s.questions,
  };
}

export function readerState(): ReaderState {
  let plans: ReaderState["plans"] = {};
  try {
    plans = JSON.parse(localStorage.getItem("testimonia.plans") ?? "{}") as ReaderState["plans"];
  } catch {
    /* none */
  }
  // the 40 most recent studies are plenty, and keep the request small
  const all = Object.values(studies.all()).sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 40);
  return { studies: all.map(brief), plans, today: isoDate(new Date()) };
}

/** A change the assistant made to a study, applied here (studies live in this browser). */
export function applyStudyChange(e: { id: string; questions?: string[]; step?: string; help?: string }): string | null {
  const s = studies.get(e.id);
  if (!s) return null;
  if (e.questions?.length) {
    studies.update(s.id, { questions: [...s.questions, ...e.questions.filter((q) => !s.questions.includes(q))] });
    return `added ${e.questions.length} questions to ${s.label}`;
  }
  if (e.step && e.help) {
    studies.update(s.id, { help: { ...s.help, [e.step]: s.help[e.step] ? `${s.help[e.step]}\n\n${e.help}` : e.help } });
    return `kept help in ${s.label}`;
  }
  return null;
}
