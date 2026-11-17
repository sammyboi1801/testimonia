import { beforeEach, describe, expect, it } from "vitest";
import { defaultConfig, forgetKeys, hasAnyKey, loadKey, saveConfig, saveKey } from "./providers";

const use = (preset: string) => saveConfig({ ...defaultConfig(), preset });

describe("assistant keys", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("keeps a key per provider, so a provider chosen on another device never gets this one's key", () => {
    use("anthropic");
    saveKey("sk-ant-1", true);
    use("deepseek"); // as when the choice syncs from another device
    expect(loadKey()).toBe("");
    saveKey("sk-ds-2", false);
    expect(loadKey()).toBe("sk-ds-2");
    use("anthropic");
    expect(loadKey()).toBe("sk-ant-1");
  });

  it("gives a key saved the old way to the provider chosen now", () => {
    use("openai");
    localStorage.setItem("testimonia.ai.key", "sk-old");
    expect(loadKey()).toBe("sk-old");
    expect(localStorage.getItem("testimonia.ai.key")).toBeNull();
    use("groq");
    expect(loadKey()).toBe("");
  });

  it("forgets every provider's key", () => {
    use("anthropic");
    saveKey("a", true);
    use("openai");
    saveKey("b", false);
    expect(hasAnyKey()).toBe(true);
    forgetKeys();
    expect(hasAnyKey()).toBe(false);
  });
});
