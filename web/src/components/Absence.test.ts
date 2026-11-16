import { describe, expect, it } from "vitest";
import { absenceRuns, absenceText, msDate } from "./Absence";

describe("absence notices", () => {
  it("writes manuscript dates plainly", () => {
    expect(msDate("150-250")).toBe("AD 150–250");
    expect(msDate("~250")).toBe("c. AD 250");
    expect(msDate("4th")).toBe("4th century");
    expect(msDate("4th/5th")).toBe("4th–5th century");
  });
  it("states only which manuscripts lack it and the earliest that has it", () => {
    const info = {
      lacking: [
        { sigla: "P66", name: "Papyrus 66", date: "150-250" },
        { sigla: "01 א", name: "Codex Sinaiticus", date: "4th" },
      ],
      first: { sigla: "05 D", name: "Codex Bezae", date: "5th" },
      checked: 7,
    };
    expect(absenceText(info, "John 8:1–11")).toBe(
      "Papyrus 66 (AD 150–250) and Codex Sinaiticus (4th century) do not contain John 8:1–11. The earliest transcribed manuscript that has it is Codex Bezae (5th century).",
    );
    expect(absenceText({ ...info, first: null }, "this verse")).toContain("None of the 7 transcribed manuscripts here has it.");
  });
  it("groups consecutive verses into passages", () => {
    const i = { lacking: [], first: null, checked: 1 };
    expect(absenceRuns({ 1: i, 2: i, 3: i, 9: i })).toEqual([
      [1, 3],
      [9, 9],
    ]);
  });
});
