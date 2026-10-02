import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  categoryRules,
  recurringTransactions,
  transactions as transactionsTable,
  type Account,
} from "@/db/schema";
import {
  loadTransferCategories,
  sharedMoneyIbans,
  transferRuledOut,
} from "@/lib/detect-transfers";
import {
  extractPattern,
  normalizeIban,
  ruleCategoryFor,
  splitDuplicates,
  type PreviewTransaction,
} from "@/lib/csv-utils";
import { loadSplitRules, proposeSplitForRow } from "@/lib/split-rules";
import { findRecurringForRow } from "@/lib/recurring-match";

/**
 * One bank row in source-neutral form: what a CSV line or a PSD2 transaction
 * boils down to once parsing is done. Classification (rules, transfers,
 * recurring plans, split proposals) only ever sees this shape, so both import
 * paths file a payment exactly the same way.
 */
export interface NormalizedRow {
  date: string;
  name: string | null;
  description: string;
  amount: number;
  balance: number | null;
  /** The other side's IBAN in any spacing; normalized here. */
  counterpartyIban?: string | null;
}

/**
 * Classify rows for the account `account` (owned by `account.userId`): pick a
 * type, a category from the owner's rules, the target account of an internal
 * transfer, a recurring plan and a split proposal — the same decisions the CSV
 * preview has always made. Pure read; nothing is written.
 */
export async function classifyRows(
  account: Pick<Account, "id" | "userId" | "internalTransfers">,
  rows: NormalizedRow[],
): Promise<PreviewTransaction[]> {
  const ownerId = account.userId;
  const accountId = account.id;

  // Fetch active category rules for auto-categorization
  const rules = await db
    .select()
    .from(categoryRules)
    .where(and(eq(categoryRules.isActive, true), eq(categoryRules.userId, ownerId)));

  // Active split rules — propose splits on the rows they match (below).
  const splitRules = await loadSplitRules(ownerId);

  // Build IBAN → account lookup for internal transfer detection. Accounts
  // whose money is no longer purely the owner's (a joint household account)
  // stay out: a contribution to one is a real expense here and a real income
  // there, not a transfer. Same for the whole map when the account being
  // imported is itself one of those.
  const allAccounts = await db.select().from(accounts).where(eq(accounts.userId, ownerId));
  const ibanToAccount = new Map<string, { id: string; name: string }>();
  if (account.internalTransfers) {
    for (const acc of allAccounts) {
      const iban = normalizeIban(acc.iban);
      if (iban && acc.internalTransfers) {
        ibanToAccount.set(iban, { id: acc.id, name: acc.name });
      }
    }
  }

  // The "Internal Transfer" category, plus every transfer bucket: rules can
  // point at one too, and those are held back on rows the account policy
  // says can't be a transfer (see transferRuledOut).
  const { primary: transferCategory, ids: transferCategories } =
    await loadTransferCategories(db, ownerId);
  const sharedIbans = sharedMoneyIbans(allAccounts);

  // Active recurring plans — used to auto-link rows that look like a
  // recurring bill so they don't double-count in Free to Spend.
  const recurringPlans = await db
    .select({
      id: recurringTransactions.id,
      accountId: recurringTransactions.accountId,
      description: recurringTransactions.description,
      amount: recurringTransactions.amount,
      type: recurringTransactions.type,
      isActive: recurringTransactions.isActive,
      matchPattern: recurringTransactions.matchPattern,
      matchField: recurringTransactions.matchField,
      matchDescriptionPattern: recurringTransactions.matchDescriptionPattern,
    })
    .from(recurringTransactions)
    .where(
      and(
        eq(recurringTransactions.userId, ownerId),
        eq(recurringTransactions.isActive, true),
      )
    );
  const recurringById = new Map(recurringPlans.map((p) => [p.id, p]));

  return rows.map((row) => {
    const { date, name, description, amount, balance } = row;

    let type: "income" | "expense" | "internal_transfer" =
      amount >= 0 ? "income" : "expense";

    // Check for internal transfer via counterparty IBAN
    let targetAccountId: string | undefined;
    let targetAccountName: string | undefined;
    let counterpartyIban: string | undefined;
    const normalizedIban = normalizeIban(row.counterpartyIban);
    if (normalizedIban) {
      // Stored normalized so post-import detection can compare it to an
      // account's IBAN without re-guessing the bank's spacing.
      counterpartyIban = normalizedIban;
      const matchedAccount = ibanToAccount.get(normalizedIban);
      if (matchedAccount && matchedAccount.id !== accountId) {
        type = "internal_transfer";
        targetAccountId = matchedAccount.id;
        targetAccountName = matchedAccount.name;
      }
    }

    // Auto-categorize using rules (skip if already detected as transfer).
    // Each rule matches the text its matchField names.
    let categoryId: string | null;
    if (type === "internal_transfer" && transferCategory) {
      categoryId = transferCategory.id;
    } else {
      const noTransfer = transferRuledOut(account, counterpartyIban, sharedIbans);
      categoryId = ruleCategoryFor(
        rules,
        name,
        description,
        noTransfer ? transferCategories : undefined,
      );
    }

    // Try to match this row to an active recurring plan (skip transfers —
    // those flows aren't tracked as fixed costs).
    let recurringTransactionId: string | null = null;
    let recurringDescription: string | null = null;
    if (type === "income" || type === "expense") {
      recurringTransactionId = findRecurringForRow(
        { accountId, amount, name, description },
        recurringPlans,
      );
      if (recurringTransactionId) {
        recurringDescription =
          recurringById.get(recurringTransactionId)?.description ?? null;
      }
    }

    // A matching split rule takes over the row's categorization: the parts
    // carry the categories, the row itself stays uncategorized.
    const proposal = splitRules.length
      ? proposeSplitForRow(splitRules, {
          type,
          amount,
          name,
          description,
          targetAccountId,
        })
      : null;

    return {
      tempId: crypto.randomUUID(),
      date,
      name,
      description,
      amount,
      balance: balance !== null && isNaN(balance) ? null : balance,
      type,
      categoryId: proposal ? null : categoryId,
      splits: proposal?.splits ?? null,
      splitRuleId: proposal?.splitRuleId ?? null,
      suggestedPattern: extractPattern(description),
      counterpartyIban,
      targetAccountId,
      targetAccountName,
      recurringTransactionId,
      recurringDescription,
    };
  });
}

/**
 * Drop rows already in the account so the user doesn't waste time
 * categorizing transactions that the commit would skip anyway. Same match
 * logic (date, amount, balance/description) used at commit time.
 */
export async function dropExistingRows<T extends NormalizedRow>(
  account: Pick<Account, "id" | "userId">,
  rows: T[],
): Promise<{ unique: T[]; duplicates: T[] }> {
  const existingRows = await db
    .select({
      date: transactionsTable.date,
      amount: transactionsTable.amount,
      balance: transactionsTable.balance,
      description: transactionsTable.description,
    })
    .from(transactionsTable)
    // Split children share their parent's date and (by default) description
    // with a fractional amount — without the parent filter they manufacture
    // dedup keys that swallow genuine new rows from balance-less exports.
    .where(
      and(
        eq(transactionsTable.accountId, account.id),
        eq(transactionsTable.userId, account.userId),
        isNull(transactionsTable.parentTransactionId),
      ),
    );
  return splitDuplicates(existingRows, rows);
}
