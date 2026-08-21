import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { setupTestDb } from "./test-db";

// Must run before the lazy `@/db` proxy first connects (see test-db.ts).
const testDb = await setupTestDb("split-rules");

const { db } = await import("@/db");
const { transactions, splitRules, splitRuleLines, categories, reimbursementLinks, transactionGroups } =
  await import("@/db/schema");
const { eq, and } = await import("drizzle-orm");
const { computeSplitAmounts, applySplitRulesToExisting, matchSplitRule, proposeSplitForRow } = await import(
  "@/lib/split-rules"
);

const USER = "user-1";
const CAT_A = "cat-a";
const CAT_B = "cat-b";
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

async function seedCategories() {
  for (const [id, name] of [
    [CAT_A, "Aflossing"],
    [CAT_B, "Rente"],
  ]) {
    await db.insert(categories).values({ id, userId: USER, name, createdAt: new Date().toISOString() });
  }
}

async function insertTx(overrides: Record<string, unknown> = {}) {
  const id = nextId("tx");
  await db.insert(transactions).values({
    id,
    userId: USER,
    accountId: "acct-1",
    date: "2026-07-15",
    description: "Hypotheek ABN",
    amount: -1000,
    type: "expense",
    ...overrides,
  });
  return id;
}

interface RuleLine {
  categoryId: string;
  percentage?: number;
  amount?: number;
  isRemainder?: boolean;
}

async function insertRule(
  mode: "percentage" | "fixed",
  lines: RuleLine[],
  overrides: Record<string, unknown> = {},
) {
  const id = nextId("rule");
  await db.insert(splitRules).values({
    id,
    userId: USER,
    pattern: "hypotheek",
    matchType: "contains",
    matchField: "both",
    mode,
    isActive: true,
    // createdAt drives rule order; keep it strictly increasing per rule.
    createdAt: new Date(Date.UTC(2026, 0, seq)).toISOString(),
    ...overrides,
  });
  for (const [i, line] of lines.entries()) {
    await db.insert(splitRuleLines).values({
      id: nextId("line"),
      ruleId: id,
      categoryId: line.categoryId,
      percentage: line.percentage ?? null,
      amount: line.amount ?? null,
      isRemainder: line.isRemainder ?? false,
      sortOrder: i,
    });
  }
  return id;
}

function children(parentId: string) {
  return db
    .select()
    .from(transactions)
    .where(and(eq(transactions.parentTransactionId, parentId), eq(transactions.userId, USER)));
}

beforeEach(async () => {
  await testDb.reset();
  seq = 0;
  await seedCategories();
});
afterAll(() => testDb.cleanup());

describe("computeSplitAmounts", () => {
  it("rounds percentage leftovers onto the last line", () => {
    const lines = [
      { categoryId: CAT_A, percentage: 33.33 },
      { categoryId: CAT_A, percentage: 33.33 },
      { categoryId: CAT_B, percentage: 33.34 },
    ];
    const out = computeSplitAmounts(lines, "percentage", -10.01)!;
    expect(out.map((o) => o.amount)).toEqual([-3.34, -3.34, -3.33]);
    expect(out.reduce((s, o) => s + o.amount, 0)).toBeCloseTo(-10.01, 10);
  });

  it("keeps a 30/70 split exact on an odd cent total", () => {
    const out = computeSplitAmounts(
      [
        { categoryId: CAT_A, percentage: 30 },
        { categoryId: CAT_B, percentage: 70 },
      ],
      "percentage",
      -100.55,
    )!;
    expect(out.map((o) => o.amount)).toEqual([-30.17, -70.38]);
  });

  it("carries the parent's sign for income", () => {
    const out = computeSplitAmounts(
      [
        { categoryId: CAT_A, percentage: 50 },
        { categoryId: CAT_B, percentage: 50 },
      ],
      "percentage",
      250,
    )!;
    expect(out.map((o) => o.amount)).toEqual([125, 125]);
  });

  it("skips the rule when a percentage line rounds to zero", () => {
    expect(
      computeSplitAmounts(
        [
          { categoryId: CAT_A, percentage: 0.1 },
          { categoryId: CAT_B, percentage: 99.9 },
        ],
        "percentage",
        -1,
      ),
    ).toBeNull();
  });

  it("lets the fixed remainder absorb a changed total", () => {
    const lines = [
      { categoryId: CAT_A, amount: 1000 },
      { categoryId: CAT_B, isRemainder: true },
    ];
    expect(computeSplitAmounts(lines, "fixed", -1020)!.map((o) => o.amount)).toEqual([-1000, -20]);
  });

  it("skips the rule when fixed amounts meet or exceed the total", () => {
    const lines = [
      { categoryId: CAT_A, amount: 1000 },
      { categoryId: CAT_B, isRemainder: true },
    ];
    expect(computeSplitAmounts(lines, "fixed", -1000)).toBeNull();
    expect(computeSplitAmounts(lines, "fixed", -900)).toBeNull();
  });
});

describe("matchSplitRule", () => {
  it("matches on the rule's match field", () => {
    const rules = [
      { pattern: "albert", matchType: "contains", matchField: "name" },
      { pattern: "hypotheek", matchType: "contains", matchField: "both" },
    ];
    expect(matchSplitRule(rules, "ABN AMRO", "Hypotheek juli")?.pattern).toBe("hypotheek");
    expect(matchSplitRule(rules, "Albert Heijn", "boodschappen")?.pattern).toBe("albert");
    expect(matchSplitRule(rules, null, "salaris")).toBeNull();
  });
});

describe("applySplitRulesToExisting", () => {
  it("splits a matching transaction so the children sum to the parent exactly", async () => {
    const parent = await insertTx({ amount: -100.55 });
    await insertRule("percentage", [
      { categoryId: CAT_A, percentage: 30 },
      { categoryId: CAT_B, percentage: 70 },
    ]);

    expect(await applySplitRulesToExisting(USER)).toBe(1);

    const kids = await children(parent);
    expect(kids.map((k) => k.amount).sort((a, b) => a - b)).toEqual([-70.38, -30.17]);
    expect(kids.reduce((s, k) => s + k.amount, 0)).toBeCloseTo(-100.55, 10);
    expect(kids.map((k) => k.categorySource)).toEqual(["rule", "rule"]);

    const [p] = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, parent), eq(transactions.userId, USER)));
    expect(p.isSplitParent).toBe(true);
    expect(p.categoryId).toBeNull();
  });

  it("lets the fixed remainder line absorb a changed total", async () => {
    const parent = await insertTx({ amount: -1020 });
    await insertRule("fixed", [
      { categoryId: CAT_A, amount: 1000 },
      { categoryId: CAT_B, isRemainder: true },
    ]);

    expect(await applySplitRulesToExisting(USER)).toBe(1);
    const kids = await children(parent);
    expect(kids.map((k) => k.amount)).toEqual([-1000, -20]);
  });

  it("skips the rule when the fixed amounts exceed the total", async () => {
    const parent = await insertTx({ amount: -900 });
    await insertRule("fixed", [
      { categoryId: CAT_A, amount: 1000 },
      { categoryId: CAT_B, isRemainder: true },
    ]);

    expect(await applySplitRulesToExisting(USER)).toBe(0);
    expect(await children(parent)).toHaveLength(0);
  });

  it("first matching rule wins", async () => {
    const parent = await insertTx({ amount: -1000 });
    await insertRule("percentage", [
      { categoryId: CAT_A, percentage: 25 },
      { categoryId: CAT_B, percentage: 75 },
    ]);
    await insertRule("percentage", [
      { categoryId: CAT_A, percentage: 50 },
      { categoryId: CAT_B, percentage: 50 },
    ]);

    expect(await applySplitRulesToExisting(USER)).toBe(1);
    expect((await children(parent)).map((k) => k.amount)).toEqual([-250, -750]);
  });

  it("skips manually categorized, already-split, pot-linked and reimbursed transactions", async () => {
    const manual = await insertTx({ categoryId: CAT_A, categorySource: "manual" });
    const alreadySplit = await insertTx({ isSplitParent: true });
    const child = await insertTx({ parentTransactionId: alreadySplit });
    await db.insert(transactionGroups).values({ id: "pot-1", userId: USER, name: "Vakantie" });
    const inPot = await insertTx({ groupId: "pot-1" });
    const reimbursed = await insertTx();
    const income = await insertTx({ amount: 40, type: "income", description: "Hypotheek terug" });
    await db.insert(reimbursementLinks).values({
      id: "link-1",
      expenseId: reimbursed,
      reimbursementId: income,
      createdAt: new Date().toISOString(),
    });
    const transfer = await insertTx({ type: "internal_transfer" });
    const eligible = await insertTx();

    await insertRule("percentage", [
      { categoryId: CAT_A, percentage: 50 },
      { categoryId: CAT_B, percentage: 50 },
    ]);

    expect(await applySplitRulesToExisting(USER)).toBe(1);
    expect((await children(eligible)).map((k) => k.amount)).toEqual([-500, -500]);
    for (const id of [manual, inPot, reimbursed, income, transfer, child]) {
      expect(await children(id)).toHaveLength(0);
    }
    // The pre-existing "split parent" gained no new children beyond its own.
    expect(await children(alreadySplit)).toHaveLength(1);
  });

  it("can be limited to a single rule", async () => {
    const groceries = await insertTx({ description: "Albert Heijn" });
    const mortgage = await insertTx();
    await insertRule("percentage", [
      { categoryId: CAT_A, percentage: 50 },
      { categoryId: CAT_B, percentage: 50 },
    ]);
    const second = await insertRule(
      "percentage",
      [
        { categoryId: CAT_A, percentage: 20 },
        { categoryId: CAT_B, percentage: 80 },
      ],
      { pattern: "albert" },
    );

    expect(await applySplitRulesToExisting(USER, { ruleId: second })).toBe(1);
    expect((await children(groceries)).map((k) => k.amount)).toEqual([-200, -800]);
    expect(await children(mortgage)).toHaveLength(0);
  });

  it("ignores inactive rules and other users' rules", async () => {
    const parent = await insertTx();
    await insertRule(
      "percentage",
      [
        { categoryId: CAT_A, percentage: 50 },
        { categoryId: CAT_B, percentage: 50 },
      ],
      { isActive: false },
    );
    expect(await applySplitRulesToExisting(USER)).toBe(0);
    expect(await children(parent)).toHaveLength(0);
    expect(await applySplitRulesToExisting("someone-else")).toBe(0);
  });

  it("does not let a narrowed rule jump an older rule that also matches", async () => {
    const parent = await insertTx();
    await insertRule("percentage", [
      { categoryId: CAT_A, percentage: 50 },
      { categoryId: CAT_B, percentage: 50 },
    ]);
    // Same pattern, created later — the older rule owns the row.
    const younger = await insertRule("percentage", [
      { categoryId: CAT_A, percentage: 10 },
      { categoryId: CAT_B, percentage: 90 },
    ]);

    expect(await applySplitRulesToExisting(USER, { ruleId: younger })).toBe(0);
    expect(await children(parent)).toHaveLength(0);
  });
});

// "Apply to existing" on an EDIT has to reach rows the rule already split, or
// new percentages never land anywhere.
describe("applySplitRulesToExisting — resplit", () => {
  const percentRule = (a: number, b: number, over: Record<string, unknown> = {}) =>
    insertRule("percentage", [
      { categoryId: CAT_A, percentage: a },
      { categoryId: CAT_B, percentage: b },
    ], over);

  async function editLines(ruleId: string, a: number, b: number) {
    await db.delete(splitRuleLines).where(eq(splitRuleLines.ruleId, ruleId));
    for (const [i, line] of [
      { categoryId: CAT_A, percentage: a },
      { categoryId: CAT_B, percentage: b },
    ].entries()) {
      await db.insert(splitRuleLines).values({
        id: nextId("line"),
        ruleId,
        categoryId: line.categoryId,
        percentage: line.percentage,
        amount: null,
        isRemainder: false,
        sortOrder: i,
      });
    }
  }

  it("redoes a rule-made split against the rule's new lines", async () => {
    const parent = await insertTx();
    const rule = await percentRule(30, 70);
    expect(await applySplitRulesToExisting(USER, { ruleId: rule })).toBe(1);
    expect((await children(parent)).map((k) => k.amount)).toEqual([-300, -700]);

    await editLines(rule, 40, 60);
    expect(await applySplitRulesToExisting(USER, { ruleId: rule, resplit: true })).toBe(1);
    expect((await children(parent)).map((k) => k.amount)).toEqual([-400, -600]);
  });

  it("leaves the old split alone without resplit — the bug this guards", async () => {
    const parent = await insertTx();
    const rule = await percentRule(30, 70);
    await applySplitRulesToExisting(USER, { ruleId: rule });

    await editLines(rule, 40, 60);
    expect(await applySplitRulesToExisting(USER, { ruleId: rule })).toBe(0);
    expect((await children(parent)).map((k) => k.amount)).toEqual([-300, -700]);
  });

  it("never touches a split the user made by hand", async () => {
    const parent = await insertTx();
    const { applySplit } = await import("@/lib/transaction-split");
    await applySplit({
      parentId: parent,
      ownerId: USER,
      actorId: USER,
      source: "manual",
      splits: [{ amount: -250, categoryId: CAT_A }, { amount: -750, categoryId: CAT_B }],
    });
    await percentRule(30, 70);

    expect(await applySplitRulesToExisting(USER, { resplit: true })).toBe(0);
    expect((await children(parent)).map((k) => k.amount)).toEqual([-250, -750]);
  });

  it("refuses to redo a split whose child sits in a pot", async () => {
    const parent = await insertTx();
    const rule = await percentRule(30, 70);
    await applySplitRulesToExisting(USER, { ruleId: rule });
    const [child] = await children(parent);
    await db
      .update(transactions)
      .set({ groupId: "pot-1" })
      .where(and(eq(transactions.id, child.id), eq(transactions.userId, USER)));

    await editLines(rule, 40, 60);
    expect(await applySplitRulesToExisting(USER, { ruleId: rule, resplit: true })).toBe(0);
    expect((await children(parent)).map((k) => k.amount)).toEqual([-300, -700]);
  });
});

describe("proposeSplitForRow", () => {
  const RULES = [
    {
      id: "rule-1",
      pattern: "hypotheek",
      matchType: "contains",
      matchField: "both",
      mode: "percentage" as const,
      lines: [
        { categoryId: CAT_A, percentage: 30 },
        { categoryId: CAT_B, percentage: 70 },
      ],
    },
  ];
  const row = (overrides: Record<string, unknown> = {}) => ({
    type: "expense",
    amount: -1000,
    name: null,
    description: "Hypotheek ABN",
    ...overrides,
  });

  it("proposes the matching rule's parts and reports the rule id", () => {
    const out = proposeSplitForRow(RULES, row())!;
    expect(out.splitRuleId).toBe("rule-1");
    expect(out.splits).toEqual([
      { amount: -300, categoryId: CAT_A },
      { amount: -700, categoryId: CAT_B },
    ]);
  });

  it("returns null when no rule matches", () => {
    expect(proposeSplitForRow(RULES, row({ description: "Albert Heijn" }))).toBeNull();
  });

  it("skips rows that cannot be split", () => {
    expect(proposeSplitForRow(RULES, row({ type: "internal_transfer" }))).toBeNull();
    expect(proposeSplitForRow(RULES, row({ type: "reimbursement" }))).toBeNull();
    expect(proposeSplitForRow(RULES, row({ groupId: "pot-1" }))).toBeNull();
    expect(proposeSplitForRow(RULES, row({ targetAccountId: "acct-2" }))).toBeNull();
  });

  it("skips a fixed rule whose fixed amounts swallow the whole row", () => {
    const fixed = [
      {
        ...RULES[0],
        mode: "fixed" as const,
        lines: [
          { categoryId: CAT_A, amount: 1200 },
          { categoryId: CAT_B, isRemainder: true },
        ],
      },
    ];
    expect(proposeSplitForRow(fixed, row())).toBeNull();
    // A smaller fixed part leaves the rest to the remainder line.
    fixed[0].lines[0].amount = 400;
    expect(proposeSplitForRow(fixed, row())!.splits).toEqual([
      { amount: -400, categoryId: CAT_A },
      { amount: -600, categoryId: CAT_B },
    ]);
  });
});
