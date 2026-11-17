import { describe, expect, it } from "vitest";
import { covers } from "./studies";
import { keyWords, listItems, repeatedWords } from "./studyMethods";

describe("Bible study helpers", () => {
  it("finds the words a passage repeats, leaving out the little ones", () => {
    const verses = [
      { verse: 16, text: "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish" },
      { verse: 17, text: "For God sent not his Son into the world to condemn the world; but that the world through him might be saved." },
      { verse: 18, text: "He that believeth on him is not condemned: but he that believeth not is condemned already" },
    ];
    const r = repeatedWords(verses);
    expect(r[0]).toEqual({ word: "world", label: "world", n: 4, verses: [16, 17] });
    expect(repeatedWords([{ verse: 1, text: "God is love. God sent." }, { verse: 2, text: "Love of God." }])[0]!.label).toBe("God");
    expect(r.map((w) => w.word)).toContain("believeth");
    expect(r.map((w) => w.word)).not.toContain("that");
  });

  it("finds key original words: content words that recur, not articles or 'to be'", () => {
    const w = (lemma_id: string, morph: string, lemma: string, gloss: string) => ({ lemma_id, strong: lemma_id, lemma, lemma_gloss: gloss, translit: null, gloss, morph });
    const words = [
      { osis: "John.3.3", words: [w("G3588", "T-NSM", "ὁ", "the"), w("G1080", "V-APS-3S", "γεννάω", "to beget"), w("G0509", "ADV", "ἄνωθεν", "from above"), w("G1510", "V-PAI-3S", "εἰμί", "to be")] },
      { osis: "John.3.4", words: [w("G1080", "V-APN", "γεννάω", "to beget"), w("G3588", "T-NSM", "ὁ", "the"), w("G1510", "V-PAI-3S", "εἰμί", "to be")] },
    ];
    expect(keyWords(words)).toEqual([{ id: "G1080", lemma: "γεννάω", translit: null, gloss: "to beget", n: 2, first: "John.3.3" }]);
  });

  it("reads a numbered list of questions out of an answer", () => {
    expect(listItems("Here are some:\n1. What does Jesus mean by born again?\n2) Why at night?\n- Who is Nicodemus to you?\nThanks")).toEqual([
      "What does Jesus mean by born again?",
      "Why at night?",
      "Who is Nicodemus to you?",
    ]);
  });

  it("knows which verses a study covers, across chapters", () => {
    expect(covers("John.3.1-John.3.21", "John.3.16")).toBe(true);
    expect(covers("John.3.1-John.3.21", "John.3.22")).toBe(false);
    expect(covers("John.3.36-John.4.2", "John.4.1")).toBe(true);
    expect(covers("John.3.1-John.3.21", "Acts.3.16")).toBe(false);
  });
});
