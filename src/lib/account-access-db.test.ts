import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { setupTestDb } from "./test-db";

// Must run before the lazy `@/db` proxy first connects (see test-db.ts).
const testDb = await setupTestDb("account-access");

const { getAccessibleAccounts, getAccountAccess, requireAccountAccess } =
  await import("@/lib/account-access");
const { db } = await import("@/db");
const { accounts, accountMembers } = await import("@/db/schema");

const OWNER = "owner-1";
const MEMBER = "member-1";
const NOW = new Date().toISOString();

async function membership(extra: Partial<typeof accountMembers.$inferInsert> = {}) {
  await db.insert(accountMembers).values({
    id: extra.id ?? crypto.randomUUID(),
    accountId: "acc-1",
    userId: MEMBER,
    email: "member@example.com",
    role: "viewer",
    acceptedAt: NOW,
    ...extra,
  });
}

beforeEach(async () => {
  await testDb.reset();
  await testDb.client.execute(
    `INSERT INTO "user" (id, name, email) VALUES ('${OWNER}', 'Alice', 'a@example.com'), ('${MEMBER}', 'Bob', 'b@example.com')`,
  );
  await db.insert(accounts).values([
    { id: "acc-1", userId: OWNER, name: "Joint", type: "joint" },
    { id: "acc-2", userId: OWNER, name: "Private", type: "checking" },
    { id: "acc-3", userId: MEMBER, name: "Mine", type: "checking" },
  ]);
});
afterAll(() => testDb.cleanup());

describe("account access", () => {
  it("owner sees own accounts as owner, none shared", async () => {
    const list = await getAccessibleAccounts(OWNER);
    expect(list.map((a) => [a.id, a.role])).toEqual([
      ["acc-1", "owner"],
      ["acc-2", "owner"],
    ]);
  });

  it("active membership adds the shared account with role and owner name", async () => {
    await membership({ role: "editor" });
    const list = await getAccessibleAccounts(MEMBER);
    expect(list.map((a) => [a.id, a.role, a.ownerName])).toEqual([
      ["acc-3", "owner", null],
      ["acc-1", "editor", "Alice"],
    ]);
  });

  it("sharedWith counts live invites on own accounts only", async () => {
    await membership({ id: "m-1" });
    await membership({ id: "m-2", userId: null, email: "c@example.com", acceptedAt: null });
    await membership({ id: "m-3", userId: null, email: "d@example.com", revokedAt: NOW });

    const owner = await getAccessibleAccounts(OWNER);
    expect(owner.map((a) => [a.id, a.sharedWith])).toEqual([
      ["acc-1", 2], // accepted + pending; the revoked row doesn't count
      ["acc-2", 0],
    ]);
    // A member sees the shared account but not the owner's headcount.
    const member = await getAccessibleAccounts(MEMBER);
    expect(member.map((a) => [a.id, a.sharedWith])).toEqual([
      ["acc-3", 0],
      ["acc-1", 0],
    ]);
  });

  it("pending and revoked memberships grant nothing", async () => {
    await membership({ acceptedAt: null });
    expect(await getAccountAccess(MEMBER, "acc-1")).toBeNull();
    await testDb.client.execute(`DELETE FROM account_members`);
    await membership({ revokedAt: NOW });
    expect(await getAccountAccess(MEMBER, "acc-1")).toBeNull();
  });

  it("requireAccountAccess: 404 for no access, 403 for viewer writes and non-owner manage", async () => {
    await membership({ role: "viewer" });
    await expect(requireAccountAccess(MEMBER, "acc-2", "read")).rejects.toSatisfy(
      (r) => (r as Response).status === 404,
    );
    await expect(requireAccountAccess(MEMBER, "acc-1", "write")).rejects.toSatisfy(
      (r) => (r as Response).status === 403,
    );
    await expect(requireAccountAccess(MEMBER, "acc-1", "manage")).rejects.toSatisfy(
      (r) => (r as Response).status === 403,
    );
    const read = await requireAccountAccess(MEMBER, "acc-1", "read");
    expect(read.role).toBe("viewer");
    const manage = await requireAccountAccess(OWNER, "acc-1", "manage");
    expect(manage.role).toBe("owner");
  });

  it("editors pass write but not manage", async () => {
    await membership({ role: "editor" });
    const write = await requireAccountAccess(MEMBER, "acc-1", "write");
    expect(write.role).toBe("editor");
    await expect(requireAccountAccess(MEMBER, "acc-1", "manage")).rejects.toSatisfy(
      (r) => (r as Response).status === 403,
    );
  });
});
