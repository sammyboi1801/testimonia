import { describe, expect, it } from "vitest";
import { shownMarks } from "./components/Marks";
import { DEFAULTS, normalize } from "./settings";

describe("normalize", () => {
  it("fills new settings into an old saved object", () => {
    const s = normalize({ design: "folio", mode: "reading", fontScale: 1.2 });
    expect(s.design).toBe("folio");
    expect(s.fontScale).toBe(1.2);
    expect(s.marks).toEqual(DEFAULTS.marks);
    expect(s.speech.rate).toBe(DEFAULTS.speech.rate);
  });

  it("merges nested values and drops unknown keys or wrong types", () => {
    const s = normalize({
      marks: { fat: { symbol: "†" }, size: "big" },
      colors: { dark: { accent: "#123456" } },
      fonts: { text: "spectral" },
      bogus: 1,
    });
    expect(s.marks.fat).toEqual({ ...DEFAULTS.marks.fat, symbol: "†" });
    expect(s.marks.size).toBe(DEFAULTS.marks.size);
    expect(s.colors).toEqual({ light: {}, dark: { accent: "#123456" } });
    expect(s.fonts).toEqual({ text: "spectral" });
    expect("bogus" in s).toBe(false);
  });

  it("survives garbage", () => {
    expect(normalize(null)).toEqual(DEFAULTS);
    expect(normalize("x")).toEqual(DEFAULTS);
  });
});

describe("shownMarks", () => {
  const m = { variants: 2, major_variants: 0, fathers: 3, pre_nicene: 0, quotations: 1 };
  it("shows weaker marks faded by default", () => {
    expect(shownMarks(m, DEFAULTS.marks)).toEqual([
      { kind: "var", minor: true },
      { kind: "fat", minor: true },
      { kind: "quo", minor: false },
    ]);
  });
  it("respects hidden marks and minor switches", () => {
    const prefs = { ...DEFAULTS.marks, var: { ...DEFAULTS.marks.var, minor: false }, quo: { ...DEFAULTS.marks.quo, show: false } };
    expect(shownMarks(m, prefs)).toEqual([{ kind: "fat", minor: true }]);
    expect(shownMarks({ ...m, pre_nicene: 1 }, prefs)).toEqual([{ kind: "fat", minor: false }]);
  });
});

describe("SettingsProvider", () => {
  it("applies saved overrides to <html>", async () => {
    const { act, createElement } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { SettingsProvider } = await import("./settings");
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.setItem(
      "testimonia.settings.v1",
      JSON.stringify({
        theme: "light",
        colors: { light: { accent: "#8c2f2f" } },
        marks: { fat: { color: "#123456" } },
        display: { headings: false },
        fonts: { text: "spectral" },
      }),
    );
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(SettingsProvider, null)));
    const html = document.documentElement;
    expect(html.style.getPropertyValue("--accent")).toBe("#8c2f2f");
    expect(html.style.getPropertyValue("--mk-fat")).toBe("#123456");
    expect(html.style.getPropertyValue("--font-text")).toContain("Spectral");
    expect(html.getAttribute("data-headings")).toBe("off");
    expect(html.getAttribute("data-versenumbers")).toBe("on");
    await act(async () => root.unmount());
  });
});
