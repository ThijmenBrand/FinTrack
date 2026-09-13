import { describe, it, expect } from "vitest";
import { bandByPlan } from "./category-picker";

const cats = [{ id: "a" }, { id: "b" }, { id: "c" }];

describe("bandByPlan", () => {
  it("leaves the list flat for an account outside a plan", () => {
    const { rest, banded } = bandByPlan(cats, null);
    expect(banded).toBe(false);
    expect(rest).toEqual(cats);
  });

  it("puts the plan's categories first and keeps the rest, in order", () => {
    const { inPlan, rest, banded } = bandByPlan(cats, new Set(["c", "a"]));
    expect(banded).toBe(true);
    expect(inPlan.map((c) => c.id)).toEqual(["a", "c"]);
    expect(rest.map((c) => c.id)).toEqual(["b"]);
  });

  it("hides nothing — every category lands in one band or the other", () => {
    const { inPlan, rest } = bandByPlan(cats, new Set(["b"]));
    expect([...inPlan, ...rest].map((c) => c.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("stays flat when the plan covers every category", () => {
    const { rest, banded } = bandByPlan(cats, new Set(["a", "b", "c"]));
    expect(banded).toBe(false);
    expect(rest).toEqual(cats);
  });

  it("stays flat when the plan covers none of them", () => {
    const { banded, rest } = bandByPlan(cats, new Set(["zzz"]));
    expect(banded).toBe(false);
    expect(rest).toEqual(cats);
  });
});
