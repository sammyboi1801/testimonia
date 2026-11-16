import { describe, expect, it } from "vitest";
import { pronounce } from "./pronounce";

describe("pronounce", () => {
  it("marks the stressed syllable and the rough breathing", () => {
    expect(pronounce("οὗτος")).toBe("HOO-tos");
  });
  it("reads γγ as ng and splits the pair", () => {
    expect(pronounce("ἄγγελος")).toBe("AN-ge-los");
  });
  it("keeps open syllables", () => {
    expect(pronounce("μονογενής")).toBe("mo-no-ge-NAYS");
    expect(pronounce("θεός")).toBe("the-OS");
    expect(pronounce("λόγος")).toBe("LO-gos");
  });
  it("lets stop + liquid open a syllable", () => {
    expect(pronounce("πατρός")).toBe("pa-TROS");
  });
  it("reads diphthongs as one sound", () => {
    expect(pronounce("Ἰησοῦς")).toBe("i-ay-SOOS");
  });
  it("returns nothing for non-Greek", () => {
    expect(pronounce("abc")).toBe("");
  });
});
