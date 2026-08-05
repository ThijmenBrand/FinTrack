import { db } from "@/db";
import {
  accounts,
  categories,
  transactionGroups,
  transactions,
} from "@/db/schema";
import { alias } from "drizzle-orm/sqlite-core";
import {
  and,
  eq,
  gte,
  inArray,
  lte,
  not,
  sql,
  type SQL,
} from "drizzle-orm";
import { effectiveExpenseAmount, potSpentAmount } from "@/lib/reimbursement-sql";
import type { MoneyFlowData } from "@/types/api";

/** Beyond this the diagram is unreadable; the tail is merged into "Other". */
const MAX_CATEGORIES = 12;
const MAX_SOURCES = 8;
/** Flows below this are noise in a chart scaled to a month's income. */
const MIN_FLOW = 1;

const OTHER_COLOR = "#94a3b8";
/** Accounts have no colour of their own; these keep the middle column legible. */
const ACCOUNT_COLORS = [
  "#6366f1",
  "#0ea5e9",
  "#14b8a6",
  "#f59e0b",
  "#a855f7",
  "#ef4444",
];

type Node = MoneyFlowData["nodes"][number];
/** One account's share of a category, on whichever side that category nets to. */
type Bucket = { accountId: string; categoryId: string | null; total: number };

/**
 * The graph behind the Insights "Money flow" card: income sources (by
 * category) → accounts → spending categories, with account→account edges for
 * internal transfers.
 *
 * The in side adds up to the Income card and the out side to the Expenses
 * card, because the same netting is applied and no more: expenses are
 * reimbursement-adjusted, and pot (transaction-group) spending is netted per
 * pot and attributed to the pot's own category. Income is NOT netted off
 * same-category spending the way /api/insights' categoryBreakdown does — that
 * turns a €2.000 gift booked to a category with €2.000 of spend into no flows
 * at all, and the card silently loses money the other cards report.
 *
 * What's left over after those flows — money that arrived before the window or
 * stayed put — closes each in-scope account's bar as "From balance" / "Left in
 * account".
 */
export async function buildMoneyFlow(
  userId: string,
  range: { dateFrom?: string | null; dateTo?: string | null; accountIds?: string[] },
): Promise<MoneyFlowData> {
  const accountIds = range.accountIds ?? [];

  const conds: SQL[] = [eq(transactions.userId, userId)];
  if (range.dateFrom) conds.push(gte(transactions.date, range.dateFrom));
  if (range.dateTo) conds.push(lte(transactions.date, range.dateTo));
  if (accountIds.length > 0)
    conds.push(inArray(transactions.accountId, accountIds));

  const linked = alias(transactions, "linked_tx");
  // `linked_transaction_id` is a bare id column with no foreign key, so the
  // join is guarded to this user like every other cross-row join here.
  const linkedJoin = and(
    eq(linked.id, transactions.linkedTransactionId),
    eq(linked.userId, userId),
  );
  // A transfer is read from its paying side, but only when that side is inside
  // this scope and range. Everything else — an unpaired leg, or a pair booked
  // either side of the range edge, which is what a next-day credit looks like —
  // has to be read from the receiving side or it vanishes from the diagram.
  // `IS NOT NULL` is never NULL itself, so an unjoined row falls out of the
  // conjunction as false rather than unknown.
  const payerCounted: SQL[] = [sql`${linked.id} IS NOT NULL`];
  if (range.dateFrom) payerCounted.push(gte(linked.date, range.dateFrom));
  if (range.dateTo) payerCounted.push(lte(linked.date, range.dateTo));
  if (accountIds.length > 0)
    payerCounted.push(inArray(linked.accountId, accountIds));

  const [
    directRows,
    potRows,
    reimbursementRows,
    transferOut,
    transferIn,
    acctRows,
    catRows,
  ] = await Promise.all([
    // Ungrouped expenses and income in one pass, kept on separate legs: every
    // euro that arrived has to be routed, so income booked to a spending
    // category is still a source, not a discount on that category.
    // `reimbursed` is how much reimbursement money the expense leg absorbed.
    db
      .select({
        accountId: transactions.accountId,
        categoryId: transactions.categoryId,
        expense: sql<number>`sum(CASE WHEN ${transactions.type} = 'expense'
          THEN (${effectiveExpenseAmount()}) ELSE 0 END)`,
        income: sql<number>`sum(CASE WHEN ${transactions.type} = 'income'
          THEN ${transactions.amount} ELSE 0 END)`,
        reimbursed: sql<number>`sum(CASE WHEN ${transactions.type} = 'expense'
          THEN abs(${transactions.amount}) - (${effectiveExpenseAmount()}) ELSE 0 END)`,
      })
      .from(transactions)
      .where(
        and(
          inArray(transactions.type, ["expense", "income"]),
          sql`${transactions.groupId} IS NULL`,
          ...conds,
        ),
      )
      .groupBy(transactions.accountId, transactions.categoryId),
    // Pot spending, netted per pot so a pot that took in more than it spent
    // contributes nothing rather than its gross outgoings.
    // ponytail: netted per (account, pot). A pot funded from one account and
    // spent from another nets per side; group by pot alone if that shows up.
    db
      .select({
        accountId: transactions.accountId,
        categoryId: transactionGroups.categoryId,
        total: sql<number>`${potSpentAmount()}`,
      })
      .from(transactionGroups)
      .innerJoin(transactions, eq(transactions.groupId, transactionGroups.id))
      .where(and(sql`${transactions.type} != 'internal_transfer'`, ...conds))
      .groupBy(
        transactions.accountId,
        transactionGroups.id,
        transactionGroups.categoryId,
      ),
    db
      .select({
        accountId: transactions.accountId,
        total: sql<number>`sum(${transactions.amount})`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.type, "reimbursement"),
          sql`${transactions.groupId} IS NULL`,
          ...conds,
        ),
      )
      .groupBy(transactions.accountId),
    db
      .select({
        fromId: transactions.accountId,
        toId: linked.accountId,
        total: sql<number>`sum(-${transactions.amount})`,
      })
      .from(transactions)
      .leftJoin(linked, linkedJoin)
      .where(
        and(
          eq(transactions.type, "internal_transfer"),
          sql`${transactions.amount} < 0`,
          ...conds,
        ),
      )
      .groupBy(transactions.accountId, linked.accountId),
    db
      .select({
        fromId: linked.accountId,
        toId: transactions.accountId,
        total: sql<number>`sum(${transactions.amount})`,
      })
      .from(transactions)
      .leftJoin(linked, linkedJoin)
      .where(
        and(
          eq(transactions.type, "internal_transfer"),
          sql`${transactions.amount} > 0`,
          not(and(...payerCounted)!),
          ...conds,
        ),
      )
      .groupBy(linked.accountId, transactions.accountId),
    db
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(eq(accounts.userId, userId))
      .orderBy(accounts.sortOrder),
    db
      .select({
        id: categories.id,
        name: categories.name,
        color: categories.color,
      })
      .from(categories)
      .where(eq(categories.userId, userId)),
  ]);

  const acctName = new Map(acctRows.map((a) => [a.id, a.name]));
  const acctColor = new Map(
    acctRows.map((a, i) => [a.id, ACCOUNT_COLORS[i % ACCOUNT_COLORS.length]]),
  );
  const catMeta = new Map(catRows.map((c) => [c.id, c]));

  // A category can sit on both sides of the accounts: money came in under it
  // and money went out under it. Netting the two would hide the smaller leg
  // from the diagram entirely, so each is carried on its own.
  const spend: Bucket[] = [];
  const sources: Bucket[] = [];
  const reimbursedByAccount = new Map<string, number>();
  for (const row of directRows) {
    reimbursedByAccount.set(
      row.accountId,
      (reimbursedByAccount.get(row.accountId) ?? 0) + (row.reimbursed ?? 0),
    );
    const bucket = { accountId: row.accountId, categoryId: row.categoryId };
    if ((row.expense ?? 0) > 0) spend.push({ ...bucket, total: row.expense });
    if ((row.income ?? 0) > 0) sources.push({ ...bucket, total: row.income });
  }
  for (const row of potRows) {
    const total = row.total ?? 0;
    if (total > 0)
      spend.push({
        accountId: row.accountId,
        categoryId: row.categoryId,
        total,
      });
  }

  // Keep the biggest N categories/sources; everything else merges into one row.
  const keepTop = (rows: Bucket[], limit: number) => {
    const byCat = new Map<string, number>();
    for (const r of rows) {
      const key = r.categoryId ?? "none";
      byCat.set(key, (byCat.get(key) ?? 0) + r.total);
    }
    return new Set(
      [...byCat.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([id]) => id),
    );
  };
  const keptSources = keepTop(sources, MAX_SOURCES);
  const keptCategories = keepTop(spend, MAX_CATEGORIES);

  const nodes = new Map<string, Node>();
  const links = new Map<
    string,
    { source: string; target: string; value: number }
  >();

  const addNode = (node: Node) => {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
    return node.id;
  };
  const addLink = (source: string, target: string, value: number) => {
    if (!(value > 0) || source === target) return;
    const key = `${source} ${target}`;
    const existing = links.get(key);
    if (existing) existing.value += value;
    else links.set(key, { source, target, value });
  };

  const accountNode = (id: string | null) =>
    addNode({
      id: `acct:${id ?? "external"}`,
      name: id ? acctName.get(id) ?? "Account" : "Other account",
      kind: "account",
      color: (id && acctColor.get(id)) || OTHER_COLOR,
    });

  // Income sources → accounts
  for (const row of sources) {
    const key = row.categoryId ?? "none";
    const meta = row.categoryId ? catMeta.get(row.categoryId) : undefined;
    const source = keptSources.has(key)
      ? addNode({
          id: `in:${key}`,
          name: meta?.name ?? "Uncategorized income",
          kind: "income",
          color: meta?.color ?? OTHER_COLOR,
        })
      : addNode({
          id: "in:other",
          name: "Other income",
          kind: "income",
          color: OTHER_COLOR,
        });
    addLink(source, accountNode(row.accountId), row.total);
  }

  // Accounts → spending categories
  for (const row of spend) {
    const key = row.categoryId ?? "none";
    const meta = row.categoryId ? catMeta.get(row.categoryId) : undefined;
    const target = keptCategories.has(key)
      ? addNode({
          id: `cat:${key}`,
          name: meta?.name ?? "Uncategorized",
          kind: "category",
          color: meta?.color ?? OTHER_COLOR,
        })
      : addNode({
          id: "cat:other",
          name: "Other spending",
          kind: "category",
          color: OTHER_COLOR,
        });
    addLink(accountNode(row.accountId), target, row.total);
  }

  // Reimbursement cash that didn't reduce any spending in this window: the
  // expense it pays back falls outside the range, or it was never linked to
  // one. Without this the money is invisible and the leftover reads too low.
  for (const row of reimbursementRows) {
    const unmatched =
      (row.total ?? 0) - (reimbursedByAccount.get(row.accountId) ?? 0);
    if (unmatched < MIN_FLOW) continue;
    addLink(
      addNode({
        id: "in:__reimb",
        name: "Reimbursements",
        kind: "income",
        color: OTHER_COLOR,
      }),
      accountNode(row.accountId),
      unmatched,
    );
  }

  const pairs = new Map<string, number>();
  const pairKey = (from: string, to: string) => `${from} ${to}`;
  for (const row of [...transferOut, ...transferIn]) {
    const total = row.total ?? 0;
    if (total <= 0) continue;
    const from = row.fromId ?? "external";
    const to = row.toId ?? "external";
    if (from === to) continue;
    const key = pairKey(from, to);
    pairs.set(key, (pairs.get(key) ?? 0) + total);
  }

  // Money that went round in a circle never really left, so the smallest leg of
  // a cycle is subtracted from every edge in it until the account graph is
  // acyclic. A savings buffer topped up and dipped into is the shortest case;
  // without this both legs are listed at full size and the account looks like
  // it moved twice the money it did.
  const findCycle = (): string[] | null => {
    const out = new Map<string, string[]>();
    for (const [key, value] of pairs) {
      if (value < MIN_FLOW) continue;
      const [from, to] = key.split(" ");
      out.set(from, [...(out.get(from) ?? []), to]);
    }
    const state = new Map<string, number>();
    const stack: string[] = [];
    const walk = (id: string): string[] | null => {
      state.set(id, 1);
      stack.push(id);
      for (const next of out.get(id) ?? []) {
        if (state.get(next) === 1) return stack.slice(stack.indexOf(next));
        if (!state.get(next)) {
          const cycle = walk(next);
          if (cycle) return cycle;
        }
      }
      stack.pop();
      state.set(id, 2);
      return null;
    };
    for (const id of out.keys()) {
      if (state.get(id)) continue;
      const cycle = walk(id);
      if (cycle) return cycle;
    }
    return null;
  };
  // Each pass zeroes at least one edge, so the graph can't outlast its edges.
  for (let i = 0; i <= pairs.size; i++) {
    const cycle = findCycle();
    if (!cycle) break;
    const legs = cycle.map((from, j) =>
      pairKey(from, cycle[(j + 1) % cycle.length]),
    );
    const smallest = Math.min(...legs.map((key) => pairs.get(key) ?? 0));
    for (const key of legs) pairs.set(key, (pairs.get(key) ?? 0) - smallest);
  }

  for (const [key, value] of pairs) {
    if (value < MIN_FLOW) continue;
    const [from, to] = key.split(" ");
    addLink(
      accountNode(from === "external" ? null : from),
      accountNode(to === "external" ? null : to),
      value,
    );
  }

  // Sub-euro ribbons go before the bars are balanced, so what they carried ends
  // up in the leftover instead of leaving a gap.
  for (const [key, link] of links) if (link.value < MIN_FLOW) links.delete(key);

  // Every in-scope account bar should be fully connected: whatever came in and
  // didn't leave stayed put, and an account that paid out more than it took in
  // dipped into the balance it started the period with. Without these the bars
  // have unexplained gaps that read as a rendering fault. Accounts outside the
  // filter are skipped — only their transfers were queried, so their balance
  // isn't ours to explain — and so is the "Other account" bucket, which stands
  // in for accounts that were never queried at all.
  const inScope = (id: string) =>
    id !== "external" && (accountIds.length === 0 || accountIds.includes(id));
  const inflow = new Map<string, number>();
  const outflow = new Map<string, number>();
  for (const l of links.values()) {
    inflow.set(l.target, (inflow.get(l.target) ?? 0) + l.value);
    outflow.set(l.source, (outflow.get(l.source) ?? 0) + l.value);
  }
  for (const node of [...nodes.values()]) {
    if (node.kind !== "account") continue;
    if (!inScope(node.id.slice("acct:".length))) continue;
    const diff = (inflow.get(node.id) ?? 0) - (outflow.get(node.id) ?? 0);
    if (diff >= MIN_FLOW) {
      addLink(
        node.id,
        addNode({
          id: "cat:__left",
          name: "Left in account",
          kind: "category",
          color: OTHER_COLOR,
        }),
        diff,
      );
    } else if (-diff >= MIN_FLOW) {
      addLink(
        addNode({
          id: "in:__balance",
          name: "From balance",
          kind: "income",
          color: OTHER_COLOR,
        }),
        node.id,
        -diff,
      );
    }
  }

  const flows = [...links.values()];
  const used = new Set(flows.flatMap((l) => [l.source, l.target]));

  return {
    nodes: [...nodes.values()].filter((n) => used.has(n.id)),
    links: flows,
  };
}
