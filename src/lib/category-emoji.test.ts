import { describe, it, expect } from "vitest";
import { suggestEmoji } from "./category-emoji";

describe("suggestEmoji", () => {
  it("matches English and Dutch names, case-insensitively", () => {
    expect(suggestEmoji("Groceries")).toBe("🛒");
    expect(suggestEmoji("boodschappen")).toBe("🛒");
    expect(suggestEmoji("Openbaar vervoer / trein")).toBe("🚆");
    expect(suggestEmoji("Gym membership")).toBe("🏋️");
  });

  it("returns null when nothing matches", () => {
    expect(suggestEmoji("Zzz")).toBeNull();
    expect(suggestEmoji("")).toBeNull();
  });

  it("prefers the first matching rule for ambiguous names", () => {
    expect(suggestEmoji("Gas station")).toBe("⛽"); // not the utilities /gas\b/ rule
  });
});
