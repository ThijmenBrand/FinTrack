import { describe, it, expect } from "vitest";
import { formatDayHeading } from "./day-heading";

const labels = { today: "Today", yesterday: "Yesterday" };
const now = new Date(2026, 9, 2, 14, 30); // Fri 2 Oct 2026, local

describe("formatDayHeading", () => {
  it("names today and yesterday", () => {
    expect(formatDayHeading("2026-10-02", now, "en-GB", labels)).toBe("Today");
    expect(formatDayHeading("2026-10-01", now, "en-GB", labels)).toBe("Yesterday");
  });

  it("crosses a month boundary for yesterday", () => {
    const firstOfMonth = new Date(2026, 9, 1, 9, 0);
    expect(formatDayHeading("2026-09-30", firstOfMonth, "en-GB", labels)).toBe("Yesterday");
  });

  it("spells out older days without the current year", () => {
    expect(formatDayHeading("2026-09-28", now, "en-GB", labels)).toBe("Monday 28 September");
  });

  it("adds the year once the day is in another year", () => {
    expect(formatDayHeading("2025-12-31", now, "en-GB", labels)).toBe("Wednesday, 31 December 2025");
  });

  it("capitalises locales that write weekdays in lower case", () => {
    expect(formatDayHeading("2026-09-28", now, "nl-NL", labels)).toBe("Maandag 28 september");
  });

  it("ignores a time part on the date", () => {
    expect(formatDayHeading("2026-10-02T08:00:00", now, "en-GB", labels)).toBe("Today");
  });
});
