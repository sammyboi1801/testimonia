import { describe, expect, it } from "vitest";
import { rangeOffsets, snapToWords } from "./selection";

function verse(html: string): HTMLElement {
  const el = document.createElement("span");
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

describe("rangeOffsets", () => {
  it("counts verse text only, skipping footnote letters", () => {
    // "No one has seen God at any time.ᵃ The only born Son"
    const el = verse('No one has seen God at any time.<sup class="fn">a</sup> The only born Son');
    const after = el.childNodes[2] as Text; // " The only born Son"
    const r = document.createRange();
    r.setStart(after, 5); // "only"
    r.setEnd(after, 14); // "only born"
    expect(rangeOffsets(el, r)).toEqual({ start: 37, end: 46 });
    expect("No one has seen God at any time. The only born Son".slice(37, 46)).toBe("only born");
  });

  it("spans highlights and notes already drawn in the verse", () => {
    const el = verse('In the <mark class="phrase">beginning</mark> was<sup class="fn">a</sup> the Word');
    const r = document.createRange();
    r.setStart(el.querySelector("mark")!.firstChild!, 0);
    r.setEnd(el.lastChild!, 9); // " the Word"
    const o = rangeOffsets(el, r)!;
    expect("In the beginning was the Word".slice(o.start, o.end)).toBe("beginning was the Word");
  });

  it("returns null for an empty selection", () => {
    const el = verse("Jesus wept.");
    const r = document.createRange();
    r.setStart(el.firstChild!, 3);
    r.setEnd(el.firstChild!, 3);
    expect(rangeOffsets(el, r)).toBeNull();
  });
});

describe("snapToWords", () => {
  const t = "In the beginning was the Word";
  it("extends half-selected words and trims spaces", () => {
    const { start, end } = snapToWords(t, 9, 19); // "ginning wa"
    expect(t.slice(start, end)).toBe("beginning was");
    const s2 = snapToWords(t, 6, 17); // " beginning "
    expect(t.slice(s2.start, s2.end)).toBe("beginning");
  });
});
