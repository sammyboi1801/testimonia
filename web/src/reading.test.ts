import { beforeEach, describe, expect, it } from "vitest";
import { dateOf, dayOf, loadProgress, preferredTranslation, saveProgress, sharedWords, tokens } from "./readingApi";

describe("synopsis comparison", () => {
  it("normalises words for comparison (case, accents, punctuation)", () => {
    expect(tokens("He saw, the Heavens.").map((t) => t.key)).toEqual(["he", "saw", "the", "heavens"]);
    expect(tokens("Ἰησοῦς δὲ")[0]!.key).toBe("ιησους");
  });

  it("marks the words each text shares with any other, in order", () => {
    const a = tokens("and he saw the heavens opened").map((t) => t.key);
    const b = tokens("he saw the heavens torn").map((t) => t.key);
    const c = tokens("the heavens were opened").map((t) => t.key);
    const [sa, sb, sc] = sharedWords([a, b, c]);
    expect(sa).toEqual([false, true, true, true, true, true]); // 'opened' is shared with c
    expect(sb).toEqual([true, true, true, true, false]);
    expect(sc).toEqual([true, true, false, true]);
  });

  it("copes with a single or empty column", () => {
    expect(sharedWords([["a", "b"]])).toEqual([[false, false]]);
    expect(sharedWords([[], ["a"]])).toEqual([[], [false]]);
  });
});

describe("reading plan days", () => {
  it("counts days from the start date and clamps to the plan", () => {
    expect(dayOf("2026-01-01", "2026-01-01", 365)).toBe(1);
    expect(dayOf("2026-01-01", "2026-02-01", 365)).toBe(32);
    expect(dayOf("2026-03-01", "2026-02-01", 365)).toBe(1);
    expect(dayOf("2025-01-01", "2026-06-01", 90)).toBe(90);
    expect(dayOf("2026-03-28", "2026-03-30", 365)).toBe(3); // across a clock change
  });

  it("gives the date of a plan day", () => {
    expect(dateOf("2026-12-30", 3)).toBe("2027-01-01");
  });

  it("prefers the reader's translation over word editions", () => {
    expect(preferredTranslation(["tagnt", "web"])).toBe("web");
    expect(preferredTranslation([])).toBe("bsb");
  });
});

describe("plan progress", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips through localStorage and forgets empty plans", () => {
    expect(loadProgress("nt90")).toEqual({ start: null, done: [] });
    saveProgress("nt90", { start: "2026-11-06", done: [3, 1, 3] });
    expect(loadProgress("nt90")).toEqual({ start: "2026-11-06", done: [1, 3] });
    saveProgress("nt90", { start: null, done: [] });
    expect(localStorage.getItem("testimonia.plans")).toBe("{}");
  });

  it("survives corrupt storage", () => {
    localStorage.setItem("testimonia.plans", "{not json");
    expect(loadProgress("canonical")).toEqual({ start: null, done: [] });
  });
});
