import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accounts, transactions } from "@/db/schema";
import { eq, sum, asc, count, and } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { logDataEvent } from "@/lib/audit";
import { isFiniteNumber } from "@/lib/validation";

const ACCOUNT_TYPES = ["checking", "savings", "joint", "credit", "other"] as const;
type AccountType = (typeof ACCOUNT_TYPES)[number];

function isAccountType(v: unknown): v is AccountType {
  return typeof v === "string" && (ACCOUNT_TYPES as readonly string[]).includes(v);
}

// GET /api/accounts — list all accounts with computed balances
export async function GET() {
  return withUser(async (userId) => {
    const allAccounts = await db.select().from(accounts).where(eq(accounts.userId, userId)).orderBy(asc(accounts.sortOrder), asc(accounts.createdAt));

    // One grouped query for all account balances instead of one per account.
    const balanceRows = await db
      .select({ accountId: transactions.accountId, total: sum(transactions.amount) })
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .groupBy(transactions.accountId);
    const balanceByAccount = new Map(
      balanceRows.map((r) => [r.accountId, Number(r.total) || 0])
    );

    const accountsWithBalances = allAccounts.map((account) => {
      const txTotal = balanceByAccount.get(account.id) || 0;
      return {
        ...account,
        currentBalance: account.initialBalance + txTotal,
        transactionTotal: txTotal,
      };
    });

    return NextResponse.json(accountsWithBalances);
  }, "Failed to fetch accounts");
}

// POST /api/accounts — create a new account
export async function POST(request: NextRequest) {
  return withUser(async (userId) => {
    const body = await request.json();
    const { name, type, bankName, iban, currency, initialBalance } = body;

    if (!name || typeof name !== "string" || !isAccountType(type)) {
      return NextResponse.json(
        { error: "Name and a valid type are required" },
        { status: 400 }
      );
    }
    if (initialBalance !== undefined && !isFiniteNumber(initialBalance)) {
      return NextResponse.json(
        { error: "initialBalance must be a finite number" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    // Get the next sort order
    const [{ total }] = await db.select({ total: count() }).from(accounts).where(eq(accounts.userId, userId));

    await db.insert(accounts).values({
      id,
      userId,
      name,
      type,
      bankName: bankName || null,
      iban: iban || null,
      currency: currency || "EUR",
      initialBalance: initialBalance ?? 0,
      sortOrder: total,
      createdAt: now,
      updatedAt: now,
    });

    const [newAccount] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, id));

    logDataEvent({ userId, action: "account_create", targetId: id, targetType: "account", details: { name, type } });

    return NextResponse.json(newAccount, { status: 201 });
  }, "Failed to create account");
}

// PUT /api/accounts — update an account
export async function PUT(request: NextRequest) {
  return withUser(async (userId) => {
    const body = await request.json();
    const { id, name, type, bankName, iban, currency, initialBalance } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Account ID is required" },
        { status: 400 }
      );
    }
    if (type !== undefined && !isAccountType(type)) {
      return NextResponse.json({ error: "Invalid account type" }, { status: 400 });
    }
    if (initialBalance !== undefined && !isFiniteNumber(initialBalance)) {
      return NextResponse.json(
        { error: "initialBalance must be a finite number" },
        { status: 400 }
      );
    }

    // Only set fields the client actually sent — a partial update must not
    // clobber iban/initialBalance/etc. with defaults.
    const updates: Partial<typeof accounts.$inferInsert> = {
      updatedAt: new Date().toISOString(),
    };
    if (name !== undefined) updates.name = name;
    if (type !== undefined) updates.type = type;
    if (bankName !== undefined) updates.bankName = bankName || null;
    if (iban !== undefined) updates.iban = iban || null;
    if (currency !== undefined) updates.currency = currency;
    if (initialBalance !== undefined) updates.initialBalance = initialBalance;

    await db
      .update(accounts)
      .set(updates)
      .where(and(eq(accounts.id, id), eq(accounts.userId, userId)));

    const [updated] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, id), eq(accounts.userId, userId)));

    logDataEvent({ userId, action: "account_update", targetId: id, targetType: "account", details: { name, type } });

    return NextResponse.json(updated);
  }, "Failed to update account");
}

// PATCH /api/accounts — reorder accounts
export async function PATCH(request: NextRequest) {
  return withUser(async (userId) => {
    const body = await request.json();
    const { orderedIds } = body as { orderedIds: string[] };

    if (!orderedIds || !Array.isArray(orderedIds)) {
      return NextResponse.json(
        { error: "orderedIds array is required" },
        { status: 400 }
      );
    }

    for (let i = 0; i < orderedIds.length; i++) {
      await db
        .update(accounts)
        .set({ sortOrder: i, updatedAt: new Date().toISOString() })
        .where(and(eq(accounts.id, orderedIds[i]), eq(accounts.userId, userId)));
    }

    return NextResponse.json({ success: true });
  }, "Failed to reorder accounts");
}

// DELETE /api/accounts — delete an account
export async function DELETE(request: NextRequest) {
  return withUser(async (userId) => {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Account ID is required" },
        { status: 400 }
      );
    }

    await db.delete(accounts).where(and(eq(accounts.id, id), eq(accounts.userId, userId)));

    logDataEvent({ userId, action: "account_delete", targetId: id, targetType: "account" });

    return NextResponse.json({ success: true });
  }, "Failed to delete account");
}
