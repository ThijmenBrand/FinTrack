import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accounts, transactions } from "@/db/schema";
import { eq, sum, asc, count } from "drizzle-orm";

// GET /api/accounts — list all accounts with computed balances
export async function GET() {
  try {
    const allAccounts = await db.select().from(accounts).orderBy(asc(accounts.sortOrder), asc(accounts.createdAt));

    const accountsWithBalances = await Promise.all(
      allAccounts.map(async (account) => {
        const result = await db
          .select({ total: sum(transactions.amount) })
          .from(transactions)
          .where(eq(transactions.accountId, account.id));

        const txTotal = Number(result[0]?.total) || 0;
        return {
          ...account,
          currentBalance: account.initialBalance + txTotal,
          transactionTotal: txTotal,
        };
      })
    );

    return NextResponse.json(accountsWithBalances);
  } catch (error) {
    console.error("Failed to fetch accounts:", error);
    return NextResponse.json(
      { error: "Failed to fetch accounts" },
      { status: 500 }
    );
  }
}

// POST /api/accounts — create a new account
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, type, bankName, iban, currency, initialBalance } = body;

    if (!name || !type) {
      return NextResponse.json(
        { error: "Name and type are required" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    // Get the next sort order
    const [{ total }] = await db.select({ total: count() }).from(accounts);

    await db.insert(accounts).values({
      id,
      name,
      type,
      bankName: bankName || null,
      iban: iban || null,
      currency: currency || "EUR",
      initialBalance: Number(initialBalance) || 0,
      sortOrder: total,
      createdAt: now,
      updatedAt: now,
    });

    const [newAccount] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, id));

    return NextResponse.json(newAccount, { status: 201 });
  } catch (error) {
    console.error("Failed to create account:", error);
    return NextResponse.json(
      { error: "Failed to create account" },
      { status: 500 }
    );
  }
}

// PUT /api/accounts — update an account
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, name, type, bankName, iban, currency, initialBalance } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Account ID is required" },
        { status: 400 }
      );
    }

    await db
      .update(accounts)
      .set({
        name,
        type,
        bankName,
        iban: iban || null,
        currency,
        initialBalance: Number(initialBalance) || 0,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(accounts.id, id));

    const [updated] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, id));

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Failed to update account:", error);
    return NextResponse.json(
      { error: "Failed to update account" },
      { status: 500 }
    );
  }
}

// PATCH /api/accounts — reorder accounts
export async function PATCH(request: NextRequest) {
  try {
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
        .where(eq(accounts.id, orderedIds[i]));
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to reorder accounts:", error);
    return NextResponse.json(
      { error: "Failed to reorder accounts" },
      { status: 500 }
    );
  }
}

// DELETE /api/accounts — delete an account
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Account ID is required" },
        { status: 400 }
      );
    }

    await db.delete(accounts).where(eq(accounts.id, id));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete account:", error);
    return NextResponse.json(
      { error: "Failed to delete account" },
      { status: 500 }
    );
  }
}
