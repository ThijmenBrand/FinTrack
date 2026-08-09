import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/auth";
import { buildMoneyFlow } from "@/lib/money-flow";
import { getI18n } from "@/lib/i18n/server";

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
    const { t } = await getI18n();
    return NextResponse.json(
      await buildMoneyFlow(
        userId,
        {
          dateFrom: isoDate(searchParams.get("dateFrom")),
          dateTo: isoDate(searchParams.get("dateTo")),
          accountIds:
            searchParams.get("accountId")?.split(",").filter(Boolean) ?? [],
        },
        {
          account: t("flow.account"),
          otherAccount: t("flow.otherAccount"),
          uncategorizedIncome: t("flow.uncategorizedIncome"),
          otherIncome: t("flow.otherIncome"),
          uncategorized: t("common.uncategorized"),
          otherSpending: t("flow.otherSpending"),
          reimbursements: t("flow.reimbursements"),
          leftInAccount: t("flow.leftInAccount"),
          fromBalance: t("flow.fromBalance"),
        },
      ),
    );
  }, "Failed to fetch money flow");
}
