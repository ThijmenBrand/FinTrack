/**
 * Deleting a user removes their pot budget rows by hand: hosted libsql doesn't
 * promise `foreign_keys=ON`, so the cascades on user_id may never fire. The
 * test runs with FKs off to prove the explicit deletes do the work.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import { setupTestDb, type TestDb } from "@/lib/test-db";

const ADMIN = "admin-user";
const DOOMED = "doomed-user";
const KEPT = "kept-user";

vi.mock("@/lib/auth", () => ({
  withAdmin: async (handler: (session: { userId: string }) => Promise<Response>) => handler({ userId: ADMIN }),
  hashPassword: async (p: string) => p,
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/recurring-logo", () => ({
  discardLogosAfter: async (_scope: unknown, run: () => Promise<unknown>) => run(),
}));

let testDb: TestDb;
const NOW = new Date().toISOString();

beforeAll(async () => {
  testDb = await setupTestDb("admin-users-route");
});
afterAll(() => testDb.cleanup());

beforeEach(async () => {
  await testDb.reset();
  for (const id of [ADMIN, DOOMED, KEPT]) {
    await testDb.client.execute({
      sql: `INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)`,
      args: [id, id, `${id}@test.dev`],
    });
  }
  for (const id of [DOOMED, KEPT]) {
    await testDb.client.execute({
      sql: `INSERT INTO categories (id, user_id, name, created_at) VALUES (?, ?, 'Hotel', ?)`,
      args: [`cat-${id}`, id, NOW],
    });
    await testDb.client.execute({
      sql: `INSERT INTO transaction_groups (id, user_id, name, target_amount, created_at) VALUES (?, ?, 'Trip', 100, ?)`,
      args: [`pot-${id}`, id, NOW],
    });
    await testDb.client.execute({
      sql: `INSERT INTO pot_budget_lines (id, user_id, pot_id, name, amount, sort_order, created_at)
            VALUES (?, ?, ?, 'Hotel', 100, 0, ?)`,
      args: [`line-${id}`, id, `pot-${id}`, NOW],
    });
    await testDb.client.execute({
      sql: `INSERT INTO pot_budget_line_categories (id, user_id, pot_id, line_id, category_id) VALUES (?, ?, ?, ?, ?)`,
      args: [`lc-${id}`, id, `pot-${id}`, `line-${id}`, `cat-${id}`],
    });
  }
});

describe("DELETE /api/admin/users", () => {
  it("removes the user's pot budget lines and their categories, and no one else's", async () => {
    const { adminDb } = await import("@/db");
    const { sql } = await import("drizzle-orm");
    const { DELETE } = await import("./route");

    await adminDb.run(sql`PRAGMA foreign_keys = OFF`);
    const res = await DELETE(
      new Request(`http://test/api/admin/users?id=${DOOMED}`, { method: "DELETE" }) as unknown as NextRequest,
    ).finally(() => adminDb.run(sql`PRAGMA foreign_keys = ON`));
    expect(res.status).toBe(200);

    const owners = async (table: string) =>
      (await testDb.client.execute(`SELECT user_id FROM ${table}`)).rows.map((r) => r.user_id);
    expect(await owners("pot_budget_lines")).toEqual([KEPT]);
    expect(await owners("pot_budget_line_categories")).toEqual([KEPT]);
  });
});
