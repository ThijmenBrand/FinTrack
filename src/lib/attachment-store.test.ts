import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { setupTestDb, type TestDb } from "@/lib/test-db";

const OWNER = "sweep-owner";
const OTHER = "sweep-other";

// The blob store is the one thing here that isn't the DB; record what the sweep
// asks it to delete so the bytes can be asserted on alongside the rows.
const deleted: string[] = [];
vi.mock("@vercel/blob", () => ({
  del: async (pathname: string) => {
    deleted.push(pathname);
  },
}));

import { collectOrphanAttachments } from "@/lib/attachment-store";

let testDb: TestDb;

const DAY = 24 * 60 * 60 * 1000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

async function putAttachment(
  id: string,
  { userId = OWNER, transactionId = null as string | null, createdAt = iso(0) } = {},
) {
  await testDb.client.execute({
    sql: `INSERT INTO transaction_attachments
            (id, user_id, transaction_id, pathname, file_name, content_type, size, uploaded_by, created_at)
          VALUES (?, ?, ?, ?, 'receipt.webp', 'image/webp', 10, ?, ?)`,
    args: [id, userId, transactionId, `attachments/${id}.webp`, userId, createdAt],
  });
}

const remaining = async () =>
  (await testDb.client.execute(`SELECT id FROM transaction_attachments WHERE user_id IS NOT NULL ORDER BY id`))
    .rows.map((r) => r.id as string);

beforeAll(async () => {
  testDb = await setupTestDb("attachment-store");
});
afterAll(async () => {
  await testDb.cleanup();
});
beforeEach(async () => {
  await testDb.reset();
  deleted.length = 0;
  const now = iso(0);
  await testDb.client.execute({
    sql: `INSERT INTO accounts (id, user_id, name, type, currency, initial_balance, sort_order, created_at, updated_at)
          VALUES ('acc-1', ?, 'Checking', 'checking', 'EUR', 0, 0, ?, ?)`,
    args: [OWNER, now, now],
  });
  await testDb.client.execute({
    sql: `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, created_at)
          VALUES ('tx-live', ?, 'acc-1', '2026-01-01', 'Groceries', -10, 'expense', ?)`,
    args: [OWNER, now],
  });
});

describe("collectOrphanAttachments", () => {
  it("takes rows whose transaction is gone, and their bytes", async () => {
    await putAttachment("att-orphan", { transactionId: "tx-deleted" });
    await putAttachment("att-live", { transactionId: "tx-live" });

    expect(await collectOrphanAttachments(OWNER)).toBe(1);
    expect(await remaining()).toEqual(["att-live"]);
    expect(deleted).toEqual(["attachments/att-orphan.webp"]);
  });

  it("keeps an unclaimed row until it is a day old", async () => {
    await putAttachment("att-fresh", { createdAt: iso(1000) });
    await putAttachment("att-stale", { createdAt: iso(DAY + 1000) });

    expect(await collectOrphanAttachments(OWNER)).toBe(1);
    expect(await remaining()).toEqual(["att-fresh"]);
  });

  it("never reaches into another user's space", async () => {
    await putAttachment("att-theirs", {
      userId: OTHER,
      transactionId: "tx-deleted",
      createdAt: iso(DAY * 30),
    });

    expect(await collectOrphanAttachments(OWNER)).toBe(0);
    expect(await remaining()).toEqual(["att-theirs"]);
    expect(deleted).toEqual([]);
  });
});
