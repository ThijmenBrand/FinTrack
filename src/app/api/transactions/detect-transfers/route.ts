import { NextResponse } from "next/server";
import { db } from "@/db";
import { getUserId } from "@/lib/auth";
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
  try {
    const userId = await getUserId();
    const result = await detectTransfers(db, userId);

    return NextResponse.json({
      success: true,
      matchedPairs: result.matchedPairs,
      totalTransactionsUpdated: result.totalTransactionsUpdated,
    });
  } catch (error) {
    console.error("Transfer detection failed:", error);
    return NextResponse.json(
      { error: "Failed to detect transfers: " + String(error) },
      { status: 500 }
    );
  }
}
