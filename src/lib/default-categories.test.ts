import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { setupTestDb } from "./test-db";

// Must run before the lazy `@/db` proxy first connects (see test-db.ts).
const testDb = await setupTestDb("default-categories");

const { adminDb } = await import("@/db");
const { categories } = await import("@/db/schema");
const { eq, and } = await import("drizzle-orm");
const { seedCategoriesForUser } = await import("@/db/migrate");

function namesFor(userId: string) {
  return adminDb
    .select({ name: categories.name })
    .from(categories)
    .where(eq(categories.userId, userId))
    .then((rows) => rows.map((r) => r.name));
}

/** How every transfer lookup in the app finds the bucket — see findTransferCategory. */
function transferCategory(userId: string) {
  return adminDb
    .select({ name: categories.name })
    .from(categories)
    .where(and(eq(categories.kind, "transfer"), eq(categories.userId, userId)))
    .get();
}

beforeEach(() => testDb.reset());
afterAll(() => testDb.cleanup());

describe("seedCategoriesForUser", () => {
  it("seeds in the user's language", async () => {
    await seedCategoriesForUser("nl-user", "nl");
    await seedCategoriesForUser("en-user");

    expect(await namesFor("nl-user")).toContain("Boodschappen");
    expect(await namesFor("en-user")).toContain("Groceries");
  });

  it("keeps the transfer bucket findable in every language", async () => {
    await seedCategoriesForUser("nl-user", "nl");
    await seedCategoriesForUser("en-user", "en");

    expect((await transferCategory("nl-user"))?.name).toBe("Interne overboeking");
    expect((await transferCategory("en-user"))?.name).toBe("Internal Transfer");
  });

  it("still finds the transfer bucket after the user renames it", async () => {
    await seedCategoriesForUser("en-user", "en");
    await adminDb
      .update(categories)
      .set({ name: "Between my accounts" })
      .where(and(eq(categories.userId, "en-user"), eq(categories.name, "Internal Transfer")));

    // The lookup is on `kind`, so the rename doesn't hide the bucket.
    expect((await transferCategory("en-user"))?.name).toBe("Between my accounts");
  });
});
