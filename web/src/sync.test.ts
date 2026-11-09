import { describe, expect, it } from "vitest";
import { merge } from "./sync";

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
