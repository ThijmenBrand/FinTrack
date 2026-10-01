import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { recurringTransactions } from "@/db/schema";
import { apiError } from "@/lib/api-errors";
import { withUser } from "@/lib/auth";
import { memberAccountIds, requireAccountAccess } from "@/lib/account-access";
import { readFile } from "@/lib/file-store";
import { logoFromInput, logoFromName, parseLogoInput } from "@/lib/merchant-logo";
import { createRateLimiter } from "@/lib/rate-limit";
import { isLogoKey, logoUrl, removeLogo, saveLogo } from "@/lib/recurring-logo";

// Each try is up to three outbound requests and a sharp re-encode, so it gets
// its own budget rather than riding the global 100/min.
const allowLookup = createRateLimiter(15 * 60 * 1000, 30);

/** The plan with what a write needs to authorize — unscoped; the account decides. */
async function findPlan(id: string) {
  const [plan] = await db
    .select({
      id: recurringTransactions.id,
      // Selected for the tenant guard in src/db: who may write is decided by
      // the account below, as in PUT /api/recurring.
      userId: recurringTransactions.userId,
      accountId: recurringTransactions.accountId,
      description: recurringTransactions.description,
    })
    .from(recurringTransactions)
    .where(eq(recurringTransactions.id, id))
    .limit(1);
  return plan;
}

// GET /api/recurring/[id]/logo — the stored logo's bytes, for anyone who can see the plan
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withUser(async (userId) => {
    const { id } = await params;
    const [plan] = await db
      .select({ logoKey: recurringTransactions.logoKey })
      .from(recurringTransactions)
      .where(
        and(
          eq(recurringTransactions.id, id),
          or(
            eq(recurringTransactions.userId, userId),
            inArray(recurringTransactions.accountId, memberAccountIds(userId)),
          ),
        ),
      )
      .limit(1);
    // The key comes from the row, never the URL; the `v` query is only a cache buster.
    if (!plan || !isLogoKey(plan.logoKey)) return apiError("api.notFound", 404);

    const file = await readFile(plan.logoKey);
    if (!file) return apiError("api.notFound", 404);

    return new NextResponse(file.stream, {
      headers: {
        "Content-Type": file.contentType,
        "Content-Length": String(file.size),
        // URLs carry the key's random suffix, so one URL's bytes never change.
        // `private`: whether you may see a plan is per user.
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  }, "Failed to load logo");
}

// POST /api/recurring/[id]/logo — find a logo, from `source` (a link, domain or
// company name) or, without one, from the plan's own name
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withUser(async (userId) => {
    const { id } = await params;
    const body: unknown = await request.json().catch(() => null);
    const source = (body as { source?: unknown } | null)?.source;
    // Checked up front, so an unusable link ("ftp://…", "localhost:3000") is
    // reported as such rather than as a lookup that found nothing.
    if (
      source !== undefined &&
      (typeof source !== "string" || (source.trim() !== "" && !parseLogoInput(source)))
    ) {
      return apiError("api.logoSourceInvalid", 400);
    }

    const plan = await findPlan(id);
    if (!plan) return apiError("api.recurringNotFound", 404);
    const access = await requireAccountAccess(userId, plan.accountId, "write");

    if (!allowLookup(userId)) return apiError("api.rateLimitedLogos", 429);

    const found = source?.trim() ? await logoFromInput(source) : await logoFromName(plan.description);
    if (!found) return apiError("api.logoNotFound", 422);

    const key = await saveLogo(plan.id, access.account.userId, found);
    if (!key) return apiError("api.recurringNotFound", 404);

    return NextResponse.json({ logoUrl: logoUrl(plan.id, key), logoSource: found.source });
  }, "Failed to find logo");
}

// DELETE /api/recurring/[id]/logo — back to the initial; no automatic re-lookup
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withUser(async (userId) => {
    const { id } = await params;
    const plan = await findPlan(id);
    if (!plan) return apiError("api.recurringNotFound", 404);
    const access = await requireAccountAccess(userId, plan.accountId, "write");

    await removeLogo(plan.id, access.account.userId);
    return NextResponse.json({ success: true });
  }, "Failed to remove logo");
}
