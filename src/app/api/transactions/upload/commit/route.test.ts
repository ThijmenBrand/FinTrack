import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { setupTestDb, type TestDb } from "@/lib/test-db";

const OWNER = "commit-owner";

// Same shape as the split route test: the route only needs the caller's id,
// everything else is real DB work. requireAccountAccess THROWS a Response for
// 403/404, which the real withUser catches — so this mock must too.
vi.mock("@/lib/auth", () => ({
  withUser: async (handler: (userId: string) => Promise<Response>) => {
    try {
      return await handler(OWNER);
    } catch (e) {
      if (e instanceof Response) return e;
      throw e;
    }
  },
}));

let testDb: TestDb;

beforeAll(async () => {
  testDb = await setupTestDb("upload-commit-route");
  // import_batches isn't part of the shared test schema; the commit route
  // records one per import, so give it somewhere to land.
  await testDb.client.execute(
    `CREATE TABLE IF NOT EXISTS import_batches (
       id TEXT PRIMARY KEY,
       user_id TEXT NOT NULL,
       account_id TEXT NOT NULL,
       file_name TEXT NOT NULL,
       transaction_count INTEGER NOT NULL,
       imported_at TEXT NOT NULL
     )`,
  );
});
afterAll(async () => {
  await testDb.cleanup();
});
beforeEach(async () => {
  await testDb.reset();
  const now = new Date().toISOString();
  await testDb.client.execute({
    sql: `INSERT INTO "user" (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    args: [OWNER, OWNER, `${OWNER}@test.dev`, Date.now(), Date.now()],
  });
  await testDb.client.execute({
    sql: `INSERT INTO accounts (id, user_id, name, type, currency, initial_balance, sort_order, created_at, updated_at)
          VALUES ('acc-1', ?, 'Checking', 'checking', 'EUR', 0, 0, ?, ?)`,
    args: [OWNER, now, now],
  });
  await testDb.client.execute({
    sql: `INSERT INTO categories (id, user_id, name, created_at)
          VALUES ('cat-a', ?, 'Aflossing', ?), ('cat-b', ?, 'Rente', ?)`,
    args: [OWNER, now, OWNER, now],
  });
  await testDb.client.execute({
    sql: `INSERT INTO categories (id, user_id, name, created_at) VALUES ('cat-other', 'someone-else', 'Theirs', ?)`,
    args: [now],
  });
});

const row = (overrides: Record<string, unknown> = {}) => ({
  tempId: "t1",
  date: "2026-08-09",
  name: "ABN AMRO",
  description: "Hypotheek",
  amount: -1000,
  balance: 500,
  type: "expense",
  categoryId: null,
  ...overrides,
});

const commit = async (transactions: unknown[], accountId = "acc-1") => {
  const { POST } = await import("./route");
  const request = new Request("http://x/api/transactions/upload/commit", {
    method: "POST",
    body: JSON.stringify({
      accountId,
      fileName: "import.csv",
      transactions,
      newRules: [],
    }),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return POST(request as any);
};

/** Tenant-scoped read of everything that landed in the account. */
const storedRows = async () =>
  (
    await testDb.client.execute({
      sql: `SELECT * FROM transactions WHERE user_id = ? ORDER BY rowid`,
      args: [OWNER],
    })
  ).rows;

describe("POST /api/transactions/upload/commit — split rows", () => {
  it("inserts the row as a split parent with its parts as children", async () => {
    const res = await commit([
      row({
        splits: [
          { amount: -300, categoryId: "cat-a" },
          { amount: -700, categoryId: "cat-b" },
        ],
        splitRuleId: "rule-1",
      }),
    ]);
    expect(res.status).toBe(200);

    const rows = await storedRows();
    expect(rows).toHaveLength(3);
    const [parent, ...children] = rows;

    expect(parent.is_split_parent).toBe(1);
    expect(parent.category_id).toBeNull();
    expect(parent.category_source).toBeNull();
    expect(parent.amount).toBe(-1000);
    expect(parent.balance).toBe(500);
    expect(parent.parent_transaction_id).toBeNull();

    expect(children.map((c) => c.amount)).toEqual([-300, -700]);
    expect(children.map((c) => c.category_id)).toEqual(["cat-a", "cat-b"]);
    for (const child of children) {
      expect(child.parent_transaction_id).toBe(parent.id);
      // Children inherit the bank row's identity but never its balance.
      expect(child.balance).toBeNull();
      expect(child.date).toBe(parent.date);
      expect(child.name).toBe(parent.name);
      expect(child.description).toBe(parent.description);
      expect(child.account_id).toBe("acc-1");
      expect(child.import_batch_id).toBe(parent.import_batch_id);
      expect(child.type).toBe("expense");
      expect(child.is_split_parent).toBe(0);
      // Untouched rule proposal → the children count as rule-categorized.
      expect(child.category_source).toBe("rule");
    }
  });

  it("marks children manual when the client dropped the rule id", async () => {
    await commit([
      row({
        splits: [
          { amount: -300, categoryId: "cat-a" },
          { amount: -700, categoryId: null },
        ],
      }),
    ]);
    const rows = await storedRows();
    expect(rows.map((r) => r.category_source)).toEqual([null, "manual", null]);
  });

  it.each([
    ["fewer than two parts", [{ amount: -1000, categoryId: "cat-a" }]],
    [
      "parts that do not sum to the row amount",
      [
        { amount: -300, categoryId: "cat-a" },
        { amount: -600, categoryId: "cat-b" },
      ],
    ],
    [
      "a part with the wrong sign",
      [
        { amount: -1300, categoryId: "cat-a" },
        { amount: 300, categoryId: "cat-b" },
      ],
    ],
    [
      "a zero part",
      [
        { amount: -1000, categoryId: "cat-a" },
        { amount: 0, categoryId: "cat-b" },
      ],
    ],
    [
      "a category owned by someone else",
      [
        { amount: -300, categoryId: "cat-other" },
        { amount: -700, categoryId: "cat-b" },
      ],
    ],
    [
      "twenty-one parts",
      Array.from({ length: 21 }, (_, i) => ({
        amount: i === 20 ? -1000 + 20 : -1,
        categoryId: "cat-a",
      })),
    ],
  ])("rejects %s and writes nothing", async (_label, splits) => {
    const res = await commit([row({ splits })]);
    expect(res.status).toBe(400);
    expect(await storedRows()).toHaveLength(0);
  });

  it.each([
    ["an internal transfer", { type: "internal_transfer", targetAccountId: undefined }],
    ["a reimbursement", { type: "reimbursement", amount: 1000, balance: null }],
    ["a row parked in a pot", { groupId: "pot-1" }],
  ])("refuses to split %s", async (_label, overrides) => {
    const res = await commit([
      row({
        ...overrides,
        splits: [
          { amount: -300, categoryId: "cat-a" },
          { amount: -700, categoryId: "cat-b" },
        ],
      }),
    ]);
    expect(res.status).toBe(400);
    expect(await storedRows()).toHaveLength(0);
  });

  it("leaves plain rows untouched and still imports them alongside split rows", async () => {
    const res = await commit([
      row({ tempId: "t1", categoryId: "cat-a", balance: 500 }),
      row({
        tempId: "t2",
        description: "Hypotheek 2",
        balance: 400,
        splits: [
          { amount: -400, categoryId: "cat-a" },
          { amount: -600, categoryId: "cat-b" },
        ],
      }),
    ]);
    expect(res.status).toBe(200);
    // 2 bank rows imported, the second expanded into 2 children.
    expect(await res.json()).toMatchObject({ imported: 2 });

    const rows = await storedRows();
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r.is_split_parent === 1)).toHaveLength(1);
    expect(rows.filter((r) => r.parent_transaction_id !== null)).toHaveLength(2);
    // Parents are inserted before the children that reference them.
    const parentIndex = rows.findIndex((r) => r.is_split_parent === 1);
    const firstChildIndex = rows.findIndex((r) => r.parent_transaction_id !== null);
    expect(parentIndex).toBeLessThan(firstChildIndex);
  });
});

describe("POST /api/transactions/upload/commit — transfer mirrors", () => {
  const IBAN_1 = "NL11ONE00000000001";
  const IBAN_2 = "NL22TWO00000000002";

  beforeEach(async () => {
    const now = new Date().toISOString();
    await testDb.client.execute({
      sql: `UPDATE accounts SET iban = ? WHERE id = 'acc-1' AND user_id = ?`,
      args: [IBAN_1, OWNER],
    });
    await testDb.client.execute({
      sql: `INSERT INTO accounts (id, user_id, name, type, iban, currency, initial_balance, sort_order, created_at, updated_at)
            VALUES ('acc-2', ?, 'Savings', 'savings', ?, 'EUR', 0, 1, ?, ?)`,
      args: [OWNER, IBAN_2, now, now],
    });
    await testDb.client.execute({
      sql: `INSERT INTO categories (id, user_id, name, kind, created_at) VALUES ('cat-transfer', ?, 'Internal Transfer', 'transfer', ?)`,
      args: [OWNER, now],
    });
  });

  const rowsOn = async (accountId: string) =>
    (
      await testDb.client.execute({
        sql: `SELECT * FROM transactions WHERE user_id = ? AND account_id = ? ORDER BY rowid`,
        args: [OWNER, accountId],
      })
    ).rows;

  // The bug this guards: the mirror carries no running balance, so
  // splitDuplicates (which trusts balances) cannot see it, and importing the
  // far account's own export inserted the same payment a second time. Both
  // account balances then drifted by the transfer amount, permanently.
  it("absorbs its own mirror when the far account's export arrives", async () => {
    await commit([
      row({
        tempId: "t1",
        description: "Naar spaarrekening",
        amount: -1000,
        balance: 500,
        type: "internal_transfer",
        targetAccountId: "acc-2",
        counterpartyIban: IBAN_2,
      }),
    ]);
    expect(await rowsOn("acc-2")).toHaveLength(1);

    await commit(
      [
        row({
          tempId: "t2",
          description: "Van betaalrekening",
          amount: 1000,
          balance: 3000,
          type: "internal_transfer",
          targetAccountId: "acc-1",
          counterpartyIban: IBAN_1,
        }),
      ],
      "acc-2",
    );

    const far = await rowsOn("acc-2");
    expect(far).toHaveLength(1);
    // Filled in with the bank's own row, so the balance chain reconciles again.
    expect(far[0].balance).toBe(3000);
    expect(far[0].description).toBe("Van betaalrekening");
    expect(far[0].is_manual).toBe(0);
    expect(far[0].counterparty_iban).toBe(IBAN_1);
    // And no mirror bounced back into the importing account either.
    expect(await rowsOn("acc-1")).toHaveLength(1);
  });

  // Revolut exports no counterparty IBAN, so its own row for the transfer
  // arrives as plain income. That is the case that used to double-count: the
  // mirror had no balance for splitDuplicates to match on, and nothing typed
  // the incoming row as a transfer either.
  it("absorbs its mirror even when the far export has no IBAN column", async () => {
    await commit([
      row({
        tempId: "t1",
        description: "Naar spaarrekening",
        amount: -1000,
        balance: 500,
        type: "internal_transfer",
        targetAccountId: "acc-2",
        counterpartyIban: IBAN_2,
      }),
    ]);

    await commit(
      [row({ tempId: "t2", description: "Top-Up", amount: 1000, balance: 3000, type: "income" })],
      "acc-2",
    );

    const far = await rowsOn("acc-2");
    expect(far).toHaveLength(1);
    expect(far[0].balance).toBe(3000);
    // The mirror is still the correct row — it stays a transfer leg, linked.
    expect(far[0].type).toBe("internal_transfer");
    expect(far[0].linked_transaction_id).toBe((await rowsOn("acc-1"))[0].id);
  });

  // Same money, other order: the far account is imported first, so there is no
  // mirror to absorb — the transfer must pair with the row already there.
  it("pairs with an existing far row instead of mirroring beside it", async () => {
    await commit(
      [row({ tempId: "t0", description: "Bijschrijving", amount: 1000, balance: 3000, type: "income" })],
      "acc-2",
    );

    await commit([
      row({
        tempId: "t1",
        description: "Naar spaarrekening",
        amount: -1000,
        balance: 500,
        type: "internal_transfer",
        targetAccountId: "acc-2",
        counterpartyIban: IBAN_2,
      }),
    ]);

    const far = await rowsOn("acc-2");
    expect(far).toHaveLength(1);
    expect(far[0].type).toBe("internal_transfer");
    expect(far[0].balance).toBe(3000);
    const near = await rowsOn("acc-1");
    expect(near).toHaveLength(1);
    expect(near[0].linked_transaction_id).toBe(far[0].id);
    expect(far[0].linked_transaction_id).toBe(near[0].id);
  });

  // The preview decides the type, but it may be minutes old — the account's
  // policy can have been switched off in another tab since, and this route is
  // where the rows actually land.
  it("imports a transfer to a shared-money account as a plain expense", async () => {
    await testDb.client.execute({
      sql: `UPDATE accounts SET internal_transfers = 0 WHERE id = 'acc-2' AND user_id = ?`,
      args: [OWNER],
    });

    const res = await commit([
      row({
        tempId: "t1",
        description: "Bijdrage huishouden",
        amount: -1000,
        balance: 500,
        type: "internal_transfer",
        targetAccountId: "acc-2",
        counterpartyIban: IBAN_2,
      }),
    ]);
    expect(res.status).toBe(200);

    // No mirror on the far side, and the row itself is an ordinary expense the
    // budget can see.
    expect(await rowsOn("acc-2")).toHaveLength(0);
    const near = await rowsOn("acc-1");
    expect(near).toHaveLength(1);
    expect(near[0].type).toBe("expense");
    expect(near[0].linked_transaction_id).toBeNull();
  });
});

describe("POST /api/transactions/upload/commit — attachments", () => {
  const putAttachment = async (
    id: string,
    { userId = OWNER, transactionId = null as string | null } = {},
  ) =>
    testDb.client.execute({
      sql: `INSERT INTO transaction_attachments
              (id, user_id, transaction_id, pathname, file_name, content_type, size, uploaded_by, created_at)
            VALUES (?, ?, ?, ?, 'receipt.webp', 'image/webp', 10, ?, ?)`,
      args: [
        id,
        userId,
        transactionId,
        `attachments/${id}.webp`,
        userId,
        new Date().toISOString(),
      ],
    });

  const claimedTo = async (id: string) =>
    (
      await testDb.client.execute({
        sql: `SELECT transaction_id FROM transaction_attachments WHERE id = ? AND user_id IS NOT NULL`,
        args: [id],
      })
    ).rows[0]?.transaction_id ?? null;

  it("binds a receipt uploaded during review to the row it was dropped on", async () => {
    await putAttachment("att-1");

    const res = await commit([row({ attachments: [{ id: "att-1" }] })]);
    expect(res.status).toBe(200);

    const rows = await storedRows();
    expect(rows).toHaveLength(1);
    expect(await claimedTo("att-1")).toBe(rows[0].id);
  });

  it("ignores ids that are not the account owner's, or already claimed", async () => {
    await putAttachment("att-theirs", { userId: "someone-else" });
    await putAttachment("att-taken", { transactionId: "tx-elsewhere" });

    const res = await commit([
      row({ attachments: [{ id: "att-theirs" }, { id: "att-taken" }] }),
    ]);
    expect(res.status).toBe(200);

    // Neither moved: one belongs to another user's space, the other already
    // hangs off a transaction.
    expect(await claimedTo("att-theirs")).toBeNull();
    expect(await claimedTo("att-taken")).toBe("tx-elsewhere");
  });
});

describe("POST /api/transactions/upload/commit — sub-categories", () => {
  /** An allocation for `categoryId` with one sub-line hanging off it. */
  const putSubLine = async (
    id: string,
    categoryId: string,
    userId = OWNER,
  ) => {
    const now = new Date().toISOString();
    await testDb.client.execute({
      sql: `INSERT INTO budgets (id, user_id, budget_id, category_id, amount, period, is_active, status, source, created_at)
            VALUES (?, ?, NULL, ?, 100, 'monthly', 1, 'active', 'manual', ?)`,
      args: [`alloc-${id}`, userId, categoryId, now],
    });
    await testDb.client.execute({
      sql: `INSERT INTO budget_sub_lines (id, user_id, allocation_id, parent_id, name, amount, created_at)
            VALUES (?, ?, ?, NULL, ?, 40, ?)`,
      args: [id, userId, `alloc-${id}`, id, now],
    });
  };

  it("stores a sub-line that plans for the row's own category", async () => {
    await putSubLine("sub-a", "cat-a");

    const res = await commit([row({ categoryId: "cat-a", subLineId: "sub-a" })]);
    expect(res.status).toBe(200);

    const rows = await storedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].category_id).toBe("cat-a");
    expect(rows[0].sub_line_id).toBe("sub-a");
  });

  it("rejects a sub-line belonging to another category, importing nothing", async () => {
    await putSubLine("sub-b", "cat-b");

    const res = await commit([row({ categoryId: "cat-a", subLineId: "sub-b" })]);
    expect(res.status).toBe(400);
    expect(await storedRows()).toHaveLength(0);
  });

  it("rejects a sub-line from someone else's budget", async () => {
    await putSubLine("sub-theirs", "cat-other", "someone-else");

    const res = await commit([row({ categoryId: "cat-a", subLineId: "sub-theirs" })]);
    expect(res.status).toBe(400);
    expect(await storedRows()).toHaveLength(0);
  });

  it("leaves a split parent without one — the parts carry the categories", async () => {
    await putSubLine("sub-c", "cat-a");

    const res = await commit([
      row({
        categoryId: "cat-a",
        subLineId: "sub-c",
        splits: [
          { amount: -400, categoryId: "cat-a" },
          { amount: -600, categoryId: "cat-b" },
        ],
      }),
    ]);
    expect(res.status).toBe(200);

    const rows = await storedRows();
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.sub_line_id === null)).toBe(true);
  });
});
