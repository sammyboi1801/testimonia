import { describe, expect, it } from "vitest";
import { confidenceBand, refLinks, yearRange } from "./geoApi";

describe("atlas helpers", () => {
  it("bands OpenBible confidence scores", () => {
    expect(confidenceBand(1)).toBe("certain");
    expect(confidenceBand(0.5)).toBe("likely");
    expect(confidenceBand(0.05)).toBe("uncertain");
    expect(confidenceBand(null)).toBe("unknown");
  });

  it("labels verse references compactly, repeating the chapter only when it changes", () => {
    expect(refLinks("Gen", ["12.8", "13.3", "13.4"]).map((r) => r.label)).toEqual(["12:8", "13:3", "4"]);
    expect(refLinks("Gen", ["12.8"])[0]!.osis).toBe("Gen.12.8");
  });

  it("formats astronomical year ranges", () => {
    expect(yearRange(-1920)).toBe("1921 BC");
    expect(yearRange(-1055, -1015)).toBe("1056–1016 BC");
    expect(yearRange(30, 33)).toBe("AD 30–33");
    expect(yearRange(-3, 30)).toBe("4 BC – AD 30");
    expect(yearRange(null)).toBe("");
  });
});
