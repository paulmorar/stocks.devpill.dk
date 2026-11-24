import { describe, expect, it } from "vitest";
import { isSearchShortcut, latestGate, moveHighlight, pushRecent } from "@/lib/search";

const key = (k: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, ...mods });

describe("header search helpers", () => {
  it("opens on Cmd+K or Ctrl+K only", () => {
    expect(isSearchShortcut(key("k", { metaKey: true }))).toBe(true);
    expect(isSearchShortcut(key("K", { ctrlKey: true }))).toBe(true);
    expect(isSearchShortcut(key("k"))).toBe(false);
    expect(isSearchShortcut(key("k", { ctrlKey: true, altKey: true }))).toBe(false);
  });

  it("keeps recent symbols newest first, without duplicates, and capped", () => {
    expect(pushRecent(["MSFT", "AAPL"], "aapl")).toEqual(["AAPL", "MSFT"]);
    expect(pushRecent(["A", "B", "C"], "D", 3)).toEqual(["D", "A", "B"]);
    expect(pushRecent(["A"], "  ")).toEqual(["A"]);
  });

  it("wraps arrow-key movement and copes with an empty list", () => {
    expect(moveHighlight(2, 1, 3)).toBe(0);
    expect(moveHighlight(0, -1, 3)).toBe(2);
    expect(moveHighlight(5, 1, 0)).toBe(0);
  });

  it("lets only the newest request update the results", async () => {
    const gate = latestGate();
    const shown: string[] = [];
    const search = (q: string, ms: number) => {
      const id = gate.next();
      return new Promise<void>((done) => setTimeout(() => (gate.isCurrent(id) && shown.push(q), done()), ms));
    };
    await Promise.all([search("ap", 30), search("apple", 5)]);
    expect(shown).toEqual(["apple"]);
  });
});
