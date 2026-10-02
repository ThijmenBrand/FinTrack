import { db, type DbTx } from "@/db";
import {
  transactions,
  importBatches,
  categoryRules,
  categories,
  accounts,
  recurringTransactions,
  transactionGroups,
  reimbursementLinks,
  transactionAttachments,
  type Account,
} from "@/db/schema";
import { eq, and, lt, gte, lte, inArray, isNull, isNotNull } from "drizzle-orm";
import {
  detectTransfers,
  loadTransferCategories,
  sharedMoneyIbans,
  transferRuledOut,
  TRANSFER_WINDOW_DAYS,
  withinTransferWindow,
} from "@/lib/detect-transfers";
import {
  canSplitImportRow,
  matchesRule,
  normalizeIban,
  ruleCategoryFor,
  ruleMatchTarget,
  splitDuplicates,
  type SplitPart,
} from "@/lib/csv-utils";
import {
  validatePattern,
  sanitizeNote,
  isFiniteNumber,
  isIsoDate,
  isMatchType,
  isMatchField,
  MONEY_EPSILON,
} from "@/lib/validation";
import { applyRuleToTransactions } from "@/lib/apply-rule";
import { splitStamps } from "@/lib/transaction-split";
import { subLineCategories } from "@/lib/budget-sub-lines";
import type { MessageKey, Vars } from "@/lib/i18n/translate";

const TX_TYPES = ["income", "expense", "internal_transfer", "reimbursement"] as const;
type TxType = (typeof TX_TYPES)[number];

export interface CommitTransaction {
  tempId: string;
  date: string;
  name: string | null;
  description: string;
  amount: number;
  balance: number | null;
  type: string;
  categoryId: string | null;
  /** Budget sub-line under `categoryId` the reviewer narrowed the row to. */
  subLineId?: string | null;
  groupId?: string | null;
  reimbursesExpenseId?: string | null;
  reimbursesTempId?: string | null;
  notes?: string | null;
  targetAccountId?: string;
  /** The other side's IBAN as the export gave it; stored so detection can verify a pair. */
  counterpartyIban?: string | null;
  recurringTransactionId?: string | null;
  /** Split this row into child rows on insert; the row itself becomes a wrapper. */
  splits?: SplitPart[] | null;
  /** Set while the parts are an untouched rule proposal — makes the children's category source "rule". */
  splitRuleId?: string | null;
  /**
   * Receipts uploaded during review. The files are already in the blob store
   * with no transaction_id; only their ids matter here. The rest of each object
   * is what the review UI needed to draw a tile and is ignored.
   */
  attachments?: Array<{ id: string }> | null;
  /**
   * The bank's own stable id for this payment (bank sync only). Unique per
   * account, so a re-delivered row can never be inserted twice.
   */
  externalId?: string | null;
}

export interface NewRule {
  pattern: string;
  categoryId: string;
  matchType: "contains" | "exact" | "starts_with";
  matchField?: "both" | "name" | "description";
}

const MIN_SPLITS = 2;
const MAX_SPLITS = 20;

/**
 * Validate a row's split parts the same way /api/transactions/[id]/split does:
 * a splittable row, 2–20 parts, every part non-zero and signed like the row,
 * summing to the row amount, all categories owned by the account owner.
 * Returns an error message key, or null when the parts are fine.
 */
function validateSplits(
  tx: CommitTransaction,
  ownerCategoryIds: Set<string>,
): "api.splitWrongType" | "api.splitTooFew" | "api.splitTooMany" | "api.splitInvalidAmount" | "api.splitSumMismatch" | "api.splitInvalidCategory" | null {
  const splits = tx.splits ?? [];
  if (!canSplitImportRow(tx)) return "api.splitWrongType";
  if (splits.length < MIN_SPLITS) return "api.splitTooFew";
  if (splits.length > MAX_SPLITS) return "api.splitTooMany";

  const sign = Math.sign(tx.amount);
  let sum = 0;
  for (const part of splits) {
    if (!part || typeof part !== "object") return "api.splitInvalidAmount";
    if (!isFiniteNumber(part.amount) || part.amount === 0 || Math.sign(part.amount) !== sign) {
      return "api.splitInvalidAmount";
    }
    if (part.categoryId && !ownerCategoryIds.has(part.categoryId)) {
      return "api.splitInvalidCategory";
    }
    sum += part.amount;
  }
  if (Math.abs(sum - tx.amount) > MONEY_EPSILON) return "api.splitSumMismatch";
  return null;
}

export interface CommitImportOptions {
  /**
   * Who is importing. Recorded as createdBy/modifiedBy, and transfer
   * detection runs in their writable scope. For a background bank sync this
   * is the account owner.
   */
  actorId: string;
  /** The account the rows land in; its owner owns every row written. */
  account: Account;
  /** Shown in import history: the CSV file name, or "Bank sync · ING". */
  batchLabel: string;
  source: "csv" | "bank_sync";
  transactions: CommitTransaction[];
  newRules?: NewRule[];
  /**
   * How rows already in the account are recognised. "content" is the CSV
   * heuristic (date + amount + balance, or description without a balance).
   * "externalId" trusts the bank's own id instead: the caller has already
   * dropped known ids, and two genuinely identical payments on one day must
   * both survive.
   */
  dedupe?: "content" | "externalId";
  /**
   * Runs inside the write transaction once every row is in — bank sync
   * advances its cursor here, so rows and cursor commit or roll back together.
   */
  afterWrite?: (tx: DbTx, outcome: { batchId: string; imported: number }) => Promise<void>;
}

export type CommitImportResult =
  | {
      ok: true;
      imported: number;
      duplicatesSkipped: number;
      mirrorsAbsorbed: number;
      mirrorTransactions: number;
      batchId: string;
      rulesCreated: number;
      existingUpdated: number;
      transfersDetected: number;
    }
  | { ok: false; error: MessageKey; vars?: Vars };

/**
 * Write reviewed import rows into `account`: dedup against what is already
 * there, absorb or mint transfer mirrors, split wrappers and children,
 * reimbursement links, receipts and new rules — then run transfer detection.
 *
 * Every row is validated before anything is written, and all writes happen in
 * one database transaction: an import lands completely or not at all.
 */
export async function commitImport(opts: CommitImportOptions): Promise<CommitImportResult> {
  const { actorId: userId, account, transactions: txList } = opts;
  const accountId = account.id;
  const ownerId = account.userId;
  const importedAccountIban = account.iban;
  const newRules = opts.newRules ?? [];

  const ownerAccounts = await db
    .select({ id: accounts.id, iban: accounts.iban, internalTransfers: accounts.internalTransfers })
    .from(accounts)
    .where(eq(accounts.userId, ownerId));
  const ownerAccountIds = new Set(ownerAccounts.map((a) => a.id));
  const sharedMoney = new Set(
    ownerAccounts.filter((a) => !a.internalTransfers).map((a) => a.id),
  );

  const ownerPlans = await db
    .select({ id: recurringTransactions.id })
    .from(recurringTransactions)
    .where(eq(recurringTransactions.userId, ownerId));
  const ownerPlanIds = new Set(ownerPlans.map((p) => p.id));

  const ownerCategoryRows = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.userId, ownerId));
  const ownerCategoryIds = new Set(ownerCategoryRows.map((c) => c.id));
  // id → the category the sub-line plans for, so a row can only be narrowed
  // to a line of the category it was actually filed under.
  const ownerSubLines = await subLineCategories(db, ownerId);

  // Validate every row before writing anything — no partial imports.
  for (const [i, tx] of txList.entries()) {
    if (!TX_TYPES.includes(tx.type as TxType)) {
      return { ok: false, error: "api.invalidTypeOnRow", vars: { n: i + 1 } };
    }
    if (!isFiniteNumber(tx.amount)) {
      return { ok: false, error: "api.invalidAmountOnRow", vars: { n: i + 1 } };
    }
    if (tx.balance != null && !isFiniteNumber(tx.balance)) {
      return { ok: false, error: "api.invalidBalanceOnRow", vars: { n: i + 1 } };
    }
    if (!isIsoDate(tx.date)) {
      return { ok: false, error: "api.invalidDateOnRow", vars: { n: i + 1 } };
    }
    if (typeof tx.description !== "string") {
      return { ok: false, error: "api.invalidDescriptionOnRow", vars: { n: i + 1 } };
    }
    if (tx.name != null && typeof tx.name !== "string") {
      return { ok: false, error: "api.invalidNameOnRow", vars: { n: i + 1 } };
    }
    if (tx.categoryId && !ownerCategoryIds.has(tx.categoryId)) {
      return { ok: false, error: "api.unknownCategoryOnRow", vars: { n: i + 1 } };
    }
    if (tx.subLineId && ownerSubLines.get(tx.subLineId) !== tx.categoryId) {
      return { ok: false, error: "api.unknownSubCategoryOnRow", vars: { n: i + 1 } };
    }
    if (tx.targetAccountId && !ownerAccountIds.has(tx.targetAccountId)) {
      return { ok: false, error: "api.unknownAccountOnRow", vars: { n: i + 1 } };
    }
    if (tx.recurringTransactionId && !ownerPlanIds.has(tx.recurringTransactionId)) {
      return { ok: false, error: "api.unknownRecurringOnRow", vars: { n: i + 1 } };
    }
    if (tx.splits != null) {
      if (!Array.isArray(tx.splits)) {
        return { ok: false, error: "api.splitInvalidAmount" };
      }
      const splitError = validateSplits(tx, ownerCategoryIds);
      if (splitError) return { ok: false, error: splitError };
    }
  }

  const activeRules = await db
    .select()
    .from(categoryRules)
    .where(and(eq(categoryRules.isActive, true), eq(categoryRules.userId, ownerId)));
  const { primary: transferCategory, ids: transferCategories } =
    await loadTransferCategories(db, ownerId);
  const sharedIbans = sharedMoneyIbans(ownerAccounts);

  // A row the policy no longer lets be a transfer, filed the way a fresh
  // preview would: by the rules, none of them into a transfer bucket.
  const refileAsPlain = (tx: CommitTransaction) => {
    tx.categoryId = ruleCategoryFor(activeRules, tx.name, tx.description, transferCategories);
    tx.subLineId = undefined;
  };

  // The account policy decides what a transfer IS, and the preview that
  // proposed these rows may be minutes old — the flag can have been switched
  // off in another tab since. Re-checked here because this is where the rows
  // are written: either side holding money that isn't purely the owner's
  // makes the move a real expense on one side and a real income on the other,
  // so the row goes in as the plain transaction the CSV already describes —
  // out of the transfer bucket the preview put it in.
  if (sharedMoney.size > 0) {
    for (const tx of txList) {
      if (tx.type !== "internal_transfer" || !tx.targetAccountId) continue;
      if (sharedMoney.has(accountId) || sharedMoney.has(tx.targetAccountId)) {
        tx.type = tx.amount >= 0 ? "income" : "expense";
        tx.targetAccountId = undefined;
        if (tx.categoryId && transferCategories.has(tx.categoryId)) refileAsPlain(tx);
      }
    }
  }

  // The same staleness for rules: a stale preview may have let a rule file a
  // now ruled-out row into a transfer bucket. A transfer bucket that is
  // exactly what the rules pick with the policy ignored is taken as that
  // rule's doing and re-filed; any other transfer pick is the reviewer's own.
  for (const tx of txList) {
    if (tx.splits || tx.type === "internal_transfer") continue;
    if (!tx.categoryId || !transferCategories.has(tx.categoryId)) continue;
    if (!transferRuledOut(account, tx.counterpartyIban, sharedIbans)) continue;
    if (ruleCategoryFor(activeRules, tx.name, tx.description) === tx.categoryId) {
      refileAsPlain(tx);
    }
  }

  // Validate all rule patterns upfront so we don't write a partial import.
  const cleanRules: NewRule[] = [];
  for (const rule of newRules) {
    if (!rule.pattern || !rule.categoryId) continue;
    if (!ownerCategoryIds.has(rule.categoryId)) {
      return { ok: false, error: "api.unknownCategoryOnRule" };
    }
    const validated = validatePattern(rule.pattern);
    if (!validated.ok) {
      return { ok: false, error: validated.error, vars: validated.vars };
    }
    cleanRules.push({
      ...rule,
      pattern: validated.value,
      matchType: isMatchType(rule.matchType) ? rule.matchType : "contains",
      matchField: isMatchField(rule.matchField) ? rule.matchField : "both",
    });
  }

  // Skip rows already in this account — re-importing an overlapping CSV
  // export must not double-count (Revolut exports can overlap and even
  // translate descriptions between languages, see splitDuplicates).
  let uniqueTxList: CommitTransaction[];
  let duplicates: CommitTransaction[];
  if (opts.dedupe === "externalId") {
    const ids = txList.map((tx) => tx.externalId).filter((id): id is string => !!id);
    const known = ids.length
      ? await db
          .select({ externalId: transactions.externalId })
          .from(transactions)
          .where(
            and(
              eq(transactions.accountId, accountId),
              eq(transactions.userId, ownerId),
              inArray(transactions.externalId, ids),
            ),
          )
      : [];
    const knownIds = new Set(known.map((k) => k.externalId));
    uniqueTxList = txList.filter((tx) => !tx.externalId || !knownIds.has(tx.externalId));
    duplicates = txList.filter((tx) => !!tx.externalId && knownIds.has(tx.externalId));
  } else {
    const existingRows = await db
      .select({
        date: transactions.date,
        amount: transactions.amount,
        balance: transactions.balance,
        description: transactions.description,
      })
      .from(transactions)
      // Split children share their parent's date and (by default) description
      // with a fractional amount — without the parent filter they manufacture
      // dedup keys that swallow genuine new rows from balance-less exports.
      .where(and(eq(transactions.accountId, accountId), eq(transactions.userId, ownerId), isNull(transactions.parentTransactionId)));
    ({ unique: uniqueTxList, duplicates } = splitDuplicates(existingRows, txList));
  }

  // ── Mirror bookkeeping ──────────────────────────────────────────────────
  // A transfer row makes the import write a MIRROR into the target account.
  // That mirror carries no running balance, so `splitDuplicates` — which
  // trusts balances — can never recognise it, and importing the target
  // account's own export inserts the same payment a second time. The account
  // balance then drifts by the transfer amount, permanently.
  //
  // Both directions are handled here: absorb a mirror another account's
  // import already left in THIS account, and skip writing a mirror where the
  // target account already holds the row.
  const sameAmount = (a: number, b: number) => Math.abs(a - b) <= MONEY_EPSILON;
  const shiftDays = (iso: string, days: number) =>
    new Date(new Date(iso).getTime() + days * 86_400_000).toISOString().slice(0, 10);

  // Flagged by the mirror writer below, never inferred: a row the user typed
  // by hand wears the same manual/no-batch/linked shape the moment
  // detectTransfers pairs it, and absorbing one would overwrite a real
  // transaction with an unrelated CSV row.
  const openMirrors = await db
    .select({ id: transactions.id, date: transactions.date, amount: transactions.amount })
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, accountId),
        eq(transactions.userId, ownerId),
        eq(transactions.type, "internal_transfer"),
        eq(transactions.isMirror, true),
        isNotNull(transactions.linkedTransactionId),
      ),
    );

  const targetAccountIds = [
    ...new Set(
      uniqueTxList
        .filter((tx) => tx.type === "internal_transfer" && tx.targetAccountId)
        .map((tx) => tx.targetAccountId!),
    ),
  ];
  // Only the window the import covers (plus the pairing slack) — a target
  // account can hold years of rows that could never match these.
  const importDates = uniqueTxList.map((tx) => tx.date).sort();
  const targetRows = targetAccountIds.length
    ? await db
        .select({
          id: transactions.id,
          accountId: transactions.accountId,
          date: transactions.date,
          amount: transactions.amount,
          userId: transactions.userId,
        })
        .from(transactions)
        .where(
          and(
            inArray(transactions.accountId, targetAccountIds),
            eq(transactions.userId, ownerId),
            isNull(transactions.parentTransactionId),
            // Plain rows only: one already typed a transfer has its own pair,
            // and a dismissed one is a decision the user made by hand.
            inArray(transactions.type, ["income", "expense"]),
            eq(transactions.transferDismissed, false),
            gte(transactions.date, shiftDays(importDates[0], -TRANSFER_WINDOW_DAYS)),
            lte(transactions.date, shiftDays(importDates[importDates.length - 1], TRANSFER_WINDOW_DAYS)),
          ),
        )
    : [];
  // Consumed as they are claimed, so two identical transfers in one import
  // can't both absorb the same mirror or pair with the same far row.
  const freeMirrors = [...openMirrors];
  const freeTargetRows = [...targetRows];
  /** Mirrors this import fills in with the real bank row instead of duplicating. */
  const absorbed: Array<{ id: string; tx: CommitTransaction }> = [];
  /** Far rows that already existed and now become this transfer's other leg. */
  const pairedExisting: Array<{ id: string; userId: string; sourceId: string }> = [];

  // Kept in the OWNER's import history regardless of who's importing; the
  // audit log records the actor.
  const batchId = crypto.randomUUID();

  // Only allow pot assignments to pots the owner actually owns
  const ownerPots = await db
    .select({ id: transactionGroups.id })
    .from(transactionGroups)
    .where(eq(transactionGroups.userId, ownerId));
  const ownerPotIds = new Set(ownerPots.map((p) => p.id));

  // Pre-fetch active rules so we can detect, per row, whether an incoming
  // categoryId is the result of a rule match (auto) or a user override during
  // review. Overrides must be marked 'manual' so Recalculate All preserves them.
  // A transfer bucket on a row the account policy rules out survived the
  // re-filing above, so it can only be the user's own pick.
  const sourceForReviewedTx = (
    name: string | null,
    description: string,
    categoryId: string | null,
    counterpartyIban: string | null | undefined,
  ): "manual" | "rule" | null => {
    if (!categoryId) return null;
    if (
      transferCategories.has(categoryId) &&
      transferRuledOut(account, counterpartyIban, sharedIbans)
    ) {
      return "manual";
    }
    for (const rule of activeRules) {
      const matchTarget = ruleMatchTarget(name, description, rule.matchField);
      if (matchesRule(matchTarget, rule.pattern, rule.matchType) && rule.categoryId === categoryId) {
        return "rule";
      }
    }
    return "manual";
  };

  // Build transaction records, creating mirror transactions for internal transfers
  const records: Array<{
    id: string;
    userId: string;
    accountId: string;
    date: string;
    name: string | null;
    description: string;
    amount: number;
    balance: number | null;
    categoryId: string | null;
    categorySource: "manual" | "rule" | null;
    subLineId?: string | null;
    type: "income" | "expense" | "internal_transfer" | "reimbursement";
    groupId: string | null;
    linkedTransactionId: string | null;
    recurringTransactionId: string | null;
    notes: string | null;
    createdBy: string;
    isManual: boolean;
    isMirror?: boolean;
    importBatchId: string | null;
    counterpartyIban: string | null;
    externalId?: string | null;
    createdAt: string;
    isSplitParent?: boolean;
    parentTransactionId?: string | null;
  }> = [];

  const mirrorRecords: typeof records = [];
  // Split children, inserted after every parent so the parent row a
  // parentTransactionId points at always exists first.
  const childRecords: typeof records = [];
  // Reimbursement rows link to an expense chosen during review: either an
  // existing DB expense (expenseId) or another row in this same import
  // (expenseTempId, resolved to its new id after the map is fully built).
  const pendingReimbursements: Array<{
    reimbursementId: string;
    expenseId: string | null;
    expenseTempId: string | null;
  }> = [];
  // tempId → the id we assign the row on insert, for resolving sibling links.
  const tempIdToSourceId = new Map<string, string>();

  for (const tx of uniqueTxList) {
    const sourceId = crypto.randomUUID();
    tempIdToSourceId.set(tx.tempId, sourceId);
    const note = sanitizeNote(tx.notes);
    const isTransfer = tx.type === "internal_transfer" && tx.targetAccountId;

    // This account's own export finally delivering a payment another account's
    // import already mirrored here. Fill the mirror in with the real bank row
    // — balance included, so the running-balance chain reconciles — rather
    // than insert a second row for the same money.
    //
    // Deliberately NOT limited to rows the preview typed as transfers: an
    // export without a counterparty-IBAN column (Revolut has none) delivers
    // this leg as plain income, and that is exactly the case that used to
    // double-count. The mirror keeps its type, link and category — it is the
    // correct row; the CSV only supplies better provenance.
    const mirrorIndex = tx.splits?.length
      ? -1
      : freeMirrors.findIndex(
          (m) => sameAmount(m.amount, tx.amount) && withinTransferWindow(m.date, tx.date),
        );
    if (mirrorIndex >= 0) {
      const [mirror] = freeMirrors.splice(mirrorIndex, 1);
      tempIdToSourceId.set(tx.tempId, mirror.id);
      absorbed.push({ id: mirror.id, tx });
      continue;
    }

    if (isTransfer) {
      const mirrorId = crypto.randomUUID();
      const transferCatId = transferCategory?.id || tx.categoryId;

      // The target account may already hold this leg from its own import. If
      // it does, pair with that row instead of minting a mirror beside it.
      const existingIndex = freeTargetRows.findIndex(
        (r) =>
          r.accountId === tx.targetAccountId &&
          sameAmount(r.amount, -tx.amount) &&
          withinTransferWindow(r.date, tx.date),
      );
      const existingLeg = existingIndex >= 0 ? freeTargetRows.splice(existingIndex, 1)[0] : null;
      if (existingLeg) {
        pairedExisting.push({ id: existingLeg.id, userId: existingLeg.userId, sourceId });
      }

      // Source transaction (in the importing account)
      records.push({
        id: sourceId,
        userId: ownerId,
        accountId,
        date: tx.date,
        name: tx.name,
        description: tx.description,
        amount: tx.amount,
        balance: tx.balance,
        categoryId: transferCatId,
        categorySource: transferCatId ? "rule" : null,
        type: "internal_transfer",
        groupId: null,
        linkedTransactionId: existingLeg ? existingLeg.id : mirrorId,
        recurringTransactionId: null,
        notes: note,
        createdBy: userId,
        isManual: false,
        importBatchId: batchId,
        counterpartyIban: tx.counterpartyIban ?? null,
        externalId: tx.externalId ?? null,
        createdAt: new Date().toISOString(),
      });
      // Mirror transaction (in the target account) — skipped entirely when
      // `existingLeg` already is that row.
      if (!existingLeg) {
        mirrorRecords.push({
          id: mirrorId,
          userId: ownerId,
          accountId: tx.targetAccountId!,
          date: tx.date,
          name: tx.name,
          description: tx.description,
          amount: -tx.amount,
          balance: null,
          categoryId: transferCatId,
          categorySource: transferCatId ? "rule" : null,
          type: "internal_transfer",
          groupId: null,
          linkedTransactionId: sourceId,
          recurringTransactionId: null,
          notes: note,
          createdBy: userId,
          isManual: true,
          isMirror: true,
          importBatchId: null,
          // The mirror's counterparty is the account being imported, so the
          // detector can verify the pair from either side later.
          counterpartyIban: normalizeIban(importedAccountIban),
          createdAt: new Date().toISOString(),
        });
      }
    } else {
      const txType = (
        ["income", "expense", "internal_transfer", "reimbursement"] as const
      ).find((t) => t === tx.type) ?? "expense";
      // A split row becomes a pure wrapper (no category of its own) with its
      // parts inserted as children — the same shape applySplit produces.
      const splits = tx.splits?.length ? tx.splits : null;
      const recurringId =
        (txType === "income" || txType === "expense") && tx.recurringTransactionId
          ? tx.recurringTransactionId
          : null;
      if (splits) {
        // "rule" only while the parts are still the rule's own proposal; the
        // review UI drops splitRuleId the moment the user edits them.
        const splitSource = tx.splitRuleId ? "rule" : "manual";
        // Stamped a millisecond apart so the parts sort back in the order
        // they were proposed — same reason as applySplit.
        const stampedAt = splitStamps(splits.length);
        for (const [partIndex, part] of splits.entries()) {
          childRecords.push({
            id: crypto.randomUUID(),
            userId: ownerId,
            accountId,
            date: tx.date,
            name: tx.name,
            description: tx.description,
            amount: part.amount,
            balance: null,
            categoryId: part.categoryId ?? null,
            categorySource: part.categoryId ? splitSource : null,
            type: txType,
            groupId: null,
            linkedTransactionId: null,
            recurringTransactionId: recurringId,
            notes: null,
            createdBy: userId,
            isManual: false,
            importBatchId: batchId,
            counterpartyIban: null,
            createdAt: stampedAt[partIndex],
            parentTransactionId: sourceId,
          });
        }
      }
      records.push({
        id: sourceId,
        userId: ownerId,
        accountId,
        date: tx.date,
        name: tx.name,
        description: tx.description,
        amount: tx.amount,
        balance: tx.balance,
        categoryId: splits ? null : tx.categoryId,
        categorySource: splits
          ? null
          : sourceForReviewedTx(tx.name, tx.description, tx.categoryId, tx.counterpartyIban),
        // A wrapper carries no category, so it carries no sub-line either.
        // ponytail: the parts don't take one — a split already answers
        // "which part of this went where". Add it if a part ever needs both.
        subLineId: splits ? null : tx.subLineId ?? null,
        isSplitParent: !!splits,
        type: txType,
        groupId: tx.groupId && ownerPotIds.has(tx.groupId) ? tx.groupId : null,
        linkedTransactionId: null,
        // Only carry the recurring link for income/expense rows; transfers
        // don't represent fixed-cost spending.
        recurringTransactionId: recurringId,
        notes: note,
        createdBy: userId,
        isManual: false,
        importBatchId: batchId,
        counterpartyIban: tx.counterpartyIban ?? null,
        externalId: tx.externalId ?? null,
        createdAt: new Date().toISOString(),
      });
      if (txType === "reimbursement" && tx.amount > 0 && (tx.reimbursesExpenseId || tx.reimbursesTempId)) {
        pendingReimbursements.push({
          reimbursementId: sourceId,
          expenseId: tx.reimbursesExpenseId ?? null,
          expenseTempId: tx.reimbursesTempId ?? null,
        });
      }
    }
  }

  // Bind the receipts uploaded during review to the rows they were dropped
  // on. Scoped to rows still unclaimed and owned by this account's owner, so
  // a client replaying someone else's ids moves nothing. A row absorbed into
  // an existing mirror maps to that mirror's id, which is the right place for
  // the file; one dropped as a duplicate has no id here and its upload stays
  // unclaimed until the collector takes it.
  const claims = uniqueTxList.flatMap((tx) => {
    const targetId = tempIdToSourceId.get(tx.tempId);
    if (!targetId || !tx.attachments?.length) return [];
    return tx.attachments
      .map((a) => a?.id)
      .filter((id): id is string => typeof id === "string")
      .map((id) => ({ id, targetId }));
  });

  // Link reimbursements to their expenses; only user-owned negative-amount
  // transactions qualify (same rules as /api/transactions/reimburse)
  // Resolve sibling (same-import) targets to the ids we just assigned; a
  // target dropped as a duplicate has no new id and is silently skipped.
  const resolvedReimbursements = pendingReimbursements
    .map((p) => ({
      reimbursementId: p.reimbursementId,
      expenseId: p.expenseId ?? (p.expenseTempId ? tempIdToSourceId.get(p.expenseTempId) ?? null : null),
    }))
    .filter((p): p is { reimbursementId: string; expenseId: string } => p.expenseId !== null);

  // ── Writes ────────────────────────────────────────────────────────────────
  // All of it in one transaction: a crash or a constraint violation halfway
  // (say the unique external id of a row a parallel sync just wrote) leaves
  // the account exactly as it was, so the import can simply be run again.
  const createdRuleIds: string[] = [];
  await db.transaction(async (tx) => {
    if (uniqueTxList.length > 0) {
      await tx.insert(importBatches).values({
        id: batchId,
        userId: ownerId,
        accountId,
        fileName: opts.batchLabel,
        source: opts.source,
        transactionCount: uniqueTxList.length,
        importedAt: new Date().toISOString(),
      });
    }

    // Batch insert all transactions (SQLite limit workaround)
    const allRecords = [...records, ...childRecords, ...mirrorRecords];
    const chunkSize = 50;
    for (let i = 0; i < allRecords.length; i += chunkSize) {
      const chunk = allRecords.slice(i, i + chunkSize);
      await tx.insert(transactions).values(chunk);
    }

    for (const claim of claims) {
      await tx
        .update(transactionAttachments)
        .set({ transactionId: claim.targetId })
        .where(
          and(
            eq(transactionAttachments.id, claim.id),
            eq(transactionAttachments.userId, ownerId),
            isNull(transactionAttachments.transactionId),
          ),
        );
    }

    // Fill each absorbed mirror in with the bank's own version of that payment.
    // The balance is the point: a mirror has none, and the running-balance
    // chain is what reconciliation and dedup both lean on.
    for (const { id, tx: row } of absorbed) {
      await tx
        .update(transactions)
        .set({
          date: row.date,
          name: row.name,
          description: row.description,
          balance: row.balance,
          notes: sanitizeNote(row.notes),
          counterpartyIban: row.counterpartyIban ?? null,
          externalId: row.externalId ?? null,
          importBatchId: batchId,
          isManual: false,
          // No longer a stand-in for a row that hadn't arrived: this IS the
          // bank's row now, balance and all.
          isMirror: false,
          modifiedBy: userId,
        })
        .where(and(eq(transactions.id, id), eq(transactions.userId, ownerId)));
    }

    // Far legs that already existed become this transfer's other half, in place
    // of the mirror that would otherwise have duplicated them.
    for (const leg of pairedExisting) {
      await tx
        .update(transactions)
        .set({
          type: "internal_transfer",
          ...(transferCategory ? { categoryId: transferCategory.id, categorySource: "rule" as const } : {}),
          linkedTransactionId: leg.sourceId,
          modifiedBy: userId,
        })
        .where(and(eq(transactions.id, leg.id), eq(transactions.userId, leg.userId)));
    }

    if (resolvedReimbursements.length > 0) {
      const validExpenses = await tx
        .select({ id: transactions.id })
        .from(transactions)
        .where(
          and(
            inArray(transactions.id, resolvedReimbursements.map((p) => p.expenseId)),
            eq(transactions.userId, ownerId),
            lt(transactions.amount, 0)
          )
        );
      const validExpenseIds = new Set(validExpenses.map((e) => e.id));
      const linkRows = resolvedReimbursements
        .filter((p) => validExpenseIds.has(p.expenseId))
        .map((p) => ({
          id: crypto.randomUUID(),
          reimbursementId: p.reimbursementId,
          expenseId: p.expenseId,
          createdAt: new Date().toISOString(),
        }));
      if (linkRows.length > 0) {
        await tx.insert(reimbursementLinks).values(linkRows).onConflictDoNothing();
      }
    }

    for (const rule of cleanRules) {
      const ruleId = crypto.randomUUID();
      await tx.insert(categoryRules).values({
        id: ruleId,
        userId: ownerId,
        pattern: rule.pattern,
        categoryId: rule.categoryId,
        matchType: rule.matchType || "contains",
        matchField: rule.matchField || "both",
        isActive: true,
        createdAt: new Date().toISOString(),
      });
      createdRuleIds.push(ruleId);
    }

    await opts.afterWrite?.(tx, { batchId, imported: records.length });
  });

  // Apply new rules to existing uncategorized transactions in the DB (not the
  // ones we just imported — those already have categories from the review).
  // After the commit: these only touch rows outside the import, and each one
  // is as safe to repeat as the rule itself.
  let existingUpdated = 0;
  for (const rule of cleanRules) {
    existingUpdated += await applyRuleToTransactions({
      pattern: rule.pattern,
      categoryId: rule.categoryId,
      matchType: rule.matchType || "contains",
      matchField: rule.matchField || "both",
      userId: ownerId,
      transferCategoryIds: transferCategories,
    });
  }

  // Auto-detect internal transfers among all transactions. Run as the
  // IMPORTER, not the owner: their writable scope spans their own accounts
  // plus this shared one, so a move between the two gets paired. Pairs that
  // need an owner account the importer can't see are left to the owner's own
  // run — we don't reach into accounts the actor can't access.
  const transferResult = await detectTransfers(db, userId);

  return {
    ok: true,
    imported: records.length,
    duplicatesSkipped: duplicates.length,
    mirrorsAbsorbed: absorbed.length,
    mirrorTransactions: mirrorRecords.length,
    batchId,
    rulesCreated: createdRuleIds.length,
    existingUpdated,
    transfersDetected: transferResult.matchedPairs,
  };
}
