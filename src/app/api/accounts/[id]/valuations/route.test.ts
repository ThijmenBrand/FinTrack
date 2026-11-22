/**
 * The valuations endpoint.
 *
 * `accounts.currentValue` / `valuedAt` are a materialized copy of the newest
 * row in the history, and these tests pin that the copy can never drift: every
 * write and every delete re-derives it, including the awkward cases — a
 * backdated entry that must NOT become "current", and deleting the newest one,
 * which has to fall back to what is left rather than leaving a figure behind
 * with no row to support it.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { setupTestDb, type TestDb } from "@/lib/test-db";

const USER = "val-user";
const OTHER = "val-other";
let actor = USER;

vi.mock("@/lib/auth", () => ({
  withUser: async (handler: (userId: string) => Promise<Response>) => {
    try {
      return await handler(actor);
    } catch (e) {
      if (e instanceof Response) return e;
      throw e;
    }
  },
}));

let testDb: TestDb;
const NOW = new Date().toISOString();
const TODAY = NOW.slice(0, 10);

function tomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

beforeAll(async () => {
  testDb = await setupTestDb("valuations-route");
});
afterAll(() => testDb.cleanup());

beforeEach(async () => {
  actor = USER;
  await testDb.reset();
  for (const id of [USER, OTHER]) {
    await testDb.client.execute({
      sql: `INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)`,
      args: [id, id, `${id}@test.dev`],
    });
  }
  await testDb.client.execute({
    sql: `INSERT INTO accounts (id, user_id, name, type, currency, initial_balance, sort_order, created_at, updated_at)
          VALUES ('broker', ?, 'Broker', 'investment', 'EUR', 0, 0, ?, ?),
                 ('cash', ?, 'Main', 'checking', 'EUR', 0, 1, ?, ?),
                 ('theirs', ?, 'Theirs', 'investment', 'EUR', 0, 0, ?, ?)`,
    args: [USER, NOW, NOW, USER, NOW, NOW, OTHER, NOW, NOW],
  });
});

interface Row {
  id: string;
  date: string;
  value: number;
}

async function post(accountId: string, body: Record<string, unknown>) {
  const { POST } = await import("./route");
  const res = await POST(
    new Request("http://t", { method: "POST", body: JSON.stringify(body) }) as never,
    { params: Promise.resolve({ id: accountId }) },
  );
  return { status: res.status, body: await res.json() };
}

async function list(accountId: string) {
  const { GET } = await import("./route");
  const res = await GET(new Request("http://t") as never, {
    params: Promise.resolve({ id: accountId }),
  });
  return { status: res.status, body: (await res.json()) as Row[] };
}

async function del(accountId: string, valuationId: string) {
  const { DELETE } = await import("./[valuationId]/route");
  const res = await DELETE(new Request("http://t", { method: "DELETE" }) as never, {
    params: Promise.resolve({ id: accountId, valuationId }),
  });
  return { status: res.status, body: await res.json() };
}

/** The materialized pair on the account row. */
async function materialized(accountId = "broker") {
  const r = await testDb.client.execute({
    sql: `SELECT current_value, valued_at FROM accounts WHERE id = ?`,
    args: [accountId],
  });
  const row = r.rows[0] as Record<string, unknown>;
  return { value: row.current_value as number | null, date: row.valued_at as string | null };
}

describe("recording a value", () => {
  it("stores it and makes it the account's current figure", async () => {
    const res = await post("broker", { value: 1_000, date: TODAY });
    expect(res.status).toBe(201);
    expect(await materialized()).toEqual({ value: 1_000, date: TODAY });
  });

  it("replaces an earlier figure for the same date", async () => {
    await post("broker", { value: 1_000, date: TODAY });
    await post("broker", { value: 1_250, date: TODAY });

    const { body } = await list("broker");
    expect(body).toHaveLength(1);
    expect(body[0].value).toBe(1_250);
    expect(await materialized()).toEqual({ value: 1_250, date: TODAY });
  });

  it("does not let a backdated entry become the current figure", async () => {
    await post("broker", { value: 2_000, date: TODAY });
    await post("broker", { value: 1_000, date: "2020-01-01" });

    expect(await materialized()).toEqual({ value: 2_000, date: TODAY });
  });

  it("returns the history newest first", async () => {
    await post("broker", { value: 1, date: "2026-01-01" });
    await post("broker", { value: 2, date: "2026-02-01" });
    await post("broker", { value: 3, date: "2026-03-01" });

    const { body } = await list("broker");
    expect(body.map((v) => v.date)).toEqual(["2026-03-01", "2026-02-01", "2026-01-01"]);
  });

  it("refuses a date in the future", async () => {
    const res = await post("broker", { value: 1_000, date: tomorrow() });
    expect(res.status).toBe(400);
    expect(await materialized()).toEqual({ value: null, date: null });
  });

  it("refuses a negative value", async () => {
    expect((await post("broker", { value: -5, date: TODAY })).status).toBe(400);
  });

  it("refuses a malformed date or a non-numeric value", async () => {
    expect((await post("broker", { value: 1, date: "2026-02-30" })).status).toBe(400);
    expect((await post("broker", { value: "lots", date: TODAY })).status).toBe(400);
  });

  it("refuses an account that holds no investments", async () => {
    expect((await post("cash", { value: 1_000, date: TODAY })).status).toBe(400);
  });

  it("hides another user's account behind a 404", async () => {
    expect((await post("theirs", { value: 1_000, date: TODAY })).status).toBe(404);
    expect((await list("theirs")).status).toBe(404);
  });
});

describe("deleting a value", () => {
  it("falls back to the previous figure", async () => {
    await post("broker", { value: 1_000, date: "2026-01-01" });
    const { body } = await post("broker", { value: 2_000, date: "2026-02-01" });
    const newest = (body as Row[])[0];

    const res = await del("broker", newest.id);
    expect(res.status).toBe(200);
    expect(await materialized()).toEqual({ value: 1_000, date: "2026-01-01" });
  });

  it("goes back to not-valued when the last one goes", async () => {
    const { body } = await post("broker", { value: 1_000, date: TODAY });
    await del("broker", (body as Row[])[0].id);

    expect(await materialized()).toEqual({ value: null, date: null });
    expect((await list("broker")).body).toEqual([]);
  });

  it("404s an id that is not there", async () => {
    expect((await del("broker", "nope")).status).toBe(404);
  });

  it("will not delete a value through the wrong account", async () => {
    const { body } = await post("broker", { value: 1_000, date: TODAY });
    const id = (body as Row[])[0].id;

    actor = OTHER;
    expect((await del("theirs", id)).status).toBe(404);

    actor = USER;
    expect((await list("broker")).body).toHaveLength(1);
  });
});
