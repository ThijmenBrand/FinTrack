import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, accounts, categories } from "@/db/schema";
import { eq, desc, asc, and, gte, lte, like, or, sql } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { logDataEvent } from "@/lib/audit";

const VALID_TX_TYPES = ["income", "expense", "internal_transfer", "reimbursement", "reserved"] as const;
type TxType = (typeof VALID_TX_TYPES)[number];

// GET /api/transactions — list transactions with filtering, sorting, pagination
export async function GET(request: NextRequest) {
  return withUser(async (userId) => {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number(searchParams.get("page")) || 1);
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 25));
    const sortBy = searchParams.get("sortBy") || "date";
    const sortOrder = searchParams.get("sortOrder") || "desc";
    const accountId = searchParams.get("accountId");
    const type = searchParams.get("type");
    const search = searchParams.get("search");
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const categoryId = searchParams.get("categoryId");
    const uncategorized = searchParams.get("uncategorized");
    const reimbursesExpenseId = searchParams.get("reimbursesExpenseId");
    const nearDate = searchParams.get("nearDate");
    const nearAmountRaw = searchParams.get("nearAmount");
    const nearAmount = nearAmountRaw ? Number(nearAmountRaw) : null;

    // Build conditions — always filter by userId
    const conditions = [eq(transactions.userId, userId)];
    if (accountId) conditions.push(eq(transactions.accountId, accountId));
    if (reimbursesExpenseId) {
      conditions.push(sql`${transactions.id} IN (
        SELECT rl.reimbursement_id FROM reimbursement_links rl WHERE rl.expense_id = ${reimbursesExpenseId}
      )`);
    }
    if (type) {
      if (!VALID_TX_TYPES.includes(type as TxType)) {
        return NextResponse.json({ error: "Invalid type" }, { status: 400 });
      }
      conditions.push(eq(transactions.type, type as TxType));
    }
    if (search) {
      const searchPattern = `%${search}%`;
      conditions.push(
        or(
          like(transactions.description, searchPattern),
          like(transactions.name, searchPattern)
        )!
      );
    }
    if (dateFrom) conditions.push(gte(transactions.date, dateFrom));
    if (dateTo) conditions.push(lte(transactions.date, dateTo));
    if (uncategorized === "true") {
      conditions.push(sql`${transactions.categoryId} IS NULL`);
    } else if (categoryId) {
      conditions.push(eq(transactions.categoryId, categoryId));
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
        categoryName: categories.name,
        categoryColor: categories.color,
        categoryIcon: categories.icon,
        type: transactions.type,
        linkedTransactionId: transactions.linkedTransactionId,
        linkedAccountName: sql<string | null>`(
          SELECT a.name FROM transactions lt
          JOIN accounts a ON lt.account_id = a.id AND a.user_id = "transactions"."user_id"
          WHERE lt.id = ${transactions.linkedTransactionId}
        )`,
        reimbursesTransactionId: transactions.reimbursesTransactionId,
        reimbursesDescription: sql<string | null>`(
          SELECT GROUP_CONCAT(t2.description, ', ') FROM reimbursement_links rl2
          JOIN transactions t2 ON t2.id = rl2.expense_id AND t2.user_id = "transactions"."user_id"
          WHERE rl2.reimbursement_id = ${transactions.id}
        )`,
        effectiveAmount: sql<number>`(
          ${transactions.amount} + COALESCE(
            (SELECT SUM(r.amount) FROM reimbursement_links rl
             JOIN transactions r ON r.id = rl.reimbursement_id AND r.user_id = "transactions"."user_id"
             WHERE rl.expense_id = ${transactions.id}),
            0
          )
        )`,
        reimbursementCount: sql<number>`(
          SELECT COUNT(*) FROM reimbursement_links rl WHERE rl.expense_id = ${transactions.id}
        )`,
        reimbursedTotal: sql<number>`COALESCE(
          (SELECT SUM(r.amount) FROM reimbursement_links rl
           JOIN transactions r ON r.id = rl.reimbursement_id
           WHERE rl.expense_id = ${transactions.id}),
          0
        )`,
        groupId: transactions.groupId,
        groupName: sql<string | null>`(
          SELECT g.name FROM transaction_groups g WHERE g.id = ${transactions.groupId}
        )`,
        recurringTransactionId: transactions.recurringTransactionId,
        recurringDescription: sql<string | null>`(
          SELECT r.description FROM recurring_transactions r
          WHERE r.id = ${transactions.recurringTransactionId} AND r.user_id = "transactions"."user_id"
        )`,
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
      .where(eq(transactions.userId, userId));

    // Get sum totals for the filtered results
    const sumResult = await db
      .select({
        totalIncome: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'income' THEN ${transactions.amount} ELSE 0 END), 0)`,
        totalExpense: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'expense' THEN ${transactions.amount} ELSE 0 END), 0)`,
        totalTransfers: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'internal_transfer' THEN ${transactions.amount} ELSE 0 END), 0)`,
        totalReimbursements: sql<number>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'reimbursement' THEN ${transactions.amount} ELSE 0 END), 0)`,
        netTotal: sql<number>`COALESCE(SUM(${transactions.amount}), 0)`,
      })
      .from(transactions)
      .where(whereClause);

    return NextResponse.json({
      data: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      distinctTypes: distinctTypes.map((r) => r.type),
      totals: {
        income: sumResult[0]?.totalIncome || 0,
        expense: sumResult[0]?.totalExpense || 0,
        transfers: sumResult[0]?.totalTransfers || 0,
        reimbursements: sumResult[0]?.totalReimbursements || 0,
        net: sumResult[0]?.netTotal || 0,
      },
    });
  }, "Failed to fetch transactions");
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

    // Check for linked transfer transaction
    const [tx] = await db
      .select({ linkedTransactionId: transactions.linkedTransactionId })
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.userId, userId)));

    if (tx?.linkedTransactionId) {
      const [linkedTx] = await db
        .select({ id: transactions.id, isManual: transactions.isManual })
        .from(transactions)
        .where(and(eq(transactions.id, tx.linkedTransactionId), eq(transactions.userId, userId)));

      if (linkedTx) {
        if (linkedTx.isManual) {
          // Mirror was auto-created, delete it
          await db.delete(transactions).where(and(eq(transactions.id, linkedTx.id), eq(transactions.userId, userId)));
        } else {
          // Linked tx came from CSV, revert it to normal
          const [linkedFull] = await db
            .select({ amount: transactions.amount })
            .from(transactions)
            .where(and(eq(transactions.id, linkedTx.id), eq(transactions.userId, userId)));
          await db
            .update(transactions)
            .set({
              type: (linkedFull?.amount ?? 0) >= 0 ? "income" : "expense",
              linkedTransactionId: null,
              categoryId: null,
              categorySource: null,
            })
            .where(and(eq(transactions.id, linkedTx.id), eq(transactions.userId, userId)));
        }
      }
    }

    await db.delete(transactions).where(and(eq(transactions.id, id), eq(transactions.userId, userId)));

    logDataEvent({ userId, action: "transaction_delete", targetId: id, targetType: "transaction" });

    return NextResponse.json({ success: true });
  }, "Failed to delete transaction");
}
