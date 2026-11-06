import { describe, expect, it } from "vitest";
import { formatYear, isRtl, isStrong, langClass, osisLabel, parseOsis, verseUrl } from "./lib";
import type { Book } from "./types";

const books: Book[] = [
  { osis: "John", name: "John", testament: "NT", hebrew_name: null, greek_name: null, latin_name: null, genre: null, ord: 43, chapters: 21 },
];

describe("formatYear", () => {
  it("formats astronomical years", () => {
    expect(formatYear(202)).toBe("AD 202");
    expect(formatYear(0)).toBe("1 BC");
    expect(formatYear(-1445)).toBe("1446 BC");
    expect(formatYear(null)).toBe("");
  });
});

describe("references", () => {
  it("parses OSIS verse ids", () => {
    expect(parseOsis("John.1.18")).toEqual({ book: "John", chapter: 1, verse: 18 });
    expect(parseOsis("1Cor.13.4")).toEqual({ book: "1Cor", chapter: 13, verse: 4 });
    expect(parseOsis("John 1:18")).toBeNull();
  });
  it("labels and links verses", () => {
    expect(osisLabel("John.1.18", books)).toBe("John 1:18");
    expect(verseUrl("John.1.18")).toBe("/read/John/1?v=John.1.18#v18");
    expect(verseUrl("John.1.18", "G3439")).toBe("/read/John/1?v=John.1.18&w=G3439#v18");
  });
  it("recognises Strong's numbers", () => {
    expect(isStrong("G3439")).toBe(true);
    expect(isStrong("H0430G")).toBe(true);
    expect(isStrong("John.1.1")).toBe(false);
  });
});

describe("scripts", () => {
  it("knows right-to-left languages", () => {
    expect(isRtl("hbo")).toBe(true);
    expect(isRtl("grc")).toBe(false);
    expect(langClass("grc")).toBe("greek");
    expect(langClass("hbo")).toBe("hebrew");
  });
});
