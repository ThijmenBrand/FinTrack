/**
 * Seed the database with eighteen months of realistic dummy data so the app has
 * something to show on first run: accounts, transactions, rules, a yearly
 * budget plan with its ledger, recurring plans, pots and reimbursements.
 *
 * The default history spans 1.5 financial years, which is what makes the
 * yearly envelope worth looking at: one finished year of carry-over behind the
 * current, half-finished one, and lumpy once-a-year costs (holiday, APK,
 * Sinterklaas, eigen risico) landing in months the monthly view can't explain.
 *
 *   pnpm run db:seed                    # 18 months, yearly main plan
 *   pnpm run db:seed -- --months 6      # shorter history
 *   pnpm run db:seed -- --period monthly # classic month-at-a-time plan
 *   pnpm run db:seed -- --user alice    # a different user
 *   pnpm run db:seed -- --email a@b.com # sign-in address (default user@local.test)
 *   pnpm run db:seed -- --share-email p@b.com # partner the joint account is shared with
 *
 * The target user is created if it doesn't exist, as a *regular* user — the
 * seeded `admin` is role=admin and gets redirected to /backoffice by
 * src/proxy.ts, so it can't see the finance app at all.
 *
 * Deterministic: the same flags always produce the same data. Re-running
 * wipes the target user's financial data first, so it never stacks up.
 * Refuses to touch a Turso database — local SQLite only.
 */
import assert from "assert";
import crypto from "crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import {
  accountMembers,
  accounts,
  budgetMonthTargets,
  budgetPlans,
  budgets,
  categories,
  categoryRules,
  importBatches,
  recurringTransactions,
  reimbursementLinks,
  statResets,
  transactionGroups,
  transactions,
  userPreferences,
} from "../src/db/schema";
import { hashPassword, seedCategoriesForUser } from "../src/db/migrate";
import { buildLedgerYear } from "@/lib/budget-ledger-db";
import { financialYearOf } from "@/lib/financial-year";

// ── Args ───────────────────────────────────────────────────────────────────

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const USERNAME = arg("user", process.env.SEED_USERNAME || "demo");
const PASSWORD = arg("password", process.env.SEED_PASSWORD || "demo");
const EMAIL = arg("email", process.env.SEED_EMAIL || `${USERNAME}@local.test`);
// Second login the joint account is shared with, so the shared-account paths
// (member views, editor writes, shared budget) have something to exercise.
const SHARE_USERNAME = arg("share-user", `${USERNAME}-partner`);
const SHARE_EMAIL = arg("share-email", process.env.SEED_SHARE_EMAIL || `${SHARE_USERNAME}@local.test`);
const MONTHS = Math.max(1, Math.min(60, Number(arg("months", "18")) || 18));
const PERIOD = arg("period", "yearly") === "monthly" ? "monthly" : "yearly";

// ── Deterministic randomness ───────────────────────────────────────────────
// mulberry32 — same seed, same dataset, so screenshots and bug reports match.

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260808);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
const intBetween = (lo: number, hi: number) => Math.floor(between(lo, hi + 1));
const money = (n: number) => Math.round(n * 100) / 100;

const id = (): string => crypto.randomUUID();
const iso = (y: number, m: number, d: number) =>
  new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);

// ── Merchant catalogue ─────────────────────────────────────────────────────

const MERCHANTS: Record<string, readonly string[]> = {
  Groceries: ["Albert Heijn", "Jumbo", "Lidl", "Dirk van den Broek", "Ekoplaza"],
  Coffee: ["Starbucks", "Coffee Company", "Bagels & Beans", "Lot Sixty One"],
  "Dining Out": ["Restaurant De Kas", "Bar Botanique", "Thuisbezorgd", "Pizzeria Napoli", "Sushi Kyo"],
  Transport: ["NS Reizigers", "Shell", "Q-Park", "GVB Amsterdam", "Swapfiets"],
  Shopping: ["bol.com", "Zalando", "MediaMarkt", "IKEA", "Decathlon"],
  Entertainment: ["Pathé Cinema", "Ticketmaster", "Steam Games", "Boekhandel Scheltema"],
  Health: ["Apotheek Centrum", "Fysio Amsterdam", "Etos"],
};

/** How many of each, per month, and the amount range. */
const VARIABLE: Array<{ cat: keyof typeof MERCHANTS | string; count: [number, number]; amount: [number, number] }> = [
  { cat: "Groceries", count: [7, 11], amount: [12, 95] },
  { cat: "Coffee", count: [5, 12], amount: [2.6, 6.4] },
  { cat: "Dining Out", count: [3, 6], amount: [14, 72] },
  { cat: "Transport", count: [2, 5], amount: [4, 68] },
  { cat: "Shopping", count: [1, 3], amount: [14, 185] },
  { cat: "Entertainment", count: [0, 2], amount: [9, 55] },
  { cat: "Health", count: [0, 2], amount: [7, 48] },
];

/** Fixed monthly costs — each also gets a recurring plan the transactions link to. */
const FIXED = [
  { day: 1, name: "Vastgoed Beheer BV", desc: "Huur woning", amount: -1250, cat: "Housing" },
  { day: 1, name: "Zilveren Kruis", desc: "Zorgverzekering", amount: -142.5, cat: "Health" },
  { day: 3, name: "Vattenfall", desc: "Energie en water", amount: -145, cat: "Utilities" },
  { day: 5, name: "Ziggo", desc: "Internet en TV", amount: -45, cat: "Utilities" },
  { day: 5, name: "Odido", desc: "Mobiel abonnement", amount: -22, cat: "Utilities" },
  { day: 8, name: "Netflix", desc: "Netflix maandelijks", amount: -13.99, cat: "Subscriptions" },
  { day: 8, name: "Spotify", desc: "Spotify Premium", amount: -11.99, cat: "Subscriptions" },
  { day: 10, name: "TrainMore", desc: "Sportschool", amount: -35, cat: "Health" },
];

// Sized so a month ends comfortably in the black after fixed costs, everyday
// spending and the two standing transfers — otherwise "free to spend" seeds negative.
const SALARY = { day: 25, name: "Leadbot B.V.", desc: "Salaris", amount: 3850, cat: "Salary" };

/** pattern → category. Transactions matching one are marked categorySource "rule". */
const RULES: Array<[string, string]> = [
  ["Albert Heijn", "Groceries"],
  ["Jumbo", "Groceries"],
  ["Lidl", "Groceries"],
  ["Starbucks", "Coffee"],
  ["Coffee Company", "Coffee"],
  ["NS Reizigers", "Transport"],
  ["Shell", "Transport"],
  ["Netflix", "Subscriptions"],
  ["Spotify", "Subscriptions"],
  ["bol.com", "Shopping"],
  ["Thuisbezorgd", "Dining Out"],
  ["Salaris", "Salary"],
];

/**
 * Once-a-year costs, by calendar month — the whole reason a yearly envelope
 * beats twelve monthly ones. Each lands in a category that also has everyday
 * spending, so the month it hits blows its own target while the year stays on
 * track from what the quiet months carried over.
 */
const ANNUAL: Array<{ month: number; day: number; name: string; desc: string; amount: [number, number]; cat: string }> = [
  { month: 0, day: 14, name: "Zilveren Kruis", desc: "Eigen risico zorg", amount: [385, 385], cat: "Health" },
  { month: 1, day: 20, name: "Gemeente Amsterdam", desc: "Gemeentebelasting", amount: [420, 480], cat: "Housing" },
  { month: 2, day: 11, name: "Garage Van Dijk", desc: "APK en onderhoud", amount: [260, 520], cat: "Transport" },
  { month: 3, day: 6, name: "Zalando", desc: "Voorjaarskleding", amount: [180, 320], cat: "Shopping" },
  { month: 5, day: 18, name: "Ticketmaster", desc: "Festivaltickets", amount: [120, 210], cat: "Entertainment" },
  { month: 6, day: 9, name: "Transavia", desc: "Vluchten zomervakantie", amount: [380, 620], cat: "Other" },
  { month: 7, day: 2, name: "Booking.com", desc: "Verblijf zomervakantie", amount: [540, 880], cat: "Other" },
  { month: 8, day: 24, name: "Garage Van Dijk", desc: "Winterbanden", amount: [140, 240], cat: "Transport" },
  { month: 10, day: 29, name: "bol.com", desc: "Sinterklaascadeaus", amount: [160, 260], cat: "Shopping" },
  { month: 11, day: 15, name: "MediaMarkt", desc: "Kerstcadeaus", amount: [240, 420], cat: "Shopping" },
  { month: 11, day: 22, name: "Albert Heijn", desc: "Kerstdiner boodschappen", amount: [90, 160], cat: "Groceries" },
];

/**
 * Monthly allocations, one per spending category. The yearly ledger counts
 * every categorised expense in the plan's accounts — fixed costs included, and
 * the joint account's groceries alongside the checking account's — so these are
 * sized against the real total, not just the discretionary part. Together they
 * sit comfortably under the salary; the year should end in the black.
 */
const BUDGETS: Array<[string, number]> = [
  ["Housing", 1320],
  ["Groceries", 710],
  ["Health", 240],
  ["Shopping", 265],
  ["Utilities", 215],
  ["Dining Out", 205],
  ["Transport", 175],
  ["Other", 110],
  ["Entertainment", 46],
  ["Coffee", 42],
  ["Subscriptions", 26],
];

// ── Row builders ───────────────────────────────────────────────────────────

type Tx = typeof transactions.$inferInsert;

const ruleMatch = (text: string) =>
  RULES.some(([pattern]) => text.toLowerCase().includes(pattern.toLowerCase()));

/**
 * Find the target user, or create it with role "user" and a credential login.
 * Sign-in is by email, so the address has to be one better-auth accepts:
 * `user@local.test`, not the bare `@local` TLD it rejects as malformed.
 * `@local.test` is grandfathered as verified by initializeDatabase(), and we
 * set email_verified up front so `requireEmailVerification` can't block it.
 */
async function ensureUser(username: string, email: string): Promise<string> {
  const now = Date.now();
  const [existing] = await db.all<{ id: string; role: string | null; email: string }>(
    sql`SELECT id, role, email FROM "user" WHERE email = ${email} LIMIT 1`,
  );
  if (existing) {
    if (existing.role === "admin") {
      console.warn(
        `Note: "${username}" is an admin — src/proxy.ts redirects admins to /backoffice, so this data won't be visible in the app.`,
      );
    }
    console.log(`Using existing user "${username}" — log in with ${existing.email}.`);
    return existing.id;
  }

  const newId = id();
  await db.run(sql`
    INSERT INTO "user" (id, name, email, email_verified, role, created_at, updated_at)
    VALUES (${newId}, ${username}, ${email}, 1, 'user', ${now}, ${now})
  `);
  await db.run(sql`
    INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
    VALUES (${id()}, ${newId}, 'credential', ${newId}, ${await hashPassword(PASSWORD)}, ${now}, ${now})
  `);
  console.log(`Created user "${username}" — log in with ${email} / ${PASSWORD}.`);
  return newId;
}

async function main() {
  if (process.env.TURSO_DATABASE_URL?.trim()) {
    throw new Error("Refusing to seed dummy data into a Turso database. Unset TURSO_DATABASE_URL.");
  }

  const userId = await ensureUser(USERNAME, EMAIL);
  const partnerId = await ensureUser(SHARE_USERNAME, SHARE_EMAIL);

  // ── Wipe this user's financial data ──────────────────────────────────────
  // Explicit order rather than trusting cascades: libsql doesn't enable
  // foreign_keys by default, and transactions.category_id isn't ON DELETE anyway.
  console.log(`Clearing existing data for "${USERNAME}"...`);
  await db.run(
    sql`DELETE FROM reimbursement_links WHERE reimbursement_id IN (SELECT id FROM transactions WHERE user_id = ${userId})`,
  );
  await db.delete(transactions).where(eq(transactions.userId, userId));
  await db.delete(importBatches).where(eq(importBatches.userId, userId));
  await db.delete(recurringTransactions).where(eq(recurringTransactions.userId, userId));
  await db.delete(transactionGroups).where(eq(transactionGroups.userId, userId));
  await db.delete(budgetMonthTargets).where(eq(budgetMonthTargets.userId, userId));
  await db.delete(budgets).where(eq(budgets.userId, userId));
  await db.delete(categoryRules).where(eq(categoryRules.userId, userId));
  await db.delete(statResets).where(eq(statResets.userId, userId));
  await db.delete(userPreferences).where(eq(userPreferences.userId, userId));
  // The partner's prefs point at the plan below, which is about to be deleted.
  await db.delete(userPreferences).where(eq(userPreferences.userId, partnerId));
  await db.run(
    sql`DELETE FROM account_members WHERE account_id IN (SELECT id FROM accounts WHERE user_id = ${userId})`,
  );
  await db.delete(accounts).where(eq(accounts.userId, userId));
  await db.delete(budgetPlans).where(eq(budgetPlans.userId, userId));
  await db.delete(categories).where(eq(categories.userId, userId));

  // ── Categories ───────────────────────────────────────────────────────────
  await seedCategoriesForUser(userId);
  const catRows = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.userId, userId));
  const catId = new Map(catRows.map((c) => [c.name, c.id]));
  const cat = (name: string) => {
    const found = catId.get(name);
    if (!found) throw new Error(`Missing seeded category "${name}"`);
    return found;
  };

  // ── Budget plan ──────────────────────────────────────────────────────────
  // The history window doubles as the plan's start: the envelope covers every
  // month there is data for, so the oldest financial year is prorated exactly
  // the way a plan started mid-year is in the app.
  const today = new Date();
  const firstMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (MONTHS - 1), 1));
  const startDate = iso(firstMonth.getUTCFullYear(), firstMonth.getUTCMonth(), 1);

  const plan = { id: id(), name: "Huishouden" };
  await db.insert(budgetPlans).values({
    id: plan.id,
    userId,
    name: plan.name,
    isMain: true,
    period: PERIOD,
    periodStartedAt: PERIOD === "yearly" ? startDate : null,
    createdAt: `${startDate}T00:00:00.000Z`,
    updatedAt: `${startDate}T00:00:00.000Z`,
  });

  // ── Accounts ─────────────────────────────────────────────────────────────
  // Checking starts with a month of fixed costs in hand: the current month is
  // partial, so rent has landed but salary (the 25th) usually hasn't yet.
  // Without the buffer a short `--months` history ends on a negative balance.
  const checking = { id: id(), name: "Betaalrekening", type: "checking" as const, bank: "ing", bankName: "ING", iban: "NL91INGB0001234567", initialBalance: 3200 };
  const savings = { id: id(), name: "Spaarrekening", type: "savings" as const, bank: "asn", bankName: "ASN Bank", iban: "NL12ASNB0009876543", initialBalance: 9400 };
  const joint = { id: id(), name: "Gezamenlijke rekening", type: "joint" as const, bank: "rabobank", bankName: "Rabobank", iban: "NL55RABO0004455667", initialBalance: 620 };

  await db.insert(accounts).values(
    [checking, savings, joint].map((a, i) => ({
      id: a.id,
      userId,
      name: a.name,
      type: a.type,
      bank: a.bank,
      bankName: a.bankName,
      iban: a.iban,
      currency: "EUR",
      initialBalance: a.initialBalance,
      sortOrder: i,
      // Everyday money counts toward the budget; savings sits outside it.
      budgetId: a.type === "savings" ? null : plan.id,
    })),
  );

  // ── Recurring plans (fixed costs + salary) ───────────────────────────────
  const plans = [
    { ...SALARY, planId: id(), type: "income" as const },
    ...FIXED.map((f) => ({ ...f, planId: id(), type: "expense" as const })),
  ];

  await db.insert(recurringTransactions).values(
    plans.map((p) => ({
      id: p.planId,
      userId,
      accountId: checking.id,
      description: p.desc,
      amount: p.amount,
      type: p.type,
      categoryId: cat(p.cat),
      frequency: "monthly" as const,
      dayOfMonth: p.day,
      startDate,
      isActive: true,
    })),
  );

  // ── Pots ─────────────────────────────────────────────────────────────────
  const tripPot = { id: id(), name: "Zomervakantie", categoryId: cat("Other"), targetAmount: 1800, targetDate: iso(today.getUTCFullYear(), today.getUTCMonth() + 4, 15), fundedAmount: 900 };
  const laptopPot = { id: id(), name: "Nieuwe laptop", categoryId: cat("Shopping"), targetAmount: 1400, targetDate: iso(today.getUTCFullYear(), today.getUTCMonth() + 6, 1), fundedAmount: 350 };
  const homePot = { id: id(), name: "Huis opknappen", categoryId: cat("Housing"), targetAmount: null, targetDate: null, fundedAmount: 0 };

  await db.insert(transactionGroups).values(
    [tripPot, laptopPot, homePot].map((p) => ({ ...p, userId })),
  );

  // ── Transactions ─────────────────────────────────────────────────────────
  const txs: Tx[] = [];
  const links: Array<{ reimbursementId: string; expenseId: string }> = [];

  const push = (t: Omit<Tx, "userId" | "id"> & { id?: string }): string => {
    const rowId = t.id ?? id();
    txs.push({ ...t, id: rowId, userId });
    return rowId;
  };

  /** A dated spend/income on an account, categorised, rule-marked when a rule would hit it. */
  const spend = (opts: {
    accountId: string;
    date: string;
    name: string;
    desc: string;
    amount: number;
    cat: string;
    groupId?: string;
    recurringId?: string;
  }) =>
    push({
      accountId: opts.accountId,
      date: opts.date,
      name: opts.name,
      description: opts.desc,
      amount: money(opts.amount),
      categoryId: cat(opts.cat),
      categorySource: ruleMatch(`${opts.name} ${opts.desc}`) ? "rule" : "manual",
      type: opts.amount >= 0 ? "income" : "expense",
      groupId: opts.groupId ?? null,
      recurringTransactionId: opts.recurringId ?? null,
      isManual: false,
    });

  const todayIso = iso(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const notFuture = (d: string) => d <= todayIso;

  for (let back = MONTHS - 1; back >= 0; back--) {
    const cursor = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back, 1));
    const y = cursor.getUTCFullYear();
    const m = cursor.getUTCMonth();
    const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

    // Salary + fixed costs, each linked to its recurring plan.
    for (const p of plans) {
      const date = iso(y, m, Math.min(p.day, daysInMonth));
      if (!notFuture(date)) continue;
      const jitter = p.type === "income" ? between(-40, 120) : 0;
      spend({
        accountId: checking.id,
        date,
        name: p.name,
        desc: p.desc,
        amount: p.amount + jitter,
        cat: p.cat,
        recurringId: p.planId,
      });
    }

    // Everyday spending.
    for (const v of VARIABLE) {
      const n = intBetween(v.count[0], v.count[1]);
      for (let i = 0; i < n; i++) {
        const date = iso(y, m, intBetween(1, daysInMonth));
        if (!notFuture(date)) continue;
        const merchant = pick(MERCHANTS[v.cat]);
        spend({
          accountId: checking.id,
          date,
          name: merchant,
          desc: `Betaalautomaat ${merchant}`,
          amount: -between(v.amount[0], v.amount[1]),
          cat: v.cat,
        });
      }
    }

    // The once-a-year costs that fall in this calendar month.
    for (const a of ANNUAL.filter((a) => a.month === m)) {
      const date = iso(y, m, Math.min(a.day, daysInMonth));
      if (!notFuture(date)) continue;
      spend({
        accountId: checking.id,
        date,
        name: a.name,
        desc: a.desc,
        amount: -between(a.amount[0], a.amount[1]),
        cat: a.cat,
      });
    }

    // Monthly transfers out of checking — a linked pair per destination.
    for (const [dest, amount] of [
      [savings, 400],
      [joint, 300],
    ] as const) {
      const date = iso(y, m, Math.min(26, daysInMonth));
      if (!notFuture(date)) continue;
      const outId = id();
      const inId = id();
      push({
        id: outId,
        accountId: checking.id,
        date,
        name: dest.name,
        description: `Overboeking naar ${dest.name}`,
        amount: -amount,
        categoryId: cat("Internal Transfer"),
        categorySource: "manual",
        type: "internal_transfer",
        linkedTransactionId: inId,
        isManual: false,
      });
      push({
        id: inId,
        accountId: dest.id,
        date,
        name: checking.name,
        description: `Overboeking van ${checking.name}`,
        amount,
        categoryId: cat("Internal Transfer"),
        categorySource: "manual",
        type: "internal_transfer",
        linkedTransactionId: outId,
        isManual: false,
      });
    }

    // Joint account: shared household spend.
    for (let i = 0; i < intBetween(2, 4); i++) {
      const date = iso(y, m, intBetween(1, daysInMonth));
      if (!notFuture(date)) continue;
      const merchant = pick(MERCHANTS.Groceries);
      spend({
        accountId: joint.id,
        date,
        name: merchant,
        desc: `Boodschappen ${merchant}`,
        amount: -between(25, 120),
        cat: "Groceries",
      });
    }

    // Savings interest.
    const interestDate = iso(y, m, Math.min(28, daysInMonth));
    if (notFuture(interestDate)) {
      spend({
        accountId: savings.id,
        date: interestDate,
        name: "ASN Bank",
        desc: "Rente spaarrekening",
        amount: between(4, 14),
        cat: "Other",
      });
    }

    // Every third month: a group dinner someone pays you back for.
    if (back % 3 === 1) {
      const expDate = iso(y, m, Math.min(14, daysInMonth));
      const backDate = iso(y, m, Math.min(20, daysInMonth));
      if (notFuture(backDate)) {
        const amount = money(between(90, 165));
        const expenseId = spend({
          accountId: checking.id,
          date: expDate,
          name: "Restaurant De Kas",
          desc: "Groepsdiner (voorgeschoten)",
          amount: -amount,
          cat: "Dining Out",
        });
        const reimbursementId = push({
          accountId: checking.id,
          date: backDate,
          name: "S. de Vries",
          description: "Aandeel groepsdiner",
          amount: money(amount / 2),
          categoryId: cat("Dining Out"),
          categorySource: "manual",
          type: "reimbursement",
          isManual: false,
        });
        links.push({ reimbursementId, expenseId });
      }
    }

    // Pot spending: trip bookings in the last two full months, IKEA runs throughout.
    if (back === 2) {
      spend({ accountId: checking.id, date: iso(y, m, 12), name: "Transavia", desc: "Vluchten Lissabon", amount: -218.4, cat: "Other", groupId: tripPot.id });
    }
    if (back === 1) {
      spend({ accountId: checking.id, date: iso(y, m, 6), name: "Booking.com", desc: "Hotel Lissabon", amount: -431.75, cat: "Other", groupId: tripPot.id });
    }
    if (back % 4 === 0) {
      const date = iso(y, m, Math.min(18, daysInMonth));
      if (notFuture(date)) {
        spend({ accountId: checking.id, date, name: "IKEA", desc: "Woonaccessoires", amount: -between(45, 240), cat: "Housing", groupId: homePot.id });
      }
    }
  }

  // ── Running balance per account, in date order ───────────────────────────
  const initial = new Map([
    [checking.id, checking.initialBalance],
    [savings.id, savings.initialBalance],
    [joint.id, joint.initialBalance],
  ]);
  const running = new Map(initial);
  for (const t of [...txs].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    const next = money((running.get(t.accountId) ?? 0) + t.amount);
    running.set(t.accountId, next);
    t.balance = next;
  }

  // Invariants worth failing loudly on — a seeder that silently emits future
  // dates or a balance chain that doesn't reconcile produces confusing bugs
  // downstream in the very features it's meant to demo.
  for (const t of txs) {
    assert(t.date <= todayIso, `future-dated transaction: ${t.date} ${t.description}`);
    assert(t.categoryId != null, `uncategorised transaction: ${t.description}`);
  }
  for (const [accountId, start] of initial) {
    const sum = txs.filter((t) => t.accountId === accountId).reduce((a, t) => a + t.amount, 0);
    assert(
      Math.abs(money(start + sum) - (running.get(accountId) ?? 0)) < 0.011,
      `balance chain does not reconcile for account ${accountId}`,
    );
  }

  // ── Import batches (one per account, as if the history came from a CSV) ──
  const batches = [checking, savings, joint].map((a) => ({
    id: id(),
    userId,
    accountId: a.id,
    fileName: `${a.bank}-export-${startDate}.csv`,
    transactionCount: txs.filter((t) => t.accountId === a.id).length,
  }));
  for (const t of txs) {
    t.importBatchId = batches.find((b) => b.accountId === t.accountId)!.id;
  }

  await db.insert(importBatches).values(batches);

  // Chunked: SQLite caps bound parameters per statement.
  for (let i = 0; i < txs.length; i += 200) {
    await db.insert(transactions).values(txs.slice(i, i + 200));
  }
  if (links.length) {
    await db.insert(reimbursementLinks).values(links.map((l) => ({ id: id(), ...l })));
  }

  // ── Rules, budgets, preferences ──────────────────────────────────────────
  await db.insert(categoryRules).values(
    RULES.map(([pattern, category]) => ({
      id: id(),
      userId,
      pattern,
      categoryId: cat(category),
      matchType: "contains" as const,
      isActive: true,
    })),
  );

  // Allocations are always a monthly amount — the plan's own `period` decides
  // whether twelve of them form one envelope. `createdAt` is backdated to the
  // start of the history so the ledger doesn't treat every category as having
  // joined the envelope today (see buildLedgerYear's proration).
  await db.insert(budgets).values(
    BUDGETS.map(([category, amount]) => ({
      id: id(),
      userId,
      budgetId: plan.id,
      categoryId: cat(category),
      amount,
      period: "monthly" as const,
      isActive: true,
      status: "active" as const,
      source: "manual" as const,
      createdAt: `${startDate}T00:00:00.000Z`,
    })),
  );

  const startDay = 1;
  await db.insert(userPreferences).values({
    id: id(),
    userId,
    defaultAccountId: checking.id,
    financialMonthStartDay: startDay,
  });

  // ── Shared account ───────────────────────────────────────────────────────
  // The joint account is shared with the partner as an accepted editor. Its
  // rows keep the owner's user_id — the partner reaches them through
  // account_members — and the partner's dashboard points at the owner's plan
  // (mainBudgetPlanId, since is_main is owner-scoped).
  await seedCategoriesForUser(partnerId);
  await db.insert(accountMembers).values({
    id: id(),
    accountId: joint.id,
    userId: partnerId,
    email: SHARE_EMAIL.toLowerCase(),
    role: "editor",
    acceptedAt: `${startDate}T00:00:00.000Z`,
  });
  await db.insert(userPreferences).values({
    id: id(),
    userId: partnerId,
    financialMonthStartDay: startDay,
    mainBudgetPlanId: plan.id,
  });

  // ── Ledger ───────────────────────────────────────────────────────────────
  // Walk every financial year the history touches. Nothing is materialised —
  // the chain is derived on read — but building it here freezes the targets of
  // the closed months and checks the seeded data produces a sane chain.
  const years: number[] = [];
  if (PERIOD === "yearly") {
    const resolved = {
      id: plan.id,
      name: plan.name,
      isMain: true,
      period: "yearly" as const,
      periodStartedAt: startDate,
      accountIds: [checking.id, savings.id, joint.id],
      ownerId: userId,
      role: "owner" as const,
      ownerName: null,
    };
    const firstYear = financialYearOf(new Date(`${startDate}T00:00:00`), startDay);
    for (let y = firstYear; y <= financialYearOf(today, startDay); y++) {
      years.push(y);

      // The chain is the point of the whole feature — a seed that emits a
      // broken one demos a bug as if it were the design.
      const ledger = await buildLedgerYear(userId, resolved, y, startDay);
      assert(ledger.length > 0, `no ledger rows for ${y}`);
      for (const { categoryId, months } of ledger) {
        let carry = 0;
        for (const month of months) {
          assert(
            Math.abs(month.rolloverIn - carry) < 0.011,
            `rollover chain breaks at ${y}-${month.monthIndex} for ${categoryId}`,
          );
          carry = month.target + month.rolloverIn - month.spent;
          assert(
            Math.abs(month.rolloverOut - carry) < 0.011,
            `rolloverOut wrong at ${y}-${month.monthIndex} for ${categoryId}`,
          );
        }
      }
    }
  }

  const balances = [checking, savings, joint]
    .map((a) => `${a.name} €${(running.get(a.id) ?? 0).toFixed(2)}`)
    .join(", ");

  console.log(
    `Seeded ${txs.length} transactions across 3 accounts over ${MONTHS} months for "${USERNAME}".`,
  );
  console.log(`Balances: ${balances}`);
  console.log(
    `Shared: "${joint.name}" with ${SHARE_EMAIL} / ${PASSWORD} as editor.`,
  );
  console.log(
    `Also: ${plans.length} recurring plans, ${RULES.length} rules, ${BUDGETS.length} allocations, 3 pots, ${links.length} reimbursements.`,
  );
  console.log(
    PERIOD === "yearly"
      ? `Budget "${plan.name}" is yearly from ${startDate}; chain verified for ${years.join(", ")}.`
      : `Budget "${plan.name}" is monthly.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Seeding failed:", error);
    process.exit(1);
  });
