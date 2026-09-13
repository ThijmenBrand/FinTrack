import { describe, it, expect } from "vitest";
import {
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

describe("splitShares", () => {
  const LABELS = { you: "You", others: "Others" };
  /** Everything a key needs; each test overrides only the side it is about. */
  const base = {
    accounts: [{ id: "joint", name: "Joint", type: "joint" }],
    ownerName: null as string | null,
    ownerSharePercent: 50,
    sharePercents: {} as Record<string, number>,
    sharePercent: 50,
    splitMode: "percent" as const,
    ownerShareAmount: null as number | null,
    shareAmounts: {} as Record<string, number | null>,
    shareAmount: null as number | null,
    others: { fixedAmount: 0, restCount: 0 },
  };
  const owned = (ownerPct: number, stored: Record<string, number> | null = null) => ({
    ...base,
    role: "owner" as const,
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
  const pcts = (shares: { name: string; percent: number }[]) =>
    shares.map((s) => [s.name, s.percent]);
  const euros = (shares: { name: string; amount: number }[]) =>
    shares.map((s) => [s.name, s.amount]);

  it("is empty on a budget nobody shares", () => {
    expect(
      splitShares(owned(50), [{ id: "joint", sharedWith: 0, sharedWithUsers: [] }], LABELS, 1000),
    ).toEqual([]);
  });

  it("names the caller first, then each member on their resolved percent", () => {
    const shares = splitShares(
      owned(60),
      jointWith({ name: "Sanne", email: "sanne@x.dev" }),
      LABELS,
      2000,
    );
    expect(pcts(shares)).toEqual([
      ["You", 60],
      ["Sanne", 40],
    ]);
    expect(euros(shares)).toEqual([
      ["You", 1200],
      ["Sanne", 800],
    ]);
  });

  it("marks the caller's own row so a view need not match on the name", () => {
    const shares = splitShares(
      owned(60),
      jointWith({ name: "Sanne", email: "sanne@x.dev" }),
      LABELS,
      2000,
    );
    expect(shares.map((s) => s.isYou)).toEqual([true, false]);
  });

  it("splits by the stored key rather than evenly once one is set", () => {
    expect(
      pcts(
        splitShares(
          owned(40, { "a@x.dev": 45 }),
          jointWith(
            { name: "Ada", email: "a@x.dev" },
            { name: "Bo", email: "b@x.dev" },
          ),
          LABELS,
          1000,
        ),
      ),
    ).toEqual([
      ["You", 40],
      ["Ada", 45],
      ["Bo", 15],
    ]);
  });

  it("shows a pending invite under the address it was sent to", () => {
    expect(
      pcts(splitShares(owned(70), jointWith({ name: null, email: "new@x.dev" }), LABELS, 100)),
    ).toEqual([
      ["You", 70],
      ["new@x.dev", 30],
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
      1000,
    );
    expect(pcts(shares)).toEqual([
      ["You", 50],
      ["Sanne", 50],
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
        1000,
      );
      expect(shares.reduce((sum, s) => sum + s.percent, 0)).toBe(100);
      expect(shares.reduce((sum, s) => sum + s.amount, 0)).toBeCloseTo(1000, 10);
    }
  });

  it("passes a budget of nothing through rather than producing NaN", () => {
    const shares = splitShares(owned(50), jointWith({ name: "Ada", email: "a@x.dev" }), LABELS, 0);
    expect(euros(shares)).toEqual([
      ["You", 0],
      ["Ada", 0],
    ]);
  });

  it("names the owner and the caller on a shared-in plan, the rest anonymously", () => {
    expect(
      pcts(
        splitShares(
          {
            ...base,
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
          1000,
        ),
      ),
    ).toEqual([
      ["Thijmen", 50],
      ["You", 30],
      ["Others", 20],
    ]);
  });

  it("leaves out the remainder when a shared-in plan has only two sides", () => {
    expect(
      pcts(
        splitShares(
          {
            ...base,
            role: "viewer",
            accounts: [{ id: "theirs", name: "Joint", type: "joint" }],
            ownerName: "Thijmen",
            ownerSharePercent: 65,
            sharePercents: {},
            sharePercent: 35,
          },
          [],
          LABELS,
          1000,
        ),
      ),
    ).toEqual([
      ["Thijmen", 65],
      ["You", 35],
    ]);
  });
});

describe("splitShares — fixed amounts", () => {
  const LABELS = { you: "You", others: "Others" };
  const base = {
    accounts: [{ id: "joint", name: "Joint", type: "joint" }],
    ownerName: null as string | null,
    ownerSharePercent: 50,
    sharePercents: {} as Record<string, number>,
    sharePercent: 50,
    splitMode: "amount" as const,
    ownerShareAmount: null as number | null,
    shareAmounts: {} as Record<string, number | null>,
    shareAmount: null as number | null,
    others: { fixedAmount: 0, restCount: 0 },
  };
  const jointWith = (...emails: string[]) => [
    {
      id: "joint",
      sharedWith: emails.length,
      sharedWithUsers: emails.map((email) => ({ name: email.split("@")[0], email, image: null })),
    },
  ];
  const euros = (shares: { name: string; amount: number }[]) =>
    shares.map((s) => [s.name, s.amount]);

  it("gives the fixed share what it asks for and the rest to whoever is left", () => {
    const shares = splitShares(
      { ...base, role: "owner" as const, ownerShareAmount: 600 },
      jointWith("ada@x.dev"),
      LABELS,
      1463.9,
    );
    expect(euros(shares)).toEqual([
      ["You", 600],
      ["ada", 863.9],
    ]);
    expect(shares.map((s) => s.rest)).toEqual([false, true]);
  });

  it("reads the fixed share as its percentage of the budget it came out of", () => {
    const [mine] = splitShares(
      { ...base, role: "owner" as const, ownerShareAmount: 500 },
      jointWith("ada@x.dev"),
      LABELS,
      2000,
    );
    expect(mine.percent).toBe(25);
  });

  it("splits the whole budget evenly when nobody carries a fixed amount", () => {
    expect(
      euros(splitShares({ ...base, role: "owner" as const }, jointWith("ada@x.dev"), LABELS, 1000)),
    ).toEqual([
      ["You", 500],
      ["ada", 500],
    ]);
  });

  it("puts a member invited after the key was written on the rest, not on nothing", () => {
    expect(
      euros(
        splitShares(
          { ...base, role: "owner" as const, ownerShareAmount: 400, shareAmounts: { "ada@x.dev": 200 } },
          jointWith("ada@x.dev", "new@x.dev"),
          LABELS,
          1000,
        ),
      ),
    ).toEqual([
      ["You", 400],
      ["ada", 200],
      ["new", 400],
    ]);
  });

  it("hands the cents a division does not come out on to the first on the rest", () => {
    const shares = splitShares(
      { ...base, role: "owner" as const },
      jointWith("ada@x.dev", "bo@x.dev"),
      LABELS,
      100,
    );
    expect(euros(shares)).toEqual([
      ["You", 33.34],
      ["ada", 33.33],
      ["bo", 33.33],
    ]);
    expect(shares.reduce((sum, s) => sum + s.amount, 0)).toBeCloseTo(100, 10);
  });

  it("leaves the rest at nothing when the fixed shares already exceed the budget", () => {
    const shares = splitShares(
      { ...base, role: "owner" as const, ownerShareAmount: 1200 },
      jointWith("ada@x.dev"),
      LABELS,
      1000,
    );
    // The overrun is reported by the section that draws this, in words. Nobody
    // is owed money for being on a shared budget.
    expect(euros(shares)).toEqual([
      ["You", 1200],
      ["ada", 0],
    ]);
  });

  it("works out a shared-in caller's rest from the anonymous totals it is given", () => {
    const shares = splitShares(
      {
        ...base,
        role: "viewer" as const,
        accounts: [{ id: "theirs", name: "Joint", type: "joint" }],
        ownerName: "Thijmen",
        ownerShareAmount: 900,
        shareAmount: null,
        others: { fixedAmount: 100, restCount: 0 },
      },
      [],
      LABELS,
      1500,
    );
    expect(euros(shares)).toEqual([
      ["Thijmen", 900],
      ["You", 500],
      ["Others", 100],
    ]);
  });

  it("drops the anonymous row when nobody else is on the plan", () => {
    expect(
      euros(
        splitShares(
          {
            ...base,
            role: "viewer" as const,
            accounts: [{ id: "theirs", name: "Joint", type: "joint" }],
            ownerName: "Thijmen",
            ownerShareAmount: 900,
            shareAmount: null,
          },
          [],
          LABELS,
          1500,
        ),
      ),
    ).toEqual([
      ["Thijmen", 900],
      ["You", 600],
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
