import { describe, it, expect } from "vitest";
import {
  callerShareOf,
  evenSplitPercents,
  memberSharePercents,
  planIsShared,
  splitShares,
} from "./budget-split";

describe("evenSplitPercents", () => {
  it("halves the budget between the owner and one other person", () => {
    expect(evenSplitPercents(1)).toEqual({ owner: 50, each: 50 });
  });

  it("gives the owner the remainder so the key still adds up to 100", () => {
    const { owner, each } = evenSplitPercents(2);
    expect({ owner, each }).toEqual({ owner: 34, each: 33 });
    expect(owner + each * 2).toBe(100);
  });

  it("leaves a solo owner carrying the whole budget", () => {
    expect(evenSplitPercents(0)).toEqual({ owner: 100, each: 100 });
  });
});

const plan = (role: "owner" | "editor" | "viewer", pct: number) => ({
  role,
  sharePercent: pct,
  accounts: [{ id: "joint", name: "Joint", type: "joint" }],
});

const account = (id: string, sharedWith: number) => ({ id, sharedWith });

describe("planIsShared", () => {
  it("is false for an own plan whose accounts are shared with nobody", () => {
    expect(planIsShared(plan("owner", 60), [account("joint", 0)])).toBe(false);
  });

  it("is true once one of the plan's own accounts is shared out", () => {
    expect(planIsShared(plan("owner", 60), [account("joint", 1)])).toBe(true);
  });

  it("ignores sharing on accounts outside the plan", () => {
    expect(
      planIsShared(plan("owner", 60), [account("joint", 0), account("other", 2)]),
    ).toBe(false);
  });

  it("is true for a plan reached through someone else's account", () => {
    expect(planIsShared(plan("viewer", 60), [])).toBe(true);
  });
});

describe("memberSharePercents", () => {
  it("hands a lone member the whole remainder — the old two-party key", () => {
    expect(memberSharePercents(["a@x"], 60, null)).toEqual({ "a@x": 40 });
  });

  it("splits the remainder evenly between members who have no key", () => {
    expect(memberSharePercents(["a@x", "b@x"], 40, {})).toEqual({
      "a@x": 30,
      "b@x": 30,
    });
  });

  it("keeps stored keys and gives the rest to whoever has none", () => {
    expect(memberSharePercents(["a@x", "b@x"], 50, { "a@x": 40 })).toEqual({
      "a@x": 40,
      "b@x": 10,
    });
  });

  it("still adds up to 100 when the even split does not divide", () => {
    const shares = memberSharePercents(["c@x", "a@x", "b@x"], 40, null);
    expect(Object.values(shares).reduce((s, p) => s + p, 0)).toBe(60);
    // Sorted, so the owner and every member resolve the leftover the same way.
    expect(shares).toEqual({ "a@x": 20, "b@x": 20, "c@x": 20 });
    expect(memberSharePercents(["b@x", "a@x"], 1, null)).toEqual({
      "a@x": 50,
      "b@x": 49,
    });
  });

  it("gives nobody a negative share when the stored keys overshoot", () => {
    expect(memberSharePercents(["a@x", "b@x"], 90, { "a@x": 30 })).toEqual({
      "a@x": 30,
      "b@x": 0,
    });
  });

  it("hands out nothing when the owner carries everything", () => {
    expect(memberSharePercents(["a@x", "b@x"], 100, null)).toEqual({
      "a@x": 0,
      "b@x": 0,
    });
  });

  it("returns an empty key for a plan nobody shares", () => {
    expect(memberSharePercents([], 50, null)).toEqual({});
  });
});

describe("callerShareOf", () => {
  it("splits an amount by the caller's own percent", () => {
    expect(callerShareOf(2000, plan("owner", 60))).toBe(1200);
    expect(callerShareOf(2000, plan("viewer", 40))).toBe(800);
  });

  it("keeps every side adding back to the whole on a key that does not divide evenly", () => {
    // 33/33/34 of 100 — the three shares must still reconstruct the budgeted
    // total, or the shared-budget line would quietly lose (or invent) a euro.
    const total = [33, 33, 34].reduce((sum, pct) => sum + callerShareOf(100, plan("owner", pct)), 0);
    expect(total).toBeCloseTo(100, 10);
  });

  it("splits a negative amount the same way", () => {
    expect(callerShareOf(-2000, plan("owner", 60))).toBe(-1200);
  });

  it("passes zero through rather than producing NaN", () => {
    expect(callerShareOf(0, plan("owner", 60))).toBe(0);
  });

  it("hands the whole budget to one side at 0 and 100", () => {
    expect(callerShareOf(2000, plan("owner", 100))).toBe(2000);
    expect(callerShareOf(2000, plan("viewer", 0))).toBe(0);
  });
});

describe("splitShares", () => {
  const LABELS = { you: "You", others: "Others" };
  const owned = (ownerPct: number, stored: Record<string, number> | null = null) => ({
    role: "owner" as const,
    accounts: [{ id: "joint", name: "Joint", type: "joint" }],
    ownerName: null,
    ownerSharePercent: ownerPct,
    sharePercents: stored ?? {},
    sharePercent: ownerPct,
  });
  const jointWith = (...people: { name: string | null; email: string | null }[]) => [
    {
      id: "joint",
      sharedWith: people.length,
      sharedWithUsers: people.map((p) => ({ ...p, image: null })),
    },
  ];

  it("is empty on a budget nobody shares", () => {
    expect(splitShares(owned(50), [{ id: "joint", sharedWith: 0, sharedWithUsers: [] }], LABELS)).toEqual([]);
  });

  it("names the caller first, then each member on their resolved percent", () => {
    expect(
      splitShares(
        owned(60),
        jointWith({ name: "Sanne", email: "sanne@x.dev" }),
        LABELS,
      ),
    ).toEqual([
      { name: "You", percent: 60 },
      { name: "Sanne", percent: 40 },
    ]);
  });

  it("splits by the stored key rather than evenly once one is set", () => {
    expect(
      splitShares(
        owned(40, { "a@x.dev": 45 }),
        jointWith(
          { name: "Ada", email: "a@x.dev" },
          { name: "Bo", email: "b@x.dev" },
        ),
        LABELS,
      ),
    ).toEqual([
      { name: "You", percent: 40 },
      { name: "Ada", percent: 45 },
      { name: "Bo", percent: 15 },
    ]);
  });

  it("shows a pending invite under the address it was sent to", () => {
    expect(
      splitShares(owned(70), jointWith({ name: null, email: "new@x.dev" }), LABELS),
    ).toEqual([
      { name: "You", percent: 70 },
      { name: "new@x.dev", percent: 30 },
    ]);
  });

  it("counts one share for someone invited on several of the plan's accounts", () => {
    const person = { name: "Sanne", image: null, email: "sanne@x.dev" };
    const shares = splitShares(
      { ...owned(50), accounts: [
        { id: "joint", name: "Joint", type: "joint" },
        { id: "savings", name: "Savings", type: "checking" },
      ] },
      [
        { id: "joint", sharedWith: 1, sharedWithUsers: [person] },
        { id: "savings", sharedWith: 1, sharedWithUsers: [person] },
      ],
      LABELS,
    );
    expect(shares).toEqual([
      { name: "You", percent: 50 },
      { name: "Sanne", percent: 50 },
    ]);
  });

  it("adds up to the whole budget for every key it returns", () => {
    for (const ownerPct of [0, 33, 50, 100]) {
      const shares = splitShares(
        owned(ownerPct),
        jointWith(
          { name: "Ada", email: "a@x.dev" },
          { name: "Bo", email: "b@x.dev" },
        ),
        LABELS,
      );
      expect(shares.reduce((sum, s) => sum + s.percent, 0)).toBe(100);
    }
  });

  it("names the owner and the caller on a shared-in plan, the rest anonymously", () => {
    expect(
      splitShares(
        {
          role: "viewer",
          accounts: [{ id: "theirs", name: "Joint", type: "joint" }],
          ownerName: "Thijmen",
          ownerSharePercent: 50,
          // Never sent to a member — the other addresses are not theirs to see.
          sharePercents: {},
          sharePercent: 30,
        },
        [],
        LABELS,
      ),
    ).toEqual([
      { name: "Thijmen", percent: 50 },
      { name: "You", percent: 30 },
      { name: "Others", percent: 20 },
    ]);
  });

  it("leaves out the remainder when a shared-in plan has only two sides", () => {
    expect(
      splitShares(
        {
          role: "viewer",
          accounts: [{ id: "theirs", name: "Joint", type: "joint" }],
          ownerName: "Thijmen",
          ownerSharePercent: 65,
          sharePercents: {},
          sharePercent: 35,
        },
        [],
        LABELS,
      ),
    ).toEqual([
      { name: "Thijmen", percent: 65 },
      { name: "You", percent: 35 },
    ]);
  });
});

describe("planIsShared — further cases", () => {
  it("is true when only one of several plan accounts is shared out", () => {
    const multi = {
      role: "owner" as const,
      accounts: [
        { id: "solo", name: "Solo", type: "checking" },
        { id: "joint", name: "Joint", type: "joint" },
      ],
    };
    expect(planIsShared(multi, [account("solo", 0), account("joint", 2)])).toBe(true);
  });

  it("is false for a plan with no accounts at all", () => {
    expect(
      planIsShared({ role: "owner", accounts: [] }, [account("joint", 3)]),
    ).toBe(false);
  });

  it("is false when the accounts list has not loaded yet", () => {
    // The budgets page renders before /api/accounts resolves; an empty list
    // must read as "not shared" rather than throwing or flashing a share line.
    expect(planIsShared(plan("owner", 60), [])).toBe(false);
  });

  it("is true for an editor, who by definition reached the plan through a share", () => {
    expect(planIsShared(plan("editor", 60), [])).toBe(true);
  });
});
