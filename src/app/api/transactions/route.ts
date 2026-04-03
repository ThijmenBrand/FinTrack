import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, accounts, categories } from "@/db/schema";
import { eq, desc, asc, and, gte, lte, like, sql } from "drizzle-orm";

// GET /api/transactions — list transactions with filtering, sorting, pagination
export async function GET(request: NextRequest) {
  try {
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

    // Build conditions
    const conditions = [];
    if (accountId) conditions.push(eq(transactions.accountId, accountId));
    if (type) conditions.push(eq(transactions.type, type as "income" | "expense" | "internal_transfer"));
    if (search) conditions.push(like(transactions.description, `%${search}%`));
    if (dateFrom) conditions.push(gte(transactions.date, dateFrom));
    if (dateTo) conditions.push(lte(transactions.date, dateTo));

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

    // Get paginated results with joined data
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
        type: transactions.type,
        linkedTransactionId: transactions.linkedTransactionId,
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

    return NextResponse.json({
      data: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
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
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Transaction ID is required" },
        { status: 400 }
      );
    }

    await db.delete(transactions).where(eq(transactions.id, id));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete transaction:", error);
    return NextResponse.json(
      { error: "Failed to delete transaction" },
      { status: 500 }
    );
  }
}
