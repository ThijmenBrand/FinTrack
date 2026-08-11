import { NextResponse } from "next/server";
import { db } from "@/db";
import { withUser } from "@/lib/auth";
import { touchAllLedgers } from "@/lib/budget-jobs";
import { detectTransfers } from "@/lib/detect-transfers";

/**
 * POST /api/transactions/detect-transfers
 *
 * Detects internal transfers between accounts.
 * Logic: If money leaves Account A and enters Account B within ±2 days
 * with the same absolute amount, flag both as "Internal Transfer".
 *
 * This prevents internal moves from inflating income/expense totals.
 */
export async function POST() {
  return withUser(async (userId) => {
    const result = await detectTransfers(db, userId);

    // Rows reclassified as internal transfers stop counting as spend.
    await touchAllLedgers(userId);

    return NextResponse.json({
      success: true,
      matchedPairs: result.matchedPairs,
      totalTransactionsUpdated: result.totalTransactionsUpdated,
    });
  }, "Failed to detect transfers");
}
