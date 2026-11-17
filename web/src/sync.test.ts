import { describe, expect, it } from "vitest";
import { merge, merge3, same } from "./sync";

const note = (osis: string, text: string, updated: string) => ({ osis, text, updated });

describe("sync merge3 (deletions travel between devices)", () => {
  const a = note("John.1.1", "a", "2026-11-01");
  const b = note("John.3.16", "b", "2026-11-01");

  it("a highlight deleted on the phone is deleted on the laptop, not brought back", () => {
    const base = { "John.1.1": a, "John.3.16": b };
    const phone = { "John.1.1": a }; // deleted John 3:16, already in the account
    const laptop = base; // untouched since
    expect(merge3("testimonia.notes.v1", base, laptop, phone)).toEqual({ "John.1.1": a });
  });

  it("a delete here and a new note there both survive; an edit beats a delete of the same note", () => {
    const base = { "John.1.1": a, "John.3.16": b };
    const here = { "John.3.16": b }; // deleted John 1:1
    const there = { "John.1.1": a, "John.3.16": { ...b, text: "edited", updated: "2026-11-02" }, "Gen.1.1": note("Gen.1.1", "new", "2026-11-02") };
    const m = merge3("testimonia.notes.v1", base, here, there) as Record<string, { text: string }>;
    expect(Object.keys(m).sort()).toEqual(["Gen.1.1", "John.3.16"]);
    expect(m["John.3.16"]!.text).toBe("edited");
    const kept = merge3("testimonia.notes.v1", { "John.1.1": a }, { "John.1.1": { ...a, text: "kept", updated: "2026-11-03" } }, {}) as Record<string, unknown>;
    expect(Object.keys(kept)).toEqual(["John.1.1"]);
  });

  it("unpinning and unticking a plan day travel too", () => {
    const pins = merge3("testimonia.pins.v1", { pinned: ["x", "y"], sets: [] }, { pinned: ["x"], sets: [] }, { pinned: ["x", "y", "z"], sets: [] }) as { pinned: string[] };
    expect(pins.pinned.sort()).toEqual(["x", "z"]);
    const plans = merge3("testimonia.plans", { p: { start: "2026-11-01", done: [1, 2] } }, { p: { start: "2026-11-01", done: [1] } }, { p: { start: "2026-11-01", done: [1, 2, 3] } }) as Record<string, { done: number[] }>;
    expect(plans.p!.done).toEqual([1, 3]);
  });

  it("without a base (first sign-in on a device) nothing is dropped", () => {
    expect(Object.keys(merge3("testimonia.notes.v1", null, { "John.1.1": a }, { "John.3.16": b }) as object).sort()).toEqual(["John.1.1", "John.3.16"]);
  });

  it("two devices settle: with nothing new, the merge is the account's copy (nothing sent back)", () => {
    const remote = { pinned: ["b", "a"], sets: [{ id: "s2" }, { id: "s1" }] };
    const local = { pinned: ["a", "b"], sets: [{ id: "s1" }, { id: "s2" }] }; // same content, other order
    expect(same(merge3("testimonia.pins.v1", local, local, remote), remote)).toBe(true);
    const notes = { "John.3.16": b, "John.1.1": a };
    expect(same(merge3("testimonia.notes.v1", notes, { "John.1.1": a, "John.3.16": b }, notes), notes)).toBe(true);
  });
});

describe("sync merge (two devices' data, nothing lost)", () => {
  it("notes: keeps both devices' notes; the later edit of the same verse wins", () => {
    const phone = { "John.1.1": { osis: "John.1.1", text: "phone", updated: "2026-11-09T10:00:00Z" }, "Rom.8.28": { osis: "Rom.8.28", text: "only phone", updated: "2026-11-01T00:00:00Z" } };
    const laptop = { "John.1.1": { osis: "John.1.1", text: "laptop, later", updated: "2026-11-09T12:00:00Z" }, "Gen.1.1": { osis: "Gen.1.1", text: "only laptop", updated: "2026-11-02T00:00:00Z" } };
    const m = merge("testimonia.notes.v1", phone, laptop) as Record<string, { text: string }>;
    expect(Object.keys(m).sort()).toEqual(["Gen.1.1", "John.1.1", "Rom.8.28"]);
    expect(m["John.1.1"]!.text).toBe("laptop, later");
  });

  it("pins: union of pinned places and of saved sets", () => {
    const m = merge(
      "testimonia.pins.v1",
      { pinned: ["jerusalem", "ekron"], sets: [{ id: "a", name: "A", places: [] }] },
      { pinned: ["ekron", "bethel"], sets: [{ id: "b", name: "B", places: [] }] },
    ) as { pinned: string[]; sets: { id: string }[] };
    expect(m.pinned.sort()).toEqual(["bethel", "ekron", "jerusalem"]);
    expect(m.sets.map((s) => s.id).sort()).toEqual(["a", "b"]);
  });

  it("chats: conversations from both, the later version of the same one, newest first", () => {
    const m = merge(
      "testimonia.ai.chats.v1",
      [{ id: "x", updated: "2026-11-09T09:00:00Z", title: "old" }, { id: "y", updated: "2026-11-08T00:00:00Z" }],
      [{ id: "x", updated: "2026-11-09T11:00:00Z", title: "new" }, { id: "z", updated: "2026-11-09T12:00:00Z" }],
    ) as { id: string; title?: string }[];
    expect(m.map((c) => c.id)).toEqual(["z", "x", "y"]);
    expect(m.find((c) => c.id === "x")!.title).toBe("new");
  });

  it("first sign-in: whatever exists on one side is kept", () => {
    expect(merge("testimonia.settings.v1", null, { theme: "dark" })).toEqual({ theme: "dark" });
    expect(merge("testimonia.notes.v1", { a: 1 }, null)).toEqual({ a: 1 });
  });
});
