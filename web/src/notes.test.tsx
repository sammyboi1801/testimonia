import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vitest";
import { NotesProvider, useNotes } from "./notes";

type Api = ReturnType<typeof useNotes>;

async function mount(): Promise<{ api: () => Api; unmount: () => Promise<void> }> {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let current: Api | null = null;
  function Probe() {
    current = useNotes();
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(NotesProvider, null, createElement(Probe))));
  return { api: () => current!, unmount: () => act(async () => root.unmount()) };
}

describe("notes", () => {
  beforeEach(() => localStorage.clear());

  it("saves a note and a highlight, and forgets a verse once both are cleared", async () => {
    const { api, unmount } = await mount();
    await act(async () => api().set("John.1.18", { text: "μονογενής θεός?", highlight: "gold" }));
    expect(api().get("John.1.18")).toMatchObject({ text: "μονογενής θεός?", highlight: "gold" });
    expect(JSON.parse(localStorage.getItem("testimonia.notes.v1")!)["John.1.18"].highlight).toBe("gold");
    await act(async () => api().set("John.1.18", { text: "", highlight: null }));
    expect(api().get("John.1.18")).toBeUndefined();
    await unmount();
  });

  it("imports an export, keeping the newer edit and skipping junk", async () => {
    const { api, unmount } = await mount();
    await act(async () => api().set("Gen.1.1", { text: "mine" }));
    const mine = api().get("Gen.1.1")!;
    let added = 0;
    await act(async () => {
      added = api().importNotes([
        { osis: "Gen.1.1", text: "older", updated: "2000-01-01T00:00:00Z" },
        { osis: "Rom.8.28", text: "new", highlight: "blue", updated: "2026-01-01T00:00:00Z" },
        { osis: "not a ref", text: "x" },
        { osis: "Ps.23.1", highlight: "neon" },
      ]);
    });
    expect(added).toBe(1); // only Rom.8.28: Gen.1.1 is older, the rest is junk or empty
    expect(api().get("Gen.1.1")!.text).toBe(mine.text);
    expect(api().get("Rom.8.28")!.highlight).toBe("blue");
    expect(api().get("Ps.23.1")).toBeUndefined(); // an unknown colour and no text leaves nothing to keep
    await unmount();
  });
});
