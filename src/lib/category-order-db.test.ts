import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { setupTestDb } from "./test-db";

// Must run before the lazy `@/db` proxy first connects (see test-db.ts).
const testDb = await setupTestDb("category-order");

const { db } = await import("@/db");
const { categories } = await import("@/db/schema");
const { eq, and, asc } = await import("drizzle-orm");

const USER = "user-1";

async function insert(name: string, createdAt: string, sortOrder = 0) {
  await db.insert(categories).values({ id: name, userId: USER, name, sortOrder, createdAt });
}

// Mirrors the ordering in GET /api/categories — the single list every dropdown reads.
function listed() {
  return db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.userId, USER))
    .orderBy(asc(categories.sortOrder), asc(categories.createdAt))
    .then((rows) => rows.map((r) => r.id));
}

// Mirrors PATCH /api/categories.
async function reorder(orderedIds: string[]) {
  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .update(categories)
      .set({ sortOrder: i })
      .where(and(eq(categories.id, orderedIds[i]), eq(categories.userId, USER)));
  }
}

beforeEach(() => testDb.reset());
afterAll(() => testDb.cleanup());

describe("category ordering", () => {
  it("falls back to creation order when every sort_order is still the 0 default", async () => {
    await insert("b", "2026-01-02");
    await insert("a", "2026-01-01");
    expect(await listed()).toEqual(["a", "b"]);
  });

  it("respects an explicit reorder", async () => {
    await insert("a", "2026-01-01");
    await insert("b", "2026-01-02");
    await insert("c", "2026-01-03");
    await reorder(["c", "a", "b"]);
    expect(await listed()).toEqual(["c", "a", "b"]);
  });

  it("leaves other users' order untouched", async () => {
    await insert("a", "2026-01-01");
    await insert("b", "2026-01-02");
    await db.insert(categories).values({ id: "other", userId: "user-2", name: "x", sortOrder: 0, createdAt: "2026-01-01" });
    await reorder(["b", "a", "other"]);
    const [other] = await db.select().from(categories).where(eq(categories.id, "other"));
    expect(other.sortOrder).toBe(0);
    expect(await listed()).toEqual(["b", "a"]);
  });
});
