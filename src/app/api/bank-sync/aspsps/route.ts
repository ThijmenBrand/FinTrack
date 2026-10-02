import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bankAspspCache } from "@/db/schema";
import { withUser } from "@/lib/auth";
import { apiError } from "@/lib/api-errors";
import { isBankSyncCountry } from "@/lib/bank-sync/config";
import { enqueueJob } from "@/lib/jobs/enqueue";
import { JOB_PRIORITY } from "@/lib/jobs/types";

const CACHE_MS = 24 * 3_600_000;

/**
 * GET /api/bank-sync/aspsps?country=NL
 * The banks of a country. Served from the cache when it is fresh (public
 * data); otherwise the worker fetches it and the client polls `requestId`.
 */
export async function GET(request: NextRequest) {
  return withUser(async (userId) => {
    const country = request.nextUrl.searchParams.get("country");
    if (!isBankSyncCountry(country)) return apiError("api.bankInvalidCountry", 400);

    const [cached] = await db.select().from(bankAspspCache).where(eq(bankAspspCache.country, country)).limit(1);
    if (cached && Date.now() - Date.parse(cached.fetchedAt) < CACHE_MS) {
      try {
        const list = JSON.parse(cached.data) as Array<{ name: string; country: string; maximumConsentValidity: number | null }>;
        return NextResponse.json({
          aspsps: list
            .map((a) => ({
              name: a.name,
              country: a.country,
              maxConsentDays: a.maximumConsentValidity ? Math.floor(a.maximumConsentValidity / 86_400) : null,
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        });
      } catch {
        // fall through to a refresh
      }
    }
    const requestId = await enqueueJob(userId, "bank.list_aspsps", { country }, {
      priority: JOB_PRIORITY.interactive,
      dedupeKey: `aspsps:${userId}:${country}`,
      maxAttempts: 3,
    });
    return NextResponse.json({ requestId }, { status: 202 });
  }, "Failed to list banks");
}
