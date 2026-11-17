// The two ways to study a passage, their steps, and what the assistant is asked at each one.
import type { Method, Study } from "./studies";

export interface AiAction {
  id: string;
  label: string;
  /** Asks a question of its own (typed by the reader) */
  input?: string;
  /** Answers come back as a list of questions the reader can add to the study */
  questions?: boolean;
  ask: (s: Study, typed?: string) => string;
}

export interface StepDef {
  id: string;
  title: string;
  lead: string; // one friendly line under the title
  prompt: string;
  placeholder: string;
  ai: AiAction[];
}

export const METHODS: Record<Method, { name: string; time: string; blurb: string; steps: StepDef[] }> = {
  devotional: {
    name: "Devotional",
    time: "About 10 minutes",
    blurb: "Read, reflect and pray, then take one verse into your day.",
    steps: [
      {
        id: "read",
        title: "Read",
        lead: "Read the passage slowly. Then read it once more.",
        prompt: "What is happening here?",
        placeholder: "In a sentence or two…",
        ai: [{ id: "scene", label: "Set the scene", ask: (s) => scene(s) }],
      },
      {
        id: "reflect",
        title: "Reflect",
        lead: "Notice what speaks to you today.",
        prompt: "What stands out to you? A word, a promise, a question.",
        placeholder: "What I noticed…",
        ai: [
          {
            id: "questions",
            label: "Give me questions to think about",
            ask: (s) => `${style(110)}\nGive me 3 short questions to reflect on ${s.label} personally. Tie each one to a specific verse and say which. Only the questions, as a numbered list.`,
          },
        ],
      },
      {
        id: "pray",
        title: "Pray",
        lead: "Talk to God about what you read.",
        prompt: "Write a short prayer from this passage.",
        placeholder: "Lord…",
        ai: [
          {
            id: "prayer",
            label: "Help me start",
            ask: (s) =>
              `${style(110)}\nHelp me begin a prayer from ${s.label}, using the passage's own words and promises. Four to six short lines, addressed to God, simple and personal. It is a starting point I will make my own.${mine(s, "reflect", "What stood out to me")}`,
          },
        ],
      },
      {
        id: "carry",
        title: "Take it with you",
        lead: "Choose one verse to carry into your day.",
        prompt: "Why this verse?",
        placeholder: "Optional",
        ai: [],
      },
    ],
  },
  deep: {
    name: "In depth",
    time: "30 to 45 minutes",
    blurb: "Read, observe, understand and apply, with the library beside you at each step.",
    steps: [
      {
        id: "read",
        title: "Read",
        lead: "Read the whole passage before anything else. Where does it sit in the story?",
        prompt: "In one sentence, what is this passage about?",
        placeholder: "This passage is about…",
        ai: [{ id: "scene", label: "Set the scene", ask: (s) => scene(s) }],
      },
      {
        id: "observe",
        title: "Observe",
        lead: "What does the text say? Look before you explain.",
        prompt: "What do you notice? Repeated words, contrasts, commands, promises, questions.",
        placeholder: "v.3 …",
        ai: [
          {
            id: "missed",
            label: "What am I missing?",
            ask: (s) =>
              s.answers.observe?.trim()
                ? `${style(130)}\nHere are my observations on ${s.label}:\n"""${s.answers.observe.trim()}"""\nPoint out up to 3 things in the text itself I have not noticed yet: repeated words, contrasts, commands, promises, questions, who speaks to whom. Say which verse. Observations only, no interpretation yet.`
                : `${style(130)}\nI am about to read ${s.label} closely. Give me 4 specific things to look for in it, each with its verse. Tell me where to look, not what it means.`,
          },
        ],
      },
      {
        id: "understand",
        title: "Understand",
        lead: "What did it mean to the people who first heard it?",
        prompt: "What do you think it meant then?",
        placeholder: "To its first readers…",
        ai: [
          {
            id: "hard",
            label: "Explain a part",
            input: "Which part is hard to understand?",
            ask: (s, typed) =>
              `${style(190)}\nIn ${s.label}, help me understand: ${typed}\nExplain plainly from what the first readers knew. Check the original words where they matter. Mention briefly if early Christian writers or the manuscripts differ on it.`,
          },
          {
            id: "fathers",
            label: "What did the early church say?",
            ask: (s) =>
              `${style(190)}\nWhat did Christian writers before AD 325 say about ${s.label}? Look it up in the library. Name two or three writers with their dates, quote a short line from each where you can, and say in one sentence what each took the passage to mean.`,
          },
        ],
      },
      {
        id: "apply",
        title: "Apply",
        lead: "What difference does it make this week?",
        prompt: "What will you believe, do or pray because of this?",
        placeholder: "This week I…",
        ai: [
          {
            id: "live",
            label: "Ideas for living it out",
            ask: (s) =>
              `${style(130)}\nGive 2 or 3 concrete, everyday ways someone could live out ${s.label} this week, each tied to a verse.${mine(s, "understand", "What I understood")}`,
          },
          {
            id: "group",
            label: "Questions for a group",
            questions: true,
            ask: (s) =>
              `${style(160)}\nWrite 5 discussion questions for a small group studying ${s.label}: one to open, two about what the text says, one about what it meant, one about living it out. A numbered list, one line each, no answers.`,
          },
        ],
      },
    ],
  },
};

/** How the assistant should answer in a study: short, plain, grounded. */
function style(words: number): string {
  return `I am doing a personal Bible study in Testimonia. Answer in plain, warm, everyday English for someone who is not a scholar, in under ${words} words. Refer to verses by number (v. 5) or reference. Use the library tools when the passage, its original words or early Christian writers help; never invent a quotation. Do not preach.`;
}

function scene(s: Study): string {
  return `${style(130)}\nSet the scene for ${s.label}${s.title ? ` (${s.title})` : ""}: who wrote it and to whom, where and when, and what happens just before it. Four short bullet points.`;
}

function mine(s: Study, step: string, label: string): string {
  const t = s.answers[step]?.trim();
  return t ? `\n${label}: """${t.slice(0, 1500)}"""` : "";
}

/** The final look over the whole study. */
export function reviewQuestion(s: Study): string {
  const steps = METHODS[s.method].steps;
  const body = steps
    .map((st) => (s.answers[st.id]?.trim() ? `${st.title}: ${s.answers[st.id]!.trim().slice(0, 1500)}` : ""))
    .filter(Boolean)
    .join("\n");
  return `${style(190)}\nHere is my study of ${s.label}:\n"""\n${body}\n"""\nLook over it kindly, like a good small-group leader: say what I saw well, point to anything in the text I may have missed or read too quickly (with verses), and leave me with one question to keep thinking about.`;
}

/** The numbered or bulleted lines of an answer: discussion questions to add one by one. */
export function listItems(text: string): string[] {
  return text
    .split("\n")
    .map((l) => /^\s*(?:\d+[.)]|[-*•])\s+(.+)$/.exec(l)?.[1]?.replace(/\*\*/g, "").trim())
    .filter((l): l is string => !!l && l.length > 8);
}

// ----------------------------------------------------------------------------- words that repeat

const STOP = new Set(
  (
    "the and of to in that he him his i a is it for not be unto shall with they ye you your them but as which this was all have are will from by there " +
    "their my me we us our said so on at or if no what who whom when then one do an were had hath thee thou thy thine also into out up may can would should " +
    "even these those she her its any been being has did does how than because now about more very upon let say says saying saith came come cometh went go " +
    "made make things thing every also nor yet own whoever whosoever whatsoever whatever therefore where why here just like through before after again over " +
    "said, am art doth hast wilt shalt neither either both such same each other others another many much most some only them, i'm don't don’t it's it’s"
  ).split(" "),
);

/** Words that come back in the passage (at least three times, or twice in a short one), most frequent first. */
export function repeatedWords(verses: { verse: number; text: string | null }[], limit = 8): { word: string; label: string; n: number; verses: number[] }[] {
  const seen = new Map<string, { n: number; verses: Set<number>; forms: Map<string, number> }>();
  for (const v of verses) {
    for (const raw of (v.text ?? "").match(/[A-Za-z’']+/g) ?? []) {
      const form = raw.replace(/[’']s$/, "").replace(/^[’']+|[’']+$/g, "");
      const w = form.toLowerCase();
      if (w.length < 3 || STOP.has(w)) continue;
      const e = seen.get(w) ?? { n: 0, verses: new Set<number>(), forms: new Map<string, number>() };
      e.n++;
      e.verses.add(v.verse);
      e.forms.set(form, (e.forms.get(form) ?? 0) + 1);
      seen.set(w, e);
    }
  }
  const min = verses.length <= 6 ? 2 : 3;
  return [...seen.entries()]
    .filter(([, e]) => e.n >= min && e.verses.size > 1)
    .sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word, e]) => {
      // "God" stays capitalised; a word capitalised only where it starts a sentence does not
      const caps = [...e.forms.entries()].filter(([f]) => f !== word).reduce((t, [, n]) => t + n, 0);
      const label = caps * 2 > e.n ? [...e.forms.entries()].filter(([f]) => f !== word).sort((a, b) => b[1] - a[1])[0]![0] : word;
      return { word, label, n: e.n, verses: [...e.verses].sort((x, y) => x - y) };
    });
}

// ----------------------------------------------------------------------------- key words in the original

interface OrigWord {
  lemma_id: string | null;
  strong: string | null;
  lemma?: string | null;
  lemma_gloss?: string | null;
  translit: string | null;
  gloss: string | null;
  morph: string | null;
}

// very common words that say little about a passage on their own (be, say, have, do, all, God and LORD stay)
const COMMON = new Set(["G1510", "G3004", "G2036", "G1096", "G2192", "G4160", "G3956", "G2064", "G1325", "G3708", "G1492", "G1410", "H1961", "H0559", "H6213", "H3605", "H0935", "H5414", "H7200", "H3212", "H1980"]);

/** A content word (verb, common noun, adjective): Greek morph "V-…", "N-…", "A-…"; Hebrew "HVqp3ms", "HR/Ncfsa". */
function content(morph: string | null): boolean {
  if (!morph) return false;
  if (/^(V|N|A)-/.test(morph)) return true;
  return morph.split("/").some((p) => /^[HA]?(V|Nc|Aa)/.test(p) && !/^H?R$/.test(p));
}

/** The original-language words that recur in the passage: dictionary form, meaning, how often, first verse. */
export function keyWords(words: { osis: string; words: OrigWord[] }[], limit = 6): { id: string; lemma: string; translit: string | null; gloss: string | null; n: number; first: string }[] {
  const seen = new Map<string, { lemma: string; translit: string | null; gloss: string | null; n: number; first: string }>();
  for (const v of words) {
    for (const w of v.words) {
      const id = w.lemma_id ?? w.strong?.split(" ").find((s) => /^[GH]\d{4}/.test(s) && !/^H9\d{3}/.test(s)) ?? null;
      if (!id || !content(w.morph) || COMMON.has(id.replace(/[A-Z]$/, ""))) continue;
      const e = seen.get(id) ?? { lemma: w.lemma ?? "", translit: null, gloss: w.lemma_gloss ?? w.gloss, n: 0, first: v.osis };
      e.n++;
      seen.set(id, e);
    }
  }
  return [...seen.entries()]
    .filter(([, e]) => e.n >= 2 && e.lemma)
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, limit)
    .map(([id, e]) => ({ id, ...e }));
}

/** The whole study as plain text (copy, share). */
export function studyText(s: Study, verseLabel: (osis: string) => string): string {
  const m = METHODS[s.method];
  const lines = [`${s.label}${s.title ? `: ${s.title}` : ""}`, `${m.name} study`, ""];
  for (const st of m.steps) {
    const a = s.answers[st.id]?.trim();
    const h = s.help[st.id]?.trim();
    if (st.id === "carry" && s.carry) lines.push(`${st.title}: ${verseLabel(s.carry)}`);
    if (!a && !h) continue;
    lines.push(`## ${st.title}`, st.prompt);
    if (a) lines.push(a);
    if (h) lines.push("", h);
    lines.push("");
  }
  if (s.questions.length) lines.push("## Questions for a group", ...s.questions.map((q, i) => `${i + 1}. ${q}`));
  return lines.join("\n").trim();
}
