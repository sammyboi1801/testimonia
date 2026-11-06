import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MsVerse, noteFor, prepare, splitLead, toUncial } from "./components/Transcription";

// John 1:18 in P66 and a corrected reading, as the ingest writes them (testimonia/ingest/transcriptions.py)
const P66 =
  '<span class="lb"></span><span class="w ns">θν</span> <span class="w">ουδεισ</span> ' +
  '<span class="w">μ<span class="d">ο</span><span class="lb"></span>νογενησ</span> ' +
  '<span class="w">τ<span class="m">ου</span></span> <span class="w sup vid">πατροσ</span>';
const CORR = '<span class="corr" data-x="πανταν" data-a="παντα"><span class="w">παντα</span></span>';

describe("transcription markup", () => {
  it("writes capitals with the lunate sigma", () => {
    expect(toUncial("ουδεισ θσ")).toBe("ΟΥΔΕΙϹ ΘϹ");
  });

  it("keeps the markup's classes, capitalises only the text, and sanitises", () => {
    const html = prepare(P66 + '<img src="x" onerror="alert(1)"><span class="w" onclick="x()">και</span>', true);
    expect(html).toContain('<span class="w ns">ΘΝ</span>');
    expect(html).toContain('<span class="m">ΟΥ</span>');
    expect(html).not.toContain("img");
    expect(html).not.toContain("onclick");
    expect(html).toContain('title="lost; its presence inferred from the space"');
    expect(prepare(P66, false)).toContain("ουδειϲ");
  });

  it("explains corrections and differences from the printed text", () => {
    const doc = new DOMParser().parseFromString(
      `${CORR}<span class="w diff" data-p="θεὸς">υιοσ</span><span class="om" data-p="ὁ"></span>` +
        '<span class="w diff" data-p="—">ημιν</span>',
      "text/html",
    );
    const [corr, diff, om, added] = [...doc.body.children];
    expect(noteFor(corr!, false)).toBe("Corrected — first written: πανταν · second hand: παντα");
    expect(noteFor(corr!, true)).toBe("Corrected — first written: ΠΑΝΤΑΝ · second hand: ΠΑΝΤΑ");
    expect(noteFor(diff!, false)).toBe("The printed text (NA28) reads: θεὸς");
    expect(noteFor(om!, false)).toBe("The printed text (NA28) adds: ὁ");
    expect(noteFor(added!, false)).toBe("Not in the printed text (NA28)");
  });

  it("splits off the breaks a verse starts with", () => {
    expect(splitLead(P66)).toEqual(['<span class="lb"></span>', P66.slice('<span class="lb"></span>'.length)]);
    expect(splitLead('<span class="pb" data-n="522"></span><span class="w">α</span>')[0]).toBe('<span class="pb" data-n="522"></span>');
    expect(splitLead(CORR)).toEqual(["", CORR]);
  });

  it("says when a manuscript does not have the verse", () => {
    expect(renderToStaticMarkup(<MsVerse markup='<span class="absent"></span>' uncial />)).toContain("does not have this verse");
    expect(renderToStaticMarkup(<MsVerse markup='<span class="absent vid"></span>' uncial={false} />)).toContain("judged from the space");
  });
});
