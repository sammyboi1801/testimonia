import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TextWithNotes } from "./components/Footnotes";
import type { Footnote } from "./types";

const note = (n: number, anchor: string | null, kind = "note"): Footnote => ({ n, kind, body: `note ${n}`, anchor });
const marks = (html: string) => html.replace(/<sup[^>]*>([a-z0-9]+)<\/sup>/g, "[$1]");

describe("TextWithNotes", () => {
  it("places each note after its anchor words, keeping punctuation with the word", () => {
    const text = "No one has seen God at any time. The only born Son, who is at the Father’s side, has declared him.";
    const html = renderToStaticMarkup(<TextWithNotes text={text} notes={[note(1, "God at any time"), note(2, "The only born Son")]} />);
    expect(marks(html)).toBe("No one has seen God at any time.[a] The only born Son,[b] who is at the Father’s side, has declared him.");
  });

  it("attaches repeated words to the right occurrence and falls back to the verse end", () => {
    const text = "Love one another, as I have loved you, love one another.";
    const html = renderToStaticMarkup(<TextWithNotes text={text} notes={[note(1, "Love one another"), note(2, "love one another"), note(3, "not in the verse")]} />);
    expect(marks(html)).toBe("Love one another,[a] as I have loved you, love one another.[b][c]");
  });

  it("renders plain text when there are no notes", () => {
    expect(renderToStaticMarkup(<TextWithNotes text="In the beginning" />)).toBe("In the beginning");
  });
});
