import { describe, it, expect } from "vitest";
import { scopeAccounts } from "./recurring-sections";

const accounts = [{ id: "a" }, { id: "b" }, { id: "c" }];

describe("scopeAccounts", () => {
  it("offers everything when no plan scopes the page", () => {
    expect(scopeAccounts(accounts, null)).toHaveLength(3);
  });

  it("offers only the plan's own accounts", () => {
    expect(scopeAccounts(accounts, ["b", "c"]).map((a) => a.id)).toEqual(["b", "c"]);
  });

  it("falls back to everything rather than an empty picker", () => {
    expect(scopeAccounts(accounts, [])).toHaveLength(3);
    expect(scopeAccounts(accounts, ["gone"])).toHaveLength(3);
  });
});
