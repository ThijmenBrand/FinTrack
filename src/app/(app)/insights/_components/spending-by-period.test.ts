import { describe, it, expect } from "vitest";
import { aggregateWeekly } from "./spending-by-period";

describe("aggregateWeekly", () => {
  it("buckets Monday–Sunday and reports that same range", () => {
    // Mon 3 Aug 2026 … Sun 9 Aug 2026, plus the Monday after.
    const [week, next] = aggregateWeekly([
      { date: "2026-08-03", expenses: 10 },
      { date: "2026-08-09", expenses: 5 },
      { date: "2026-08-10", expenses: 1 },
    ]);
    expect(week).toMatchObject({
      start: "2026-08-03",
      end: "2026-08-09",
      expenses: 15,
    });
    expect(next.start).toBe("2026-08-10");
  });
});
