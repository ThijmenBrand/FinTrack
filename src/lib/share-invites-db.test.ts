import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { setupTestDb } from "./test-db";

// Must run before the lazy `@/db` proxy first connects (see test-db.ts).
const testDb = await setupTestDb("share-invites");

const {
  acceptShareInvite,
  countLiveMembers,
  findPendingShareInvite,
  isUniqueViolation,
  MAX_MEMBERS_PER_ACCOUNT,
  ownedAccountIds,
} = await import("@/lib/share-invites");
const { hashInviteToken, inviteExpiry } = await import("@/lib/invites");
const { db } = await import("@/db");
const { accounts, accountMembers } = await import("@/db/schema");

const OWNER = "owner-1";
const MEMBER = "member-1";
const NOW = new Date().toISOString();
const YESTERDAY = new Date(Date.now() - 86_400_000).toISOString();

async function invite(
  token: string,
  extra: Partial<typeof accountMembers.$inferInsert> = {},
) {
  const id = extra.id ?? crypto.randomUUID();
  await db.insert(accountMembers).values({
    id,
    accountId: "acc-1",
    userId: null,
    email: "invitee@example.com",
    role: "viewer",
    tokenHash: hashInviteToken(token),
    expiresAt: inviteExpiry(),
    ...extra,
  });
  return id;
}

beforeEach(async () => {
  await testDb.reset();
  await testDb.client.execute(
    `INSERT INTO "user" (id, name, email) VALUES ('${OWNER}', 'Alice', 'a@example.com'), ('${MEMBER}', 'Bob', 'b@example.com')`,
  );
  await db.insert(accounts).values([
    { id: "acc-1", userId: OWNER, name: "Joint", type: "joint" },
    { id: "acc-2", userId: MEMBER, name: "Mine", type: "checking" },
  ]);
});
afterAll(() => testDb.cleanup());

describe("share invites", () => {
  it("finds a pending invite with its account and owner", async () => {
    await invite("tok");
    const found = await findPendingShareInvite("tok");
    expect(found?.accountName).toBe("Joint");
    expect(found?.ownerId).toBe(OWNER);
    expect(found?.ownerName).toBe("Alice");
    expect(found?.member.email).toBe("invitee@example.com");
  });

  it("hides expired, revoked, accepted and unknown tokens alike", async () => {
    await invite("expired", { expiresAt: YESTERDAY });
    await invite("revoked", { email: "b@example.com", revokedAt: NOW });
    await invite("accepted", { email: "c@example.com", acceptedAt: NOW, userId: MEMBER });
    for (const token of ["expired", "revoked", "accepted", "nope", ""]) {
      expect(await findPendingShareInvite(token)).toBeNull();
    }
  });

  it("accept binds the user, stamps acceptedAt and burns the token", async () => {
    const id = await invite("tok");
    await acceptShareInvite(id, MEMBER);

    const [row] = await db
      .select()
      .from(accountMembers)
      .where(eq(accountMembers.id, id));
    expect(row.userId).toBe(MEMBER);
    expect(row.acceptedAt).not.toBeNull();
    expect(row.tokenHash).toBeNull();
    expect(row.expiresAt).toBeNull();
    // Single use: the link is dead the moment it is spent.
    expect(await findPendingShareInvite("tok")).toBeNull();
  });

  it("counts only non-revoked rows of the owner's own account", async () => {
    await invite("a", { email: "one@example.com" });
    await invite("b", { email: "two@example.com", revokedAt: NOW });
    await invite("c", { email: "three@example.com", acceptedAt: NOW, userId: MEMBER });
    expect(await countLiveMembers("acc-1", OWNER)).toBe(2);
    // Not the caller's account — the owner scope keeps it at zero.
    expect(await countLiveMembers("acc-1", MEMBER)).toBe(0);
  });

  it("the cap is reachable and counts pending invites", async () => {
    for (let i = 0; i < MAX_MEMBERS_PER_ACCOUNT; i++) {
      await invite(`tok-${i}`, { email: `p${i}@example.com` });
    }
    expect(await countLiveMembers("acc-1", OWNER)).toBe(MAX_MEMBERS_PER_ACCOUNT);
  });

  it("ownedAccountIds keeps member writes on the owner's own accounts", async () => {
    // Exactly the filter the PATCH/DELETE member routes use — it also carries
    // the user_id that gets those updates past the tenant guard.
    const id = await invite("tok");
    const wrongOwner = await db
      .update(accountMembers)
      .set({ role: "editor" })
      .where(
        and(
          eq(accountMembers.id, id),
          inArray(accountMembers.accountId, ownedAccountIds(MEMBER)),
        ),
      )
      .returning({ email: accountMembers.email });
    expect(wrongOwner).toHaveLength(0);

    const rightOwner = await db
      .update(accountMembers)
      .set({ role: "editor" })
      .where(
        and(
          eq(accountMembers.id, id),
          inArray(accountMembers.accountId, ownedAccountIds(OWNER)),
        ),
      )
      .returning({ email: accountMembers.email });
    expect(rightOwner).toHaveLength(1);
  });

  it("a second live invite for the same address is refused by the index", async () => {
    await invite("first");
    // The route turns exactly this into a 409, so the detector is tested too.
    await expect(invite("second")).rejects.toSatisfy(isUniqueViolation);
    // …but re-inviting a revoked address is allowed.
    await testDb.client.execute(
      `UPDATE account_members SET revoked_at = '${NOW}' WHERE user_id IS NULL`,
    );
    await expect(invite("third")).resolves.toBeTruthy();
  });
});
