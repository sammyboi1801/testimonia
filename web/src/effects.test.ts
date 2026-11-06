import { describe, expect, it } from "vitest";

// An effect written as `useEffect(() => something(), deps)` returns whatever something() returns, and React calls
// that as the cleanup. Browsers now return Promises from scroll methods, which crashed the app on unmount.
const sources = import.meta.glob(["./**/*.ts", "./**/*.tsx", "!./**/*.test.*"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

describe("effects", () => {
  it("never return a value by accident (always use a block body)", () => {
    const offenders = Object.entries(sources).flatMap(([file, text]) =>
      text
        .split("\n")
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => /use(Layout)?Effect\(\(\) => [^{(]/.test(line))
        .map(({ n }) => `${file}:${n}`),
    );
    expect(offenders).toEqual([]);
  });
});
