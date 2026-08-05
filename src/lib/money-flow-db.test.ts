import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { setupTestDb } from "./test-db";

// Must run before the lazy `@/db` proxy first connects (see test-db.ts).
const testDb = await setupTestDb("money-flow");

const { db } = await import("@/db");
const {
  accounts,
  categories,
  transactionGroups,
  transactions,
  reimbursementLinks,
} = await import("@/db/schema");
const { buildMoneyFlow } = await import("./money-flow");

const USER = "user-1";
const NOW = "2026-07-01T00:00:00.000Z";
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

type TxType = "income" | "expense" | "internal_transfer" | "reimbursement";

async function tx(values: {
  id?: string;
  accountId: string;
  amount: number;
  type: TxType;
  categoryId?: string | null;
  groupId?: string | null;
  linkedTransactionId?: string | null;
  date?: string;
}) {
  const id = values.id ?? nextId("tx");
  await db.insert(transactions).values({
    id,
    userId: USER,
    accountId: values.accountId,
    date: values.date ?? "2026-07-15",
    description: "t",
    amount: values.amount,
    type: values.type,
    categoryId: values.categoryId ?? null,
    groupId: values.groupId ?? null,
    linkedTransactionId: values.linkedTransactionId ?? null,
    createdAt: NOW,
  });
  return id;
}

/** Both legs of an internal transfer, mutually linked like the importer writes them. */
async function transferPair(from: string, to: string, amount: number) {
  const outId = nextId("tx");
  const inId = nextId("tx");
  await tx({ id: outId, accountId: from, amount: -amount, type: "internal_transfer", linkedTransactionId: inId });
  await tx({ id: inId, accountId: to, amount, type: "internal_transfer", linkedTransactionId: outId });
}

async function seedBase() {
  await db.insert(accounts).values([
    { id: "checking", userId: USER, name: "Checking", type: "checking", sortOrder: 0, createdAt: NOW, updatedAt: NOW },
    { id: "savings", userId: USER, name: "Savings", type: "savings", sortOrder: 1, createdAt: NOW, updatedAt: NOW },
  ]);
  await db.insert(categories).values([
    { id: "salary", userId: USER, name: "Salary", color: "#0f0", sortOrder: 0, createdAt: NOW },
    { id: "rent", userId: USER, name: "Rent", color: "#f00", sortOrder: 1, createdAt: NOW },
    { id: "travel", userId: USER, name: "Travel", color: "#00f", sortOrder: 2, createdAt: NOW },
  ]);
}

const link = (flow: Awaited<ReturnType<typeof buildMoneyFlow>>, source: string, target: string) =>
  flow.links.find((l) => l.source === source && l.target === target);

beforeEach(async () => {
  await testDb.reset();
  await seedBase();
});
afterAll(() => testDb.cleanup());

describe("buildMoneyFlow", () => {
  it("routes income sources through accounts into spending categories", async () => {
    await tx({ accountId: "checking", amount: 3000, type: "income", categoryId: "salary" });
    await tx({ accountId: "checking", amount: -1200, type: "expense", categoryId: "rent" });

    const flow = await buildMoneyFlow(USER, {});

    expect(link(flow, "in:salary", "acct:checking")?.value).toBe(3000);
    expect(link(flow, "acct:checking", "cat:rent")?.value).toBe(1200);
    // Same category id on both legs must not collapse into one node.
    expect(flow.nodes.map((n) => n.id)).toContain("in:salary");
    expect(flow.nodes.find((n) => n.id === "cat:rent")?.color).toBe("#f00");
    expect(flow.nodes.find((n) => n.id === "acct:checking")?.kind).toBe("account");
  });

  it("closes each account's bar with what stayed or came out of the balance", async () => {
    await tx({ accountId: "checking", amount: 3000, type: "income", categoryId: "salary" });
    await tx({ accountId: "checking", amount: -1200, type: "expense", categoryId: "rent" });
    await tx({ accountId: "savings", amount: -400, type: "expense", categoryId: "travel" });

    const flow = await buildMoneyFlow(USER, {});
    expect(link(flow, "acct:checking", "cat:__left")?.value).toBe(1800);
    expect(link(flow, "in:__balance", "acct:savings")?.value).toBe(400);
  });

  it("leaves out-of-scope accounts unbalanced rather than inventing a leftover", async () => {
    await transferPair("checking", "savings", 800);

    const flow = await buildMoneyFlow(USER, { accountIds: ["savings"] });
    // Checking is only here as the transfer's payer; nothing claims its balance.
    expect(link(flow, "acct:checking", "cat:__left")).toBeUndefined();
    expect(link(flow, "acct:savings", "cat:__left")?.value).toBe(800);
  });

  it("subtracts reimbursements from the spending leg", async () => {
    const expense = await tx({ accountId: "checking", amount: -300, type: "expense", categoryId: "travel" });
    const refund = await tx({ accountId: "checking", amount: 120, type: "reimbursement" });
    await db.insert(reimbursementLinks).values({
      id: nextId("rl"),
      reimbursementId: refund,
      expenseId: expense,
      createdAt: NOW,
    });

    const flow = await buildMoneyFlow(USER, {});
    expect(link(flow, "acct:checking", "cat:travel")?.value).toBe(180);
  });

  it("attributes pot spending to the pot's category", async () => {
    await db.insert(transactionGroups).values({
      id: "pot-1",
      userId: USER,
      name: "Weekend trip",
      categoryId: "travel",
      fundedAmount: 0,
      createdAt: NOW,
    });
    // Uncategorised row inside the pot — the pot's category stands in.
    await tx({ accountId: "checking", amount: -250, type: "expense", groupId: "pot-1" });

    const flow = await buildMoneyFlow(USER, {});
    expect(link(flow, "acct:checking", "cat:travel")?.value).toBe(250);
  });

  it("counts a transfer between two in-scope accounts once", async () => {
    await transferPair("checking", "savings", 800);

    const flow = await buildMoneyFlow(USER, {});
    const between = flow.links.filter(
      (l) => l.source.startsWith("acct:") && l.target.startsWith("acct:"),
    );
    expect(between).toEqual([
      { source: "acct:checking", target: "acct:savings", value: 800 },
    ]);
  });

  it("nets a pair that moved money in both directions", async () => {
    await transferPair("checking", "savings", 800);
    await transferPair("savings", "checking", 300);

    const flow = await buildMoneyFlow(USER, {});
    expect(link(flow, "acct:checking", "acct:savings")?.value).toBe(500);
    expect(link(flow, "acct:savings", "acct:checking")).toBeUndefined();
  });

  it("keeps a transfer visible when only the receiving account is in scope", async () => {
    await transferPair("checking", "savings", 800);

    const flow = await buildMoneyFlow(USER, { accountIds: ["savings"] });
    expect(link(flow, "acct:checking", "acct:savings")?.value).toBe(800);
  });

  it("honours the date range and drops other users' rows", async () => {
    await tx({ accountId: "checking", amount: 3000, type: "income", categoryId: "salary", date: "2026-06-15" });
    await tx({ accountId: "checking", amount: 100, type: "income", categoryId: "salary", date: "2026-07-15" });
    await db.insert(transactions).values({
      id: nextId("tx"),
      userId: "someone-else",
      accountId: "checking",
      date: "2026-07-15",
      description: "t",
      amount: 9999,
      type: "income",
      createdAt: NOW,
    });

    const flow = await buildMoneyFlow(USER, { dateFrom: "2026-07-01", dateTo: "2026-07-31" });
    expect(link(flow, "in:salary", "acct:checking")?.value).toBe(100);
  });

  it("keeps a transfer whose legs straddle the range edge", async () => {
    // Next-day credit: the payer sits in June, the receipt in July.
    const outId = nextId("tx");
    const inId = nextId("tx");
    await tx({ id: outId, accountId: "checking", amount: -400, type: "internal_transfer", linkedTransactionId: inId, date: "2026-06-30" });
    await tx({ id: inId, accountId: "savings", amount: 400, type: "internal_transfer", linkedTransactionId: outId, date: "2026-07-01" });

    const july = { dateFrom: "2026-07-01", dateTo: "2026-07-31" };
    for (const scope of [{}, { accountIds: ["checking", "savings"] }]) {
      const flow = await buildMoneyFlow(USER, { ...july, ...scope });
      expect(link(flow, "acct:checking", "acct:savings")?.value).toBe(400);
    }
  });

  it("shows an incoming transfer the importer never paired up", async () => {
    await tx({ accountId: "checking", amount: 500, type: "internal_transfer" });
    await tx({ accountId: "checking", amount: -500, type: "expense", categoryId: "rent" });

    const flow = await buildMoneyFlow(USER, {});
    expect(link(flow, "acct:external", "acct:checking")?.value).toBe(500);
    // The rent was funded by that transfer, not out of the opening balance.
    expect(link(flow, "in:__balance", "acct:checking")).toBeUndefined();
  });

  it("never claims a leftover for the Other account bucket", async () => {
    await tx({ accountId: "checking", amount: 1000, type: "income", categoryId: "salary" });
    await tx({ accountId: "checking", amount: -300, type: "internal_transfer" });

    const flow = await buildMoneyFlow(USER, {});
    expect(link(flow, "acct:checking", "acct:external")?.value).toBe(300);
    expect(link(flow, "acct:external", "cat:__left")).toBeUndefined();
  });

  it("nets a cycle of three accounts down to what really moved", async () => {
    await db.insert(accounts).values({ id: "third", userId: USER, name: "Third", type: "savings", sortOrder: 2, createdAt: NOW, updatedAt: NOW });
    await transferPair("checking", "savings", 300);
    await transferPair("savings", "third", 200);
    await transferPair("third", "checking", 100);

    const flow = await buildMoneyFlow(USER, {});
    expect(link(flow, "acct:checking", "acct:savings")?.value).toBe(200);
    expect(link(flow, "acct:savings", "acct:third")?.value).toBe(100);
    expect(link(flow, "acct:third", "acct:checking")).toBeUndefined();
  });

  it("routes income booked to a spending category instead of netting it away", async () => {
    await tx({ accountId: "checking", amount: -1000, type: "expense", categoryId: "rent" });
    await tx({ accountId: "checking", amount: 400, type: "income", categoryId: "rent" });

    const flow = await buildMoneyFlow(USER, {});
    expect(link(flow, "in:rent", "acct:checking")?.value).toBe(400);
    expect(link(flow, "acct:checking", "cat:rent")?.value).toBe(1000);
  });

  // The regression the diagram shipped with: a gift booked to a category that
  // already had spend vanished from both columns, so the left side came up
  // short against the Income card by exactly that amount.
  it("shows every euro the Income card counts on the left", async () => {
    await tx({ accountId: "checking", amount: 3000, type: "income", categoryId: "salary" });
    await tx({ accountId: "checking", amount: 2000, type: "income", categoryId: "rent" });
    await tx({ accountId: "checking", amount: -1800, type: "expense", categoryId: "rent" });

    const flow = await buildMoneyFlow(USER, {});
    const incoming = flow.links
      .filter((l) => l.source.startsWith("in:") && l.source !== "in:__balance")
      .reduce((sum, l) => sum + l.value, 0);
    expect(incoming).toBe(5000);
  });

  it("nets a pot over the range instead of counting its gross spend", async () => {
    await db.insert(transactionGroups).values({
      id: "pot-2",
      userId: USER,
      name: "Trip",
      categoryId: "travel",
      fundedAmount: 0,
      createdAt: NOW,
    });
    await tx({ accountId: "checking", amount: 500, type: "income", groupId: "pot-2" });
    await tx({ accountId: "checking", amount: -800, type: "expense", groupId: "pot-2" });

    const flow = await buildMoneyFlow(USER, {});
    expect(link(flow, "acct:checking", "cat:travel")?.value).toBe(300);
    expect(link(flow, "in:__balance", "acct:checking")?.value).toBe(300);
  });

  it("shows reimbursement money that paid back an out-of-range expense", async () => {
    await tx({ accountId: "checking", amount: 1000, type: "income", categoryId: "salary" });
    await tx({ accountId: "checking", amount: 250, type: "reimbursement" });

    const flow = await buildMoneyFlow(USER, {});
    expect(link(flow, "in:__reimb", "acct:checking")?.value).toBe(250);
    expect(link(flow, "acct:checking", "cat:__left")?.value).toBe(1250);
  });

  it("distinguishes uncategorised income from the merged tail", async () => {
    await tx({ accountId: "checking", amount: 5000, type: "income" });
    for (let i = 0; i < 9; i++) {
      await db.insert(categories).values({ id: `c${i}`, userId: USER, name: `Cat${i}`, color: "#123", sortOrder: 10 + i, createdAt: NOW });
      await tx({ accountId: "checking", amount: 100 - i, type: "income", categoryId: `c${i}` });
    }

    const flow = await buildMoneyFlow(USER, {});
    const names = flow.nodes.filter((n) => n.kind === "income").map((n) => n.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
