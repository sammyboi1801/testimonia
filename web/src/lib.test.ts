import { describe, expect, it } from "vitest";
import { formatYear, isRtl, isStrong, langClass, nativeLabel, osisLabel, parseOsis, verseUrl } from "./lib";
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

describe("native verse numbers", () => {
  it("labels an edition's own numbering beside the standard verse", () => {
    expect(nativeLabel("Ps.22.1", "Ps.23.1")).toBe("22:1");
    expect(nativeLabel("Jer.32.1", "Jer.25.15")).toBe("32:1");
    expect(nativeLabel("1Kgs.2.35,1Kgs.2.35a,1Kgs.2.35b", "1Kgs.2.35")).toBe("2:35–35b");
    expect(nativeLabel("Wis.4.21,Wis.5.1", "Wis.5.1")).toBe("4:21–5:1");
  });
  it("names the book when the edition counts the verse in another book", () => {
    expect(nativeLabel("Dan.3.24", "PrAzar.1.1")).toBe("Dan 3:24");
    expect(nativeLabel("Esth.A.1", "AddEsth.11.2")).toBe("Esth A:1");
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
