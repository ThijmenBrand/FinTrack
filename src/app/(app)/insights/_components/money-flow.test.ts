import { describe, expect, it } from "vitest";
import { legFilters } from "./money-flow";

describe("legFilters", () => {
  it("sends the in side to income and the out side to expenses", () => {
    expect(legFilters("a1", "in:c-woning")).toEqual({
      account: "a1",
      category: "c-woning",
      type: "income",
    });
    expect(legFilters("a1", "cat:c-woning")).toEqual({
      account: "a1",
      category: "c-woning",
      type: "expense",
    });
  });

  it("maps transfers and reimbursements to their type only", () => {
    expect(legFilters("a1", "acct:a2")).toEqual({
      account: "a1",
      type: "internal_transfer",
    });
    expect(legFilters("a1", "in:__reimb")).toEqual({
      account: "a1",
      type: "reimbursement",
    });
  });

  it("drops the account filter for a node click", () => {
    expect(legFilters(null, "cat:c-woning")).toEqual({
      category: "c-woning",
      type: "expense",
    });
    // A transfer bar with no account side names no filterable pair.
    expect(legFilters(null, "acct:a2")).toBeNull();
  });

  it("leaves the aggregate legs unfiltered", () => {
    for (const id of [
      "cat:other",
      "in:other",
      "cat:none",
      "cat:__left",
      "in:__balance",
      "acct:external",
    ]) {
      expect(legFilters("a1", id)).toBeNull();
    }
  });
});
