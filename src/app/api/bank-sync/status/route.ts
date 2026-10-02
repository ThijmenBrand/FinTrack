import { NextResponse } from "next/server";
import { withSession } from "@/lib/auth";
import { bankSyncStatus } from "@/lib/bank-sync/status";

/** GET /api/bank-sync/status — the bank-connections screen in one read. */
export async function GET() {
  return withSession(async (ids) => NextResponse.json(await bankSyncStatus(ids)), "Failed to read bank sync status");
}
