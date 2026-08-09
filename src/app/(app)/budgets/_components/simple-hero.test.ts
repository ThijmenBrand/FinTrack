import { describe, expect, it } from "vitest";
import { moodFor } from "./simple-hero";

describe("moodFor", () => {
  it("walks the ladder on its boundaries", () => {
    expect(moodFor(0).line).toBe("budgets.simple.mood.great");
    expect(moodFor(0.5).line).toBe("budgets.simple.mood.great");
    expect(moodFor(0.51).line).toBe("budgets.simple.mood.good");
    expect(moodFor(0.8).line).toBe("budgets.simple.mood.good");
    expect(moodFor(0.81).line).toBe("budgets.simple.mood.tight");
    expect(moodFor(1).line).toBe("budgets.simple.mood.tight");
    expect(moodFor(1.01).line).toBe("budgets.simple.mood.over");
    expect(moodFor(Infinity).line).toBe("budgets.simple.mood.over");
  });
});
