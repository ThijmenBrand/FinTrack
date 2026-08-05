import { describe, it, expect } from "vitest";
import { defaultScopeAccountIds } from "./account-scope";

const ACCOUNTS = [
  { id: "a", type: "checking" },
  { id: "b", type: "savings" },
  { id: "c", type: "checking" },
];

describe("defaultScopeAccountIds", () => {
  it("returns every checking account", () => {
    expect(defaultScopeAccountIds(ACCOUNTS, "b")).toEqual(["a", "c"]);
  });

  it("falls back to the default account when there is no checking account", () => {
    expect(defaultScopeAccountIds([{ id: "b", type: "savings" }], "b")).toEqual(["b"]);
  });

  it("scopes to everything when there is neither", () => {
    expect(defaultScopeAccountIds([{ id: "b", type: "savings" }], null)).toEqual([]);
  });
});
