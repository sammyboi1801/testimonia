import { describe, expect, it } from "vitest";
import { linkRefs, markQuote, refCovers } from "./VersePeek";

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

// the shape of a CCEL section: quotations followed by footnotes holding the reference
const TARSIANS = `<p>What man could ever say, “I came down from heaven, not to do Mine own will, but the will of
Him that sent Me?”<span class="note" data-n="1201"><span class="np">
<a class="ref" data-ref="John.6.38">John vi. 38</a>.</span> </span> And of what man could it be
said, “He was the true Light, which lighteth every man that cometh
into the world: He was in the world, and the world was made by Him, and
the world knew Him not. He came unto His own, and His own received Him
not?”<span class="note" data-n="1202"><span class="np">
<a class="ref" data-ref="John.1.9-John.1.11">John i. 9, 10, 11</a>.</span> </span> How could such a one
be a mere man?</p>`;

function section(html: string) {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}
const marked = (root: HTMLElement) => [...root.querySelectorAll("mark")].map((m) => m.textContent).join("").replace(/\s+/g, " ");

describe("refCovers", () => {
  it("matches a verse, a range and a chapter", () => {
    expect(refCovers("John.1.10", "John.1.10")).toBe(true);
    expect(refCovers("John.1.9-John.1.11", "John.1.10")).toBe(true);
    expect(refCovers("John.1.9-John.1.11", "John.1.12")).toBe(false);
    expect(refCovers("John.1", "John.1.10")).toBe(true);
    expect(refCovers("Rom.1.10", "John.1.10")).toBe(false);
    expect(refCovers("Rom.3.1 John.1.10", "John.1.10")).toBe(true);
  });
});

describe("markQuote", () => {
  it("marks the whole quotation before the verse's reference", () => {
    const root = section(TARSIANS);
    markQuote(root, "John.1.10");
    expect(marked(root)).toBe("“He was the true Light, which lighteth every man that cometh into the world: He was in the world, and the world was made by Him, and the world knew Him not. He came unto His own, and His own received Him not?”");
  });

  it("marks a different quotation for a different verse", () => {
    const root = section(TARSIANS);
    markQuote(root, "John.6.38");
    expect(marked(root)).toBe("“I came down from heaven, not to do Mine own will, but the will of Him that sent Me?”");
  });

  it("marks the sentence when there are no quotation marks", () => {
    const root = section('<p>He spoke of this before. As the prophet says, the Lord is my shepherd<a class="ref" data-ref="Ps.23.1">Ps. xxiii. 1</a>, and so on.</p>');
    markQuote(root, "Ps.23.1");
    expect(marked(root)).toBe("As the prophet says, the Lord is my shepherd");
  });

  it("falls back to the stored words when the reference is not in the text", () => {
    const root = section("<p>And again he says that the true Light lighteth every man that cometh into the world, as John wrote.</p>");
    markQuote(root, "John.3.16", "… says that the true Light lighteth every man that cometh into the world, as John …");
    expect(marked(root)).toContain("the true Light lighteth every man");
  });
});
