import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
import { db } from "@/db";
import { transactions, accounts, categories } from "@/db/schema";
import { eq, desc, asc, and, gte, lte, like, or, sql, inArray, notInArray, isNull, isNotNull } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { logDataEvent } from "@/lib/audit";
import { parseSearchTerm } from "@/lib/search-query";
import { effectiveExpenseAmount } from "@/lib/reimbursement-sql";
import { requireAccountAccess, visibleTransactions } from "@/lib/account-access";
import { isFiniteNumber, isIsoDate, sanitizeNote } from "@/lib/validation";

const VALID_TX_TYPES = ["income", "expense", "internal_transfer", "reimbursement"] as const;
type TxType = (typeof VALID_TX_TYPES)[number];
// A manual entry is a plain income/expense row — transfers and reimbursements
// are created through their own dedicated flows (CSV transfer detection,
// /api/transactions/reimburse) that keep a linked counterpart in sync.
const MANUAL_TX_TYPES = ["income", "expense"] as const;
type ManualTxType = (typeof MANUAL_TX_TYPES)[number];

// GET /api/transactions — list transactions with filtering, sorting, pagination
export async function GET(request: NextRequest) {
  return withUser(async (userId) => {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number(searchParams.get("page")) || 1);
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 25));
    const sortBy = searchParams.get("sortBy") || "date";
    const sortOrder = searchParams.get("sortOrder") || "desc";
    // accountId may be a comma-separated list (the dashboard links to its whole
    // account scope, not a single account).
    const accountIds = searchParams.get("accountId")?.split(",").filter(Boolean) ?? [];
    const groupId = searchParams.get("groupId");
    const types = searchParams.getAll("type").filter(Boolean);
    const search = searchParams.get("search");
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const categoryIds = searchParams.getAll("categoryId").filter(Boolean);
    const excludeCategoryIds = searchParams.getAll("excludeCategory").filter(Boolean);
    const excludeTypes = searchParams.getAll("excludeType").filter(Boolean);
    const uncategorized = searchParams.get("uncategorized");
    const reimbursesExpenseId = searchParams.get("reimbursesExpenseId");
    const nearDate = searchParams.get("nearDate");
    const nearAmountRaw = searchParams.get("nearAmount");
    const nearAmount = nearAmountRaw ? Number(nearAmountRaw) : null;

    // Account/date scope, shared by the list filters and the pot-net totals
    // below. Kept separate from the row-level filters (type, category, search)
    // because a pot's contribution is a NET: summing it over only the rows a
    // type filter keeps strips the income/reimbursement legs and reports gross
    // spend instead.
    // Own rows plus rows on accounts shared with the caller. An accountId
    // filter naming an inaccessible account just intersects to nothing.
    const scopeConditions = [visibleTransactions(userId)];
    if (accountIds.length) scopeConditions.push(inArray(transactions.accountId, accountIds));
    if (groupId) scopeConditions.push(eq(transactions.groupId, groupId));
    if (dateFrom) scopeConditions.push(gte(transactions.date, dateFrom));
    if (dateTo) scopeConditions.push(lte(transactions.date, dateTo));

    // Build conditions — always filter by userId
    const conditions = [...scopeConditions];
    if (reimbursesExpenseId) {
      conditions.push(sql`${transactions.id} IN (
        SELECT rl.reimbursement_id FROM reimbursement_links rl
        JOIN transactions e ON e.id = rl.expense_id AND e.user_id = "transactions"."user_id"
        WHERE rl.expense_id = ${reimbursesExpenseId}
      )`);
    }
    if (types.length) {
      if (types.some((t) => !VALID_TX_TYPES.includes(t as TxType))) {
        return apiError("api.invalidType", 400);
      }
      conditions.push(inArray(transactions.type, types as TxType[]));
    }
    if (search) {
      const parsed = parseSearchTerm(search);
      const matches = [];
      if (parsed.text) {
        const searchPattern = `%${parsed.text}%`;
        matches.push(
          like(transactions.description, searchPattern),
          like(transactions.name, searchPattern)
        );
      }
      if (parsed.amount) {
        matches.push(
          sql`ABS(${transactions.amount}) BETWEEN ${parsed.amount.min} AND ${parsed.amount.max}`
        );
      }
      if (parsed.date) {
        matches.push(like(transactions.date, `${parsed.date}%`));
      }
      if (matches.length) conditions.push(or(...matches)!);
    }
    if (uncategorized === "true") {
      conditions.push(sql`${transactions.categoryId} IS NULL`);
    } else if (categoryIds.length) {
      // A pot carries its own category, and that is the one the budgets and
      // insights pages attribute its whole net to — regardless of how the
      // member rows are categorised (usually not at all). Matching on the row
      // category alone would drop those pots here, so the same category reads
      // lower on this page than in the budget bar it links to.
      conditions.push(
        or(
          inArray(transactions.categoryId, categoryIds),
          sql`${transactions.groupId} IN (
            SELECT g.id FROM transaction_groups g
            WHERE g.user_id = "transactions"."user_id"
              AND ${inArray(sql`g.category_id`, categoryIds)}
          )`,
        )!,
      );
    }
    // Exclusions: keep uncategorized rows visible when excluding categories.
    if (excludeCategoryIds.length) {
      conditions.push(
        or(isNull(transactions.categoryId), notInArray(transactions.categoryId, excludeCategoryIds))!
      );
    }
    if (excludeTypes.length) {
      if (excludeTypes.some((t) => !VALID_TX_TYPES.includes(t as TxType))) {
        return apiError("api.invalidType", 400);
      }
      conditions.push(notInArray(transactions.type, excludeTypes as TxType[]));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Determine sort column
    const sortColumn = sortBy === "amount" ? transactions.amount
      : sortBy === "description" ? transactions.description
      : transactions.date;

    const orderFn = sortOrder === "asc" ? asc : desc;

    // When a reference date is provided, rank by "probable match": exact absolute-amount
    // matches first, then clean-division matches (e.g. 3-way split of a larger expense),
    // then by closest date. Used by the reimbursement picker.
    const absNearAmount = nearAmount !== null && Number.isFinite(nearAmount) ? Math.abs(nearAmount) : null;
    const orderBy = nearDate
      ? [
          ...(absNearAmount !== null && absNearAmount > 0
            ? [
                sql`CASE
                  WHEN ABS(ABS(${transactions.amount}) - ${absNearAmount}) < 0.01 THEN 0
                  WHEN ABS(${transactions.amount}) > ${absNearAmount}
                       AND ABS(${transactions.amount}) / ${absNearAmount} <= 20
                       AND ABS((ABS(${transactions.amount}) / ${absNearAmount}) - ROUND(ABS(${transactions.amount}) / ${absNearAmount})) < 0.02
                  THEN 1
                  ELSE 2
                END ASC`,
              ]
            : []),
          sql`ABS(julianday(${transactions.date}) - julianday(${nearDate})) ASC`,
        ]
      : [orderFn(sortColumn)];

    // Get total count
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(whereClause);
    const total = countResult[0]?.count || 0;

    // Get paginated results with joined data (including linked account name)
    const offset = (page - 1) * limit;
    const rows = await db
      .select({
        id: transactions.id,
        accountId: transactions.accountId,
        accountName: accounts.name,
        date: transactions.date,
        name: transactions.name,
        description: transactions.description,
        amount: transactions.amount,
        balance: transactions.balance,
        categoryId: transactions.categoryId,
        // Falls back to the name kept when the category was deleted.
        categoryName: sql<string | null>`COALESCE(${categories.name}, ${transactions.categoryLabel})`,
        categoryColor: categories.color,
        categoryIcon: categories.icon,
        type: transactions.type,
        linkedTransactionId: transactions.linkedTransactionId,
        // Caller-visibility, not row-owner visibility: a transfer counterpart
        // on an account the CALLER can't see must come back null ("another
        // account"), or a shared row would leak the owner's private account names.
        linkedAccountName: sql<string | null>`(
          SELECT a.name FROM transactions lt
          JOIN accounts a ON lt.account_id = a.id
          WHERE lt.id = ${transactions.linkedTransactionId}
            AND (a.user_id = ${userId} OR a.id IN (
              SELECT am.account_id FROM account_members am
              WHERE am.user_id = ${userId} AND am.accepted_at IS NOT NULL AND am.revoked_at IS NULL))
        )`,
        reimbursesTransactionId: transactions.reimbursesTransactionId,
        reimbursesDescription: sql<string | null>`(
          SELECT GROUP_CONCAT(t2.description, ', ') FROM reimbursement_links rl2
          JOIN transactions t2 ON t2.id = rl2.expense_id AND t2.user_id = "transactions"."user_id"
          WHERE rl2.reimbursement_id = ${transactions.id}
        )`,
        // Signed form of `effectiveExpenseAmount` (which returns a positive
        // magnitude) so the row shows the same reimbursement-adjusted value the
        // totals card and /api/insights sum: pro-rata across every expense a
        // reimbursement covers, floored at 0 when over-reimbursed.
        effectiveAmount: sql<number>`-(${effectiveExpenseAmount()})`,
        reimbursementCount: sql<number>`(
          SELECT COUNT(*) FROM reimbursement_links rl
          JOIN transactions r ON r.id = rl.reimbursement_id AND r.user_id = "transactions"."user_id"
          WHERE rl.expense_id = ${transactions.id}
        )`,
        // Pro-rata share too, so `amount - reimbursedTotal` reconciles with
        // `effectiveAmount` in the detail dialog.
        reimbursedTotal: sql<number>`COALESCE(
          (SELECT SUM(r.amount / (SELECT COUNT(*) FROM reimbursement_links rl2 WHERE rl2.reimbursement_id = rl.reimbursement_id))
           FROM reimbursement_links rl
           JOIN transactions r ON r.id = rl.reimbursement_id AND r.user_id = "transactions"."user_id"
           WHERE rl.expense_id = ${transactions.id}),
          0
        )`,
        groupId: transactions.groupId,
        groupName: sql<string | null>`(
          SELECT g.name FROM transaction_groups g
          WHERE g.id = ${transactions.groupId} AND g.user_id = "transactions"."user_id"
        )`,
        recurringTransactionId: transactions.recurringTransactionId,
        recurringDescription: sql<string | null>`(
          SELECT r.description FROM recurring_transactions r
          WHERE r.id = ${transactions.recurringTransactionId} AND r.user_id = "transactions"."user_id"
        )`,
        // Who touched the row — only meaningful on shared accounts. created_by
        // NULL means the account owner; resolve that to a name only when the
        // account actually has active members, so solo accounts stay quiet.
        createdByName: sql<string | null>`(CASE
          WHEN ${transactions.createdBy} IS NOT NULL
            THEN (SELECT u.name FROM "user" u WHERE u.id = ${transactions.createdBy})
          WHEN EXISTS (
            SELECT 1 FROM account_members am
            WHERE am.account_id = ${transactions.accountId}
              AND am.user_id IS NOT NULL AND am.accepted_at IS NOT NULL AND am.revoked_at IS NULL)
            THEN (SELECT u.name FROM "user" u WHERE u.id = ${transactions.userId})
          ELSE NULL END)`,
        // Same CASE as createdByName — the face for the shared-account column.
        createdByImage: sql<string | null>`(CASE
          WHEN ${transactions.createdBy} IS NOT NULL
            THEN (SELECT u.image FROM "user" u WHERE u.id = ${transactions.createdBy})
          WHEN EXISTS (
            SELECT 1 FROM account_members am
            WHERE am.account_id = ${transactions.accountId}
              AND am.user_id IS NOT NULL AND am.accepted_at IS NOT NULL AND am.revoked_at IS NULL)
            THEN (SELECT u.image FROM "user" u WHERE u.id = ${transactions.userId})
          ELSE NULL END)`,
        modifiedByName: sql<string | null>`(CASE
          WHEN ${transactions.modifiedBy} IS NOT NULL
            THEN (SELECT u.name FROM "user" u WHERE u.id = ${transactions.modifiedBy})
          ELSE NULL END)`,
        notes: transactions.notes,
        isManual: transactions.isManual,
        importBatchId: transactions.importBatchId,
        createdAt: transactions.createdAt,
      })
      .from(transactions)
      .leftJoin(accounts, eq(transactions.accountId, accounts.id))
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset);

    // Get distinct types that exist in the database
    const distinctTypes = await db
      .selectDistinct({ type: transactions.type })
      .from(transactions)
      .where(visibleTransactions(userId));

    // Sum totals for the filtered set. Pot members are NOT counted individually;
    // each pot contributes one net, split by sign: net > 0 → income, net < 0 →
    // expense. So direct sums cover ungrouped rows only, pot nets are added on
    // top. Note the pot row rendered in the list shows the pot's LIFETIME
    // figures; these totals deliberately cover the filtered range instead.
    //
    // Expenses are reimbursement-adjusted (same `effectiveExpenseAmount` the
    // rows and /api/insights use) so the card matches the struck-through amounts
    // in the table below it. Because reimbursements are already netted off the
    // expenses here, they must NOT be added to `net` again on top.
    const [directSum] = await db
      .select({
        totalIncome: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'income' THEN ${transactions.amount} ELSE 0 END), 0)`,
        totalExpense: sql<number>`-COALESCE(SUM(CASE WHEN ${transactions.type} = 'expense' THEN (
          ${effectiveExpenseAmount()}
        ) ELSE 0 END), 0)`,
        totalTransfers: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'internal_transfer' THEN ${transactions.amount} ELSE 0 END), 0)`,
        totalReimbursements: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'reimbursement' THEN ${transactions.amount} ELSE 0 END), 0)`,
      })
      .from(transactions)
      .where(and(...conditions, isNull(transactions.groupId)));

    // Which pots the current filters touch. The row-level filters decide
    // *whether* a pot counts; they must not decide *how much* it counts, or a
    // `type: expense` filter would drop the pot's refunds and overstate spend.
    const filteredPotIds = (
      await db
        .selectDistinct({ groupId: transactions.groupId })
        .from(transactions)
        .where(and(...conditions, isNotNull(transactions.groupId)))
    )
      .map((r) => r.groupId)
      .filter((id): id is string => !!id);

    // Net per pot over every member in range. Scoped to the range, not the
    // pot's whole lifetime: a pot with one member in July must not drag its
    // January spending into a July total. Mirrors /api/insights
    // `potSpendingPerPot`, including the internal-transfer exclusion — moving
    // money into a pot isn't spending it. `memberCount` vs `totalMemberCount`
    // tells the UI whether the range covers the whole pot.
    const potNetRows = filteredPotIds.length
      ? await db
          .select({
            groupId: transactions.groupId,
            net: sql<number>`COALESCE(SUM(${transactions.amount}), 0)`,
            memberCount: sql<number>`COUNT(*)`,
            // Correlated to the row's owner, not the caller: a pot on a shared
            // account belongs to the account owner. Every row in a group shares
            // one pot (hence one owner), so the bare column is deterministic.
            totalMemberCount: sql<number>`(
              SELECT COUNT(*) FROM transactions t2
              WHERE t2.group_id = ${transactions.groupId}
                AND t2.user_id = "transactions"."user_id"
                AND t2.type != 'internal_transfer'
            )`,
          })
          .from(transactions)
          .where(
            and(
              ...scopeConditions,
              inArray(transactions.groupId, filteredPotIds),
              sql`${transactions.type} != 'internal_transfer'`
            )
          )
          .groupBy(transactions.groupId)
      : [];

    // A pot contributes one net, on the side its sign puts it. With a `type`
    // filter active, only count the side the user asked for — otherwise
    // filtering on income reports a pot's net *spend* under Expenses.
    const wantIncome = !types.length || types.some((t) => t === "income" || t === "reimbursement");
    const wantExpense = !types.length || types.includes("expense");

    let income = directSum?.totalIncome || 0;
    let expense = directSum?.totalExpense || 0;
    const transfers = directSum?.totalTransfers || 0;
    for (const { net: potNet } of potNetRows) {
      if (potNet > 0 && wantIncome) income += potNet;
      else if (potNet < 0 && wantExpense) expense += potNet;
    }
    const net = income + expense + transfers;

    return NextResponse.json({
      data: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      distinctTypes: distinctTypes.map((r) => r.type),
      // Per-pot figures for the filtered range, so the pot row can show what
      // the pot did *in this period* instead of its lifetime net.
      potTotals: potNetRows.map((r) => ({
        groupId: r.groupId!,
        net: r.net,
        memberCount: r.memberCount,
        totalMemberCount: r.totalMemberCount,
        isPartial: r.memberCount < r.totalMemberCount,
      })),
      totals: {
        income,
        expense,
        transfers,
        reimbursements: directSum?.totalReimbursements || 0,
        net,
      },
    });
  }, "Failed to fetch transactions");
}

// POST /api/transactions — manually create a single income/expense transaction
export async function POST(request: NextRequest) {
  return withUser(async (userId) => {
    const body = await request.json();
    const { accountId, date, name, description, amount, type, categoryId, notes } = body;

    if (typeof accountId !== "string" || !accountId) {
      return NextResponse.json({ error: "accountId is required" }, { status: 400 });
    }
    if (!isIsoDate(date)) {
      return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
    }
    if (typeof description !== "string" || !description.trim()) {
      return NextResponse.json({ error: "description is required" }, { status: 400 });
    }
    if (!isFiniteNumber(amount)) {
      return NextResponse.json({ error: "amount must be a finite number" }, { status: 400 });
    }
    if (!MANUAL_TX_TYPES.includes(type as ManualTxType)) {
      return NextResponse.json(
        { error: `type must be one of: ${MANUAL_TX_TYPES.join(", ")}` },
        { status: 400 },
      );
    }
    if (name != null && typeof name !== "string") {
      return NextResponse.json({ error: "name must be a string" }, { status: 400 });
    }

    // Write access to the account — 404 if the caller can't see it at all,
    // 403 if they can see it but are a viewer.
    const access = await requireAccountAccess(userId, accountId, "write");
    const ownerId = access.account.userId;

    // Category references on a shared account live in the OWNER's category
    // space — the acting member's own categoryIds are invalid there.
    let validCategoryId: string | null = null;
    if (categoryId != null) {
      if (typeof categoryId !== "string") {
        return NextResponse.json({ error: "categoryId must be a string" }, { status: 400 });
      }
      const [owned] = await db
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.id, categoryId), eq(categories.userId, ownerId)))
        .limit(1);
      if (!owned) {
        return apiError("api.categoryNotFound", 404);
      }
      validCategoryId = categoryId;
    }

    const id = crypto.randomUUID();
    await db.insert(transactions).values({
      id,
      // Data rows on a shared account always keep the OWNER's user_id;
      // attribution goes in createdBy/modifiedBy.
      userId: ownerId,
      accountId,
      date,
      name: name || null,
      description: description.trim(),
      amount,
      balance: null,
      categoryId: validCategoryId,
      categorySource: validCategoryId ? "manual" : null,
      type: type as ManualTxType,
      linkedTransactionId: null,
      notes: sanitizeNote(notes),
      createdBy: userId,
      isManual: true,
      importBatchId: null,
      createdAt: new Date().toISOString(),
    });

    logDataEvent({
      userId,
      action: "transaction_create",
      targetId: id,
      targetType: "transaction",
      details: {
        accountId,
        amount,
        type,
        ...(ownerId !== userId ? { accountOwnerId: ownerId } : {}),
      },
    });

    const [created] = await db.select().from(transactions).where(eq(transactions.id, id));
    return NextResponse.json(created, { status: 201 });
  }, "Failed to create transaction");
}

// DELETE /api/transactions — delete a transaction
export async function DELETE(request: NextRequest) {
  return withUser(async (userId) => {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Transaction ID is required" },
        { status: 400 }
      );
    }

    // Row lookup is unscoped by caller — the write-access check below (via
    // the row's account) decides who may delete it, not row ownership.
    const [tx] = await db
      .select({ accountId: transactions.accountId, linkedTransactionId: transactions.linkedTransactionId, userId: transactions.userId })
      .from(transactions)
      .where(eq(transactions.id, id));
    if (!tx) {
      return apiError("api.transactionNotFound", 404);
    }
    const access = await requireAccountAccess(userId, tx.accountId, "write");
    const ownerId = access.account.userId;

    if (tx.linkedTransactionId) {
      // Scoped by the counterpart's OWN user_id, not this row's owner: transfer
      // detection pairs a private account with a shared one, so the two legs can
      // belong to different users. Leaving the far leg linked to a deleted row
      // would keep it typed internal_transfer forever.
      const [linkedTx] = await db
        .select({
          id: transactions.id,
          isManual: transactions.isManual,
          amount: transactions.amount,
          userId: transactions.userId,
        })
        .from(transactions)
        .where(eq(transactions.id, tx.linkedTransactionId));

      if (linkedTx) {
        if (linkedTx.isManual) {
          // Mirror was auto-created, delete it
          await db.delete(transactions).where(and(eq(transactions.id, linkedTx.id), eq(transactions.userId, linkedTx.userId)));
        } else {
          // Linked tx came from CSV, revert it to normal
          await db
            .update(transactions)
            .set({
              type: linkedTx.amount >= 0 ? "income" : "expense",
              linkedTransactionId: null,
              categoryId: null,
              categorySource: null,
              modifiedBy: userId,
            })
            .where(and(eq(transactions.id, linkedTx.id), eq(transactions.userId, linkedTx.userId)));
        }
      }
    }

    await db.delete(transactions).where(and(eq(transactions.id, id), eq(transactions.userId, ownerId)));

    logDataEvent({
      userId,
      action: "transaction_delete",
      targetId: id,
      targetType: "transaction",
      details: ownerId !== userId ? { accountOwnerId: ownerId } : undefined,
    });

    return NextResponse.json({ success: true });
  }, "Failed to delete transaction");
}
