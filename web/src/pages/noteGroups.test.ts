import { describe, expect, it } from "vitest";
import type { Note } from "../notes";
import { groupNotes } from "./noteGroups";

const note = (osis: string, extra: Partial<Note> = {}): Note => ({ osis, text: "", highlight: null, created: "", updated: "", ...extra });
const labels = (notes: Note[]) => groupNotes(notes).map((g) => g.notes.map((n) => n.osis.split(".").slice(1).join(":")).join(","));

describe("groupNotes", () => {
  it("joins neighbouring verses with the same colour into one highlight", () => {
    expect(labels([note("John.3.16", { highlight: "gold" }), note("John.3.17", { highlight: "gold" }), note("John.3.18", { highlight: "gold" })])).toEqual(["3:16,3:17,3:18"]);
  });

  it("joins words highlighted across verses (saved as marks)", () => {
    const mark = { ed: "kjva", start: 0, end: 10, color: "green" as const };
    expect(labels([note("Ps.23.1", { marks: [mark] }), note("Ps.23.2", { marks: [mark] })])).toEqual(["23:1,23:2"]);
  });

  it("keeps apart different colours, gaps, chapters and books", () => {
    expect(
      labels([
        note("John.3.16", { highlight: "gold" }),
        note("John.3.17", { highlight: "blue" }),
        note("John.3.19", { highlight: "blue" }),
        note("John.4.1", { highlight: "blue" }),
        note("Acts.1.1", { highlight: "blue" }),
      ]),
    ).toEqual(["3:16", "3:17", "3:19", "4:1", "1:1"]);
  });

  it("gives each written note its own card, and never joins a note without a highlight", () => {
    expect(
      labels([
        note("John.1.1", { highlight: "gold", text: "the Word" }),
        note("John.1.2", { highlight: "gold" }),
        note("John.1.3", { highlight: "gold", text: "all things" }),
        note("John.1.4", { text: "life" }),
        note("John.1.5", { text: "light" }),
      ]),
    ).toEqual(["1:1,1:2", "1:3", "1:4", "1:5"]);
  });
});
