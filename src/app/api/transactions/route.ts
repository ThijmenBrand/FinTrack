import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, accounts, categories } from "@/db/schema";
import { eq, desc, asc, and, gte, lte, like, sql } from "drizzle-orm";
import { getUserId } from "@/lib/auth";

// GET /api/transactions — list transactions with filtering, sorting, pagination
export async function GET(request: NextRequest) {
  try {
    const userId = await getUserId();
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

    // Build conditions — always filter by userId
    const conditions = [eq(transactions.userId, userId)];
    if (accountId) conditions.push(eq(transactions.accountId, accountId));
    if (reimbursesExpenseId) {
      conditions.push(sql`${transactions.id} IN (
        SELECT rl.reimbursement_id FROM reimbursement_links rl WHERE rl.expense_id = ${reimbursesExpenseId}
      )`);
    }
    if (type) conditions.push(eq(transactions.type, type as "income" | "expense" | "internal_transfer" | "reimbursement"));
    if (search) conditions.push(like(transactions.description, `%${search}%`));
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
          JOIN accounts a ON lt.account_id = a.id
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
        notes: transactions.notes,
        isManual: transactions.isManual,
        importBatchId: transactions.importBatchId,
        createdAt: transactions.createdAt,
      })
      .from(transactions)
      .leftJoin(accounts, eq(transactions.accountId, accounts.id))
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .where(whereClause)
      .orderBy(orderFn(sortColumn))
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
  } catch (error) {
    console.error("Failed to fetch transactions:", error);
    return NextResponse.json(
      { error: "Failed to fetch transactions" },
      { status: 500 }
    );
  }
}

// DELETE /api/transactions — delete a transaction
export async function DELETE(request: NextRequest) {
  try {
    const userId = await getUserId();
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
            })
            .where(and(eq(transactions.id, linkedTx.id), eq(transactions.userId, userId)));
        }
      }
    }

    await db.delete(transactions).where(and(eq(transactions.id, id), eq(transactions.userId, userId)));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete transaction:", error);
    return NextResponse.json(
      { error: "Failed to delete transaction" },
      { status: 500 }
    );
  }
}
