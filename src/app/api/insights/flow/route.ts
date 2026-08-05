import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/auth";
import { buildMoneyFlow } from "@/lib/money-flow";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = (value: string | null) =>
  value && ISO_DATE.test(value) ? value : null;

/**
 * GET /api/insights/flow — money-flow graph for a range.
 * Query params: dateFrom, dateTo, accountId (comma-separated).
 */
export async function GET(request: NextRequest) {
  return withUser(async (userId) => {
    const { searchParams } = new URL(request.url);
    return NextResponse.json(
      await buildMoneyFlow(userId, {
        dateFrom: isoDate(searchParams.get("dateFrom")),
        dateTo: isoDate(searchParams.get("dateTo")),
        accountIds:
          searchParams.get("accountId")?.split(",").filter(Boolean) ?? [],
      }),
    );
  }, "Failed to fetch money flow");
}
