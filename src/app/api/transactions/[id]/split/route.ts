import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { transactions } from "@/db/schema";
import { withUser } from "@/lib/auth";
import { apiError } from "@/lib/api-errors";
import { requireAccountAccess } from "@/lib/account-access";
import { applySplit, unsplitTransaction, type SplitInput } from "@/lib/transaction-split";

type Params = { params: Promise<{ id: string }> };

async function resolveOwner(userId: string, transactionId: string) {
  // Row lookup is unscoped by caller — the write-access check below (via the
  // row's account) decides who may split it, not row ownership. `userId` is
  // selected so the statement names the column the tenant guard looks for.
  const [tx] = await db
    .select({ accountId: transactions.accountId, userId: transactions.userId })
    .from(transactions)
    .where(eq(transactions.id, transactionId));
  if (!tx) return null;
  const access = await requireAccountAccess(userId, tx.accountId, "write");
  return access.account.userId;
}

// POST/PUT /api/transactions/[id]/split — create or replace a transaction's
// splits. Body: { splits: [{ amount, categoryId?, description?, notes? }] }
async function handleSplit(request: NextRequest, { params }: Params) {
  return withUser(async (userId) => {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const rawSplits: unknown = body?.splits;
    // Type-check the string fields here rather than letting applySplit call
    // .trim() on whatever arrives — a non-string description would throw and
    // surface as a 500 instead of a 400. Amounts and category ownership are
    // applySplit's job; it has to check them for the rule path anyway.
    const isSplitShape = (s: unknown): boolean => {
      if (!s || typeof s !== "object") return false;
      const { categoryId, description, notes } = s as Record<string, unknown>;
      return (
        (categoryId == null || typeof categoryId === "string") &&
        (description == null || typeof description === "string") &&
        (notes == null || typeof notes === "string")
      );
    };
    if (!Array.isArray(rawSplits) || !rawSplits.every(isSplitShape)) {
      return NextResponse.json({ error: "splits array is required" }, { status: 400 });
    }
    const splits = rawSplits as SplitInput[];

    const ownerId = await resolveOwner(userId, id);
    if (!ownerId) return apiError("api.transactionNotFound", 404);

    const result = await applySplit({
      parentId: id,
      ownerId,
      actorId: userId,
      splits,
      source: "manual",
    });
    if (!result.ok) return apiError(result.error, result.status);
    return NextResponse.json({ success: true, childIds: result.childIds });
  }, "Failed to split transaction");
}

export const POST = handleSplit;
export const PUT = handleSplit;

// DELETE /api/transactions/[id]/split — unsplit: remove children, restore parent
export async function DELETE(_request: NextRequest, { params }: Params) {
  return withUser(async (userId) => {
    const { id } = await params;
    const ownerId = await resolveOwner(userId, id);
    if (!ownerId) return apiError("api.transactionNotFound", 404);

    const result = await unsplitTransaction({ parentId: id, ownerId, actorId: userId });
    if (!result.ok) return apiError(result.error, result.status);
    return NextResponse.json({ success: true });
  }, "Failed to unsplit transaction");
}
