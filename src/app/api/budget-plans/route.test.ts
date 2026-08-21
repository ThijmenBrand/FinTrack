import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { setupTestDb, type TestDb } from "@/lib/test-db";

const USER = "plans-route-user";

// The route only needs the caller's id; everything else is real DB work.
vi.mock("@/lib/auth", () => ({
  withUser: (handler: (userId: string) => Promise<Response>) => handler(USER),
}));

let testDb: TestDb;

beforeAll(async () => {
  testDb = await setupTestDb("budget-plans-route");
});
afterAll(async () => {
  await testDb.cleanup();
});
beforeEach(async () => {
  await testDb.reset();
  const now = new Date().toISOString();
  await testDb.client.execute({
    sql: `INSERT INTO "user" (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    args: [USER, USER, "plans-route@test.dev", Date.now(), Date.now()],
  });
  await testDb.client.execute({
    sql: `INSERT INTO accounts (id, user_id, name, type, currency, initial_balance, sort_order, created_at, updated_at)
          VALUES ('r-check', ?, 'Checking', 'checking', 'EUR', 0, 0, ?, ?)`,
    args: [USER, now, now],
  });
  await testDb.client.execute({
    sql: `INSERT INTO categories (id, user_id, name, created_at) VALUES ('r-cat', ?, 'Groceries', ?)`,
    args: [USER, now],
  });
  // A pre-plan allocation: what a user created after 0009 (so no Main plan was
  // ever backfilled for them) ends up with.
  await testDb.client.execute({
    sql: `INSERT INTO budgets (id, user_id, budget_id, category_id, amount, period, is_active, status, source, created_at)
          VALUES ('r-budget', ?, NULL, 'r-cat', 250, 'monthly', 1, 'active', 'manual', ?)`,
    args: [USER, now],
  });
});

const budgetPlanIds = async () =>
  (await testDb.client.execute("SELECT budget_id FROM budgets")).rows.map(
    (r) => r.budget_id as string | null,
  );

describe("POST /api/budget-plans", () => {
  it("adopts pre-plan allocations into the user's first plan", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://x/api/budget-plans", {
        method: "POST",
        body: JSON.stringify({ name: "Main", accountIds: ["r-check"] }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    );
    expect(res.status).toBe(201);
    const { id } = await res.json();
    expect(await budgetPlanIds()).toEqual([id]);
  });

  it("refuses to create a plan when the user has no budgetable account", async () => {
    await testDb.client.execute("DELETE FROM accounts");
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://x/api/budget-plans", {
        method: "POST",
        body: JSON.stringify({ name: "Main" }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    );
    expect(res.status).toBe(400);
  });

  it("leaves allocations alone when a plan already exists", async () => {
    const { POST } = await import("./route");
    const mk = (name: string) =>
      POST(
        new Request("http://x/api/budget-plans", {
          method: "POST",
          body: JSON.stringify({ name }),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any,
      );
    const first = await (await mk("Main")).json();
    await mk("Joint");
    // Still attached to the first plan, not moved by the second create.
    expect(await budgetPlanIds()).toEqual([first.id]);
  });
});

describe("PUT /api/budget-plans — cost-split key", () => {
  const createPlan = async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://x/api/budget-plans", {
        method: "POST",
        body: JSON.stringify({ name: "Joint", accountIds: ["r-check"] }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    );
    return (await res.json()).id as string;
  };

  const put = async (body: unknown) => {
    const { PUT } = await import("./route");
    return PUT(
      new Request("http://x/api/budget-plans", {
        method: "PUT",
        body: JSON.stringify(body),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    );
  };

  const sharePercentOf = async (id: string) =>
    (
      await testDb.client.execute({
        sql: "SELECT owner_share_percent FROM budget_plans WHERE id = ?",
        args: [id],
      })
    ).rows[0].owner_share_percent;

  it("defaults a new plan to an even split", async () => {
    expect(await sharePercentOf(await createPlan())).toBe(50);
  });

  it("stores a 60/40 key and hands it back on GET", async () => {
    const id = await createPlan();
    expect((await put({ id, ownerSharePercent: 60 })).status).toBe(200);
    expect(await sharePercentOf(id)).toBe(60);

    const { GET } = await import("./route");
    const { plans } = await (await GET()).json();
    expect(plans.find((p: { id: string }) => p.id === id).ownerSharePercent).toBe(60);
  });

  it("rejects keys outside 0–100 and non-integers, leaving the stored one alone", async () => {
    const id = await createPlan();
    await put({ id, ownerSharePercent: 60 });
    for (const bad of [-1, 101, 60.5, "60", null]) {
      expect((await put({ id, ownerSharePercent: bad })).status).toBe(400);
    }
    expect(await sharePercentOf(id)).toBe(60);
  });

  it("accepts the 0 and 100 boundaries — one side may carry everything", async () => {
    const id = await createPlan();
    for (const edge of [0, 100]) {
      expect((await put({ id, ownerSharePercent: edge })).status).toBe(200);
      expect(await sharePercentOf(id)).toBe(edge);
    }
  });

  it("leaves the stored key alone when the field is absent from the update", async () => {
    // The dialog omits the field entirely on an unshared plan; a rename must
    // not silently reset the key to the 50 default.
    const id = await createPlan();
    await put({ id, ownerSharePercent: 70 });
    expect((await put({ id, name: "Renamed" })).status).toBe(200);
    expect(await sharePercentOf(id)).toBe(70);
  });

  it("does not let one user's update reach another user's plan", async () => {
    const id = await createPlan();
    await testDb.client.execute({
      sql: `INSERT INTO budget_plans (id, user_id, name, is_main, period, owner_share_percent, created_at, updated_at)
            VALUES ('foreign-plan', 'someone-else', 'Theirs', 0, 'monthly', 50, ?, ?)`,
      args: [new Date().toISOString(), new Date().toISOString()],
    });

    await put({ id: "foreign-plan", ownerSharePercent: 90 });
    expect(await sharePercentOf("foreign-plan")).toBe(50);
    expect(await sharePercentOf(id)).toBe(50);
  });
});

describe("POST /api/budget-plans — cost-split key", () => {
  const post = async (body: unknown) => {
    const { POST } = await import("./route");
    return POST(
      new Request("http://x/api/budget-plans", {
        method: "POST",
        body: JSON.stringify(body),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    );
  };

  const planCount = async () =>
    Number(
      (await testDb.client.execute("SELECT COUNT(*) AS n FROM budget_plans")).rows[0].n,
    );

  it("stores a key given at creation time", async () => {
    const res = await post({ name: "Joint", accountIds: ["r-check"], ownerSharePercent: 65 });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const stored = (
      await testDb.client.execute({
        sql: "SELECT owner_share_percent FROM budget_plans WHERE id = ?",
        args: [id],
      })
    ).rows[0].owner_share_percent;
    expect(stored).toBe(65);
  });

  it("stores an explicit 0 rather than falling back to the 50 default", async () => {
    // 0 is falsy — a `ownerSharePercent || 50` style guard would lose it.
    const { id } = await (
      await post({ name: "Theirs", accountIds: ["r-check"], ownerSharePercent: 0 })
    ).json();
    const stored = (
      await testDb.client.execute({
        sql: "SELECT owner_share_percent FROM budget_plans WHERE id = ?",
        args: [id],
      })
    ).rows[0].owner_share_percent;
    expect(stored).toBe(0);
  });

  it.each([-1, 101, 60.5, "60", null, NaN])(
    "rejects %p at creation and creates no plan",
    async (bad) => {
      const before = await planCount();
      const res = await post({ name: "Joint", accountIds: ["r-check"], ownerSharePercent: bad });
      expect(res.status).toBe(400);
      expect(await planCount()).toBe(before);
    },
  );
});

describe("cost-split key — one percentage per person", () => {
  const call = async (method: "POST" | "PUT", body: unknown) => {
    const route = await import("./route");
    return route[method](
      new Request("http://x/api/budget-plans", {
        method,
        body: JSON.stringify(body),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    );
  };

  const createPlan = async () =>
    (await (await call("POST", { name: "Joint", accountIds: ["r-check"] })).json())
      .id as string;

  const storedShares = async (id: string) =>
    (
      await testDb.client.execute({
        sql: "SELECT share_percents FROM budget_plans WHERE id = ?",
        args: [id],
      })
    ).rows[0].share_percents;

  const plansOfCaller = async () => {
    const { GET } = await import("./route");
    return (await (await GET()).json()).plans;
  };

  it("stores a three-way key and hands it back to the owner", async () => {
    const id = await createPlan();
    const res = await call("PUT", {
      id,
      ownerSharePercent: 50,
      sharePercents: { "a@x.dev": 30, "b@x.dev": 20 },
    });
    expect(res.status).toBe(200);
    expect(await storedShares(id)).toBe('{"a@x.dev":30,"b@x.dev":20}');

    const plan = (await plansOfCaller()).find((p: { id: string }) => p.id === id);
    expect(plan.sharePercents).toEqual({ "a@x.dev": 30, "b@x.dev": 20 });
    expect(plan.sharePercent).toBe(50);
  });

  // Padding the map with an address that is nobody used to make the total
  // reach 100 while the real members' shares quietly added up to less.
  it("drops keys for people the plan is not shared with", async () => {
    const now = new Date().toISOString();
    const id = await createPlan();
    await testDb.client.execute({
      sql: "UPDATE accounts SET budget_id = ? WHERE id = 'r-check'",
      args: [id],
    });
    await testDb.client.execute({
      sql: `INSERT INTO account_members (id, account_id, user_id, email, role, accepted_at, created_at)
            VALUES ('pm1', 'r-check', NULL, 'real@x.dev', 'viewer', NULL, ?)`,
      args: [now],
    });

    // 50 + 40 + 10 sums to 100, but "ghost" carries none of this budget.
    const padded = await call("PUT", {
      id,
      ownerSharePercent: 50,
      sharePercents: { "real@x.dev": 40, "ghost@x.dev": 10 },
    });
    expect(padded.status).toBe(400);
    expect(await storedShares(id)).toBeNull();

    // The same key without the padding is the honest one, and is accepted.
    expect(
      (await call("PUT", { id, ownerSharePercent: 50, sharePercents: { "real@x.dev": 50 } })).status,
    ).toBe(200);
    expect(await storedShares(id)).toBe('{"real@x.dev":50}');
  });

  it("rejects a key that does not add up to the whole budget", async () => {
    const id = await createPlan();
    await call("PUT", { id, ownerSharePercent: 50, sharePercents: { "a@x.dev": 50 } });
    for (const bad of [{ "a@x.dev": 30 }, { "a@x.dev": 60 }, { "a@x.dev": 25, "b@x.dev": 30 }]) {
      expect((await call("PUT", { id, ownerSharePercent: 50, sharePercents: bad })).status).toBe(400);
    }
    expect(await storedShares(id)).toBe('{"a@x.dev":50}');
  });

  it("rejects member percentages that are not whole numbers in range", async () => {
    const id = await createPlan();
    for (const bad of [{ "a@x.dev": 50.5 }, { "a@x.dev": -50 }, { "a@x.dev": "50" }, { "a@x.dev": 101 }, [50]]) {
      expect((await call("PUT", { id, ownerSharePercent: 50, sharePercents: bad })).status).toBe(400);
    }
    expect(await storedShares(id)).toBe(null);
  });

  it("stores a key given at creation time", async () => {
    const res = await call("POST", {
      name: "Joint",
      accountIds: ["r-check"],
      ownerSharePercent: 40,
      sharePercents: { "a@x.dev": 60 },
    });
    expect(res.status).toBe(201);
    expect(await storedShares((await res.json()).id)).toBe('{"a@x.dev":60}');
  });

  it("gives a member their own percentage, not the whole remainder", async () => {
    // A plan owned by someone else, shared with the caller and with a third
    // person: the caller must read their own 30, not 100 - 40.
    const now = new Date().toISOString();
    await testDb.client.execute({
      sql: `INSERT INTO "user" (id, name, email, created_at, updated_at) VALUES ('other', 'Other', 'other@x.dev', ?, ?)`,
      args: [Date.now(), Date.now()],
    });
    await testDb.client.execute({
      sql: `INSERT INTO budget_plans (id, user_id, name, is_main, period, owner_share_percent, share_percents, created_at, updated_at)
            VALUES ('their-plan', 'other', 'Theirs', 1, 'monthly', 40, '{"me@x.dev":30,"third@x.dev":30}', ?, ?)`,
      args: [now, now],
    });
    await testDb.client.execute({
      sql: `INSERT INTO accounts (id, user_id, name, type, currency, initial_balance, sort_order, budget_id, created_at, updated_at)
            VALUES ('their-joint', 'other', 'Joint', 'joint', 'EUR', 0, 0, 'their-plan', ?, ?)`,
      args: [now, now],
    });
    await testDb.client.execute({
      sql: `INSERT INTO account_members (id, account_id, user_id, email, role, accepted_at, created_at)
            VALUES ('m1', 'their-joint', ?, 'me@x.dev', 'viewer', ?, ?), ('m2', 'their-joint', NULL, 'third@x.dev', 'viewer', NULL, ?)`,
      args: [USER, now, now, now],
    });

    const shared = (await plansOfCaller()).find(
      (p: { id: string }) => p.id === "their-plan",
    );
    expect(shared.sharePercent).toBe(30);
    // The other members' addresses are not the caller's to see.
    expect(shared.sharePercents).toEqual({});
  });

  it("falls back to an even slice of the remainder for a member with no key", async () => {
    const now = new Date().toISOString();
    await testDb.client.execute({
      sql: `INSERT INTO "user" (id, name, email, created_at, updated_at) VALUES ('other', 'Other', 'other@x.dev', ?, ?)`,
      args: [Date.now(), Date.now()],
    });
    await testDb.client.execute({
      sql: `INSERT INTO budget_plans (id, user_id, name, is_main, period, owner_share_percent, share_percents, created_at, updated_at)
            VALUES ('their-plan', 'other', 'Theirs', 1, 'monthly', 40, NULL, ?, ?)`,
      args: [now, now],
    });
    await testDb.client.execute({
      sql: `INSERT INTO accounts (id, user_id, name, type, currency, initial_balance, sort_order, budget_id, created_at, updated_at)
            VALUES ('their-joint', 'other', 'Joint', 'joint', 'EUR', 0, 0, 'their-plan', ?, ?)`,
      args: [now, now],
    });
    await testDb.client.execute({
      sql: `INSERT INTO account_members (id, account_id, user_id, email, role, accepted_at, created_at)
            VALUES ('m1', 'their-joint', ?, 'me@x.dev', 'viewer', ?, ?), ('m2', 'their-joint', NULL, 'third@x.dev', 'viewer', NULL, ?)`,
      args: [USER, now, now, now],
    });

    const shared = (await plansOfCaller()).find(
      (p: { id: string }) => p.id === "their-plan",
    );
    expect(shared.sharePercent).toBe(30);
  });
});
