import { describe, it, expect } from "vitest";
import { detectSubscriptions, merchantKey, type DetectRow } from "./subscription-detect";
import type { MatchablePlan } from "./recurring-match";

const TODAY = "2026-10-06";

function charge(date: string, amount = -13.99, name: string | null = "NETFLIX.COM", extra: Partial<DetectRow> = {}): DetectRow {
  return { accountId: "acc", date, name, description: `${name ?? ""} ref ${date}`, amount, categoryId: "c-subs", ...extra };
}

const plan = (p: Partial<MatchablePlan>): MatchablePlan => ({
  id: "plan",
  accountId: "acc",
  description: "Netflix",
  amount: -13.99,
  type: "expense",
  isActive: true,
  matchPattern: null,
  matchField: "name",
  ...p,
});

describe("merchantKey", () => {
  it("ignores reference numbers and case", () => {
    expect(merchantKey("NETFLIX.COM 0123", "x")).toBe(merchantKey("Netflix.com 0456", "y"));
  });

  it("falls back to the memo when the name is only a payment processor", () => {
    expect(merchantKey("Stichting Mollie Payments", "Gym Utrecht maandabonnement 2026")).toBe("gym utrecht maandabonnement");
  });

  it("gives up on text with nothing recognisable", () => {
    expect(merchantKey(null, "123 456")).toBeNull();
  });
});

describe("detectSubscriptions", () => {
  it("spots three monthly charges of about the same amount", () => {
    const found = detectSubscriptions(
      [charge("2026-08-04"), charge("2026-09-04"), charge("2026-10-03", -14.49)],
      [],
      TODAY,
    );
    expect(found).toEqual([
      {
        key: "acc:netflix com",
        merchant: "NETFLIX.COM",
        amount: 13.99,
        frequency: "monthly",
        accountId: "acc",
        categoryId: "c-subs",
        count: 3,
        firstDate: "2026-08-04",
        lastDate: "2026-10-03",
      },
    ]);
  });

  it("spots a weekly one", () => {
    const found = detectSubscriptions(
      [charge("2026-09-15", -5, "Bakker Bart"), charge("2026-09-22", -5, "Bakker Bart"), charge("2026-09-29", -5, "Bakker Bart"), charge("2026-10-06", -5, "Bakker Bart")],
      [],
      TODAY,
    );
    expect(found).toMatchObject([{ frequency: "weekly", count: 4, amount: 5 }]);
  });

  it("needs three charges, a steady beat and a steady amount", () => {
    expect(detectSubscriptions([charge("2026-09-04"), charge("2026-10-04")], [], TODAY)).toEqual([]);
    expect(detectSubscriptions([charge("2026-07-04"), charge("2026-09-04"), charge("2026-10-04")], [], TODAY)).toEqual([]);
    expect(
      detectSubscriptions([charge("2026-08-04", -40, "Albert Heijn"), charge("2026-09-04", -95, "Albert Heijn"), charge("2026-10-04", -12, "Albert Heijn")], [], TODAY),
    ).toEqual([]);
  });

  it("doesn't raise old history", () => {
    expect(detectSubscriptions([charge("2026-05-04"), charge("2026-06-04"), charge("2026-07-04")], [], TODAY)).toEqual([]);
  });

  it("stays quiet when a plan already covers it, even a paused one", () => {
    const rows = [charge("2026-08-04"), charge("2026-09-04"), charge("2026-10-04")];
    expect(detectSubscriptions(rows, [plan({})], TODAY)).toEqual([]);
    expect(detectSubscriptions(rows, [plan({ isActive: false })], TODAY)).toEqual([]);
    expect(detectSubscriptions(rows, [plan({ description: "Spotify", matchPattern: "netflix" })], TODAY)).toEqual([]);
    // A plan on another account is another account's business.
    expect(detectSubscriptions(rows, [plan({ accountId: "other" })], TODAY)).toHaveLength(1);
  });

  it("keeps the same merchant on two accounts apart", () => {
    const rows = [
      charge("2026-08-04"),
      charge("2026-09-04", -13.99, "NETFLIX.COM", { accountId: "other" }),
      charge("2026-10-04"),
    ];
    expect(detectSubscriptions(rows, [], TODAY)).toEqual([]);
  });
});
