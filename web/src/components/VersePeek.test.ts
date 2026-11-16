import { describe, expect, it } from "vitest";
import { linkRefs } from "./VersePeek";

const BOOKS = [
  { osis: "John", name: "John" },
  { osis: "Rom", name: "Romans" },
  { osis: "1Cor", name: "1 Corinthians" },
  { osis: "Ps", name: "Psalms" },
];

describe("linkRefs", () => {
  it("links a plain reference", () => {
    expect(linkRefs("See John 3:16 here.", BOOKS)).toBe("See [John 3:16](/read/John/3?v=John.3.16) here.");
  });
  it("links ranges, numbered books and Psalm", () => {
    expect(linkRefs("Romans 8:28–30", BOOKS)).toBe("[Romans 8:28–30](/read/Rom/8?v=Rom.8.28&to=30)");
    expect(linkRefs("1 Corinthians 13:4", BOOKS)).toContain("(/read/1Cor/13?v=1Cor.13.4)");
    expect(linkRefs("Psalm 23:1", BOOKS)).toContain("(/read/Ps/23?v=Ps.23.1)");
  });
  it("leaves existing links and code alone", () => {
    const md = "[John 3:16](/read/John/3?v=John.3.16) and `John 3:16`";
    expect(linkRefs(md, BOOKS)).toBe(md);
  });
  it("ignores names that are not Bible books", () => {
    expect(linkRefs("1 Clement 5:2 and Against Heresies 3:3", BOOKS)).toBe("1 Clement 5:2 and Against Heresies 3:3");
  });
});
