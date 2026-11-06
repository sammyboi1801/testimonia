import { describe, expect, it } from "vitest";
import { citeBlock, citeInline, diffWords, normWord, passageUrl, rangeLabel } from "./studyLib";

const marked = (base: string, other: string) =>
  diffWords(base, other)
    .filter((p) => p.changed)
    .map((p) => p.text);

describe("diffWords", () => {
  it("marks nothing when only case and punctuation differ", () => {
    expect(marked("In the beginning was the Word,", "In the beginning was the word")).toEqual([]);
    expect(normWord("Word,")).toBe("word");
  });

  it("marks inserted and changed words, joining a changed phrase into one run", () => {
    const kjv = "No man hath seen God at any time; the only begotten Son";
    const bsb = "No one has ever seen God, but the one and only Son";
    expect(marked(kjv, bsb)).toEqual(["one has ever", "but", "one and"]);
  });

  it("rebuilds the other text exactly and notes the base words it leaves out", () => {
    const parts = diffWords("And God said, Let there be light", "God said, “Let there be light”");
    expect(parts.map((p) => p.text).join("")).toBe("God said, “Let there be light”");
    expect(parts.find((p) => p.gap)?.gap).toBe("And");
    expect(diffWords("a b c", "a b").at(-1)?.gap).toBe("c");
  });
});

describe("citations", () => {
  it("quotes inline, nesting inner quotation marks", () => {
    expect(citeInline("In the beginning was the Word", "John 1:1", "KJV")).toBe("“In the beginning was the Word” (John 1:1, KJV)");
    expect(citeInline("He said, “Come.”", "John 1:39", null)).toBe("“He said, ‘Come.’” (John 1:39)");
  });

  it("formats a block with verse numbers and a reference line", () => {
    expect(citeBlock([{ verse: 1, text: "In the beginning." }], "John 1:1", "KJV")).toBe("In the beginning.\n— John 1:1 (KJV)");
    expect(citeBlock([{ verse: 1, text: "A." }, { verse: 12, text: "B." }], "John 1:1–12", "BSB")).toBe("¹ A. ¹² B.\n— John 1:1–12 (BSB)");
  });

  it("labels ranges and builds passage URLs", () => {
    expect(rangeLabel("John", "John.1.1", "John.1.18")).toBe("John 1:1–18");
    expect(rangeLabel("John", "John.1.19", "John.2.11")).toBe("John 1:19–2:11");
    expect(passageUrl("John.1.1", "John.1.18")).toBe("/passage/John.1.1-John.1.18");
    expect(passageUrl("John.1.14")).toBe("/passage/John.1.14");
  });
});
