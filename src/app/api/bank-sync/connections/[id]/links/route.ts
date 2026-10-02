import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { bankConnections } from "@/db/schema";
import { apiError } from "@/lib/api-errors";
import { linkBankAccounts, parseLinks } from "@/lib/bank-sync/link-accounts";
import { withStepUp } from "@/lib/step-up";

/**
 * POST /api/bank-sync/connections/:id/links  { links: LinkRequest[] }  (step-up)
 * Link bank accounts of an existing connection that aren't linked yet — after
 * the mapping screen of the trip to the bank has closed, or for an account
 * that was skipped then.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withStepUp(async ({ userId }) => {
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as { links?: unknown } | null;
    const links = parseLinks(body);
    if (!links) return apiError("api.bankMappingInvalid", 400);

    const [connection] = await db
      .select()
      .from(bankConnections)
      .where(and(eq(bankConnections.id, id), eq(bankConnections.userId, userId)))
      .limit(1);
    if (!connection) return apiError("api.bankNotFound", 404);

    return linkBankAccounts({ userId, connection, links, headers: request.headers });
  }, "Failed to link bank accounts");
}
