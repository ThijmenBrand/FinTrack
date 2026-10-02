import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { bankConnections } from "@/db/schema";
import { withSession } from "@/lib/auth";
import { apiError } from "@/lib/api-errors";
import { openMappingState } from "@/lib/bank-sync/status";
import { linkBankAccounts, parseLinks } from "@/lib/bank-sync/link-accounts";

/**
 * POST /api/bank-sync/links  { authStateId, links: LinkRequest[] }
 *
 * Finish a new connection by mapping its bank accounts to FinTrack accounts.
 * Only open to the session that went to the bank, within that trip's
 * lifetime, once — the auth state is what authorises it (the step-up was
 * given when the trip started). Later, the same mapping goes through
 * POST /api/bank-sync/connections/:id/links with a fresh step-up.
 */
export async function POST(request: NextRequest) {
  return withSession(async (ids) => {
    const { userId } = ids;
    const body = (await request.json().catch(() => null)) as { authStateId?: unknown; links?: unknown } | null;
    const authStateId = typeof body?.authStateId === "string" ? body.authStateId : "";
    const links = parseLinks(body);
    if (!authStateId || !links) return apiError("api.bankMappingInvalid", 400);

    const state = await openMappingState(ids, authStateId);
    if (!state?.connectionId) return apiError("api.bankAuthStateInvalid", 400);
    const [connection] = await db
      .select()
      .from(bankConnections)
      .where(and(eq(bankConnections.id, state.connectionId), eq(bankConnections.userId, userId)))
      .limit(1);
    if (!connection) return apiError("api.bankAuthStateInvalid", 400);

    return linkBankAccounts({ userId, connection, links, authStateId: state.id, headers: request.headers });
  }, "Failed to link bank accounts");
}
