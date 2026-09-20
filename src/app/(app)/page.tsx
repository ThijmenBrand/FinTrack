export const dynamic = "force-dynamic";

import { Suspense } from "react";
import Link from "next/link";
import { ArrowRight, Wallet } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { getUserPreferences } from "@/lib/preferences";
import {
  formatFinancialMonthLabel,
  getPeriodProgress,
} from "@/lib/financial-month";
import {
  PeriodSummary,
  PeriodSummarySkeleton,
} from "./_components/period-summary";
import { getMainPlan, getScopeAccountRows } from "./_lib/dashboard-queries";
import { resolveBudgetPlan } from "@/lib/budget-plan";
import { defaultScopeAccountIds } from "@/lib/account-scope";
import {
  BudgetCategories,
  BudgetCategoriesSkeleton,
} from "./_components/budget-categories";
import {
  TopSpendingCard,
  TopSpendingCardSkeleton,
} from "./_components/top-spending-card";
import {
  AccountsCard,
  AccountsCardSkeleton,
} from "./_components/accounts-card";
import {
  ComingUpThisMonthCard,
  ComingUpThisMonthCardSkeleton,
} from "./_components/coming-up-this-month-card";
import {
  SavingTowardCard,
  SavingTowardCardSkeleton,
} from "./_components/saving-toward-card";
import {
  UpcomingMoneyCard,
  UpcomingMoneyCardSkeleton,
} from "./_components/upcoming-money-card";
import { getI18n } from "@/lib/i18n/server";
import type { I18n } from "@/lib/i18n/translate";

/** Period line above the cards — the only place the dates are spelled out. */
function DashboardHeader({
  startDay,
  pinnedPlanName,
  i18n,
}: {
  startDay: number;
  /** Set when ?budget= pinned the page to a plan other than the usual one. */
  pinnedPlanName: string | null;
  i18n: I18n;
}) {
  const { t, plural, intlLocale } = i18n;
  const now = new Date();
  const { daysLeft, progress } = getPeriodProgress(now, startDay);

  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("dashboard.title")}</h1>
        <p className="text-sm text-muted-foreground">
          {plural(daysLeft, "dashboard.periodLine.one", "dashboard.periodLine.other", {
            label: formatFinancialMonthLabel(now, startDay, intlLocale),
            pct: Math.round(progress * 100),
          })}
        </p>
        {/* Every number below is a pinned budget's, which the page otherwise
            never says — and without a way out you'd be stuck on a link. */}
        {pinnedPlanName && (
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 font-medium">
              <Wallet className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t("dashboard.pinnedToBudget", { name: pinnedPlanName })}
            </span>
            <Link href="/" className="rounded text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring">
              {t("dashboard.clearPinnedBudget")}
            </Link>
          </p>
        )}
      </div>
      <Link
        href="/budgets"
        className="flex shrink-0 items-center gap-0.5 rounded text-sm text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t("dashboard.allBudgets")}{" "}
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </div>
  );
}

/**
 * The plan the dashboard runs on: the one ?budget= names, else the usual main
 * plan. A stale link — a deleted plan, or an account that stopped being shared
 * — falls back to the main plan rather than to an empty dashboard.
 */
async function resolveDashboardPlan(userId: string, requestedPlanId: string | null) {
  if (requestedPlanId) {
    const pinned = await resolveBudgetPlan(userId, requestedPlanId);
    if (pinned) return { plan: pinned, pinned: true };
  }
  return { plan: await getMainPlan(userId), pinned: false };
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ budget?: string | string[] }>;
}) {
  const session = await requireAuth();
  const userId = session.userId;
  const { budget } = await searchParams;
  // ?budget=<planId> points the whole page at one budget instead of the main
  // one — the account dialog links here so "how is the budget this account
  // pays into doing?" is one click away from the account.
  const requestedPlanId = typeof budget === "string" ? budget : null;
  // The account query doesn't depend on prefs, so don't wait on them serially —
  // against a remote DB each round trip here delays every card below.
  const [prefs, scopeRows, { plan: mainPlan, pinned }, i18n] = await Promise.all([
    getUserPreferences(userId),
    getScopeAccountRows(userId),
    resolveDashboardPlan(userId, requestedPlanId),
    getI18n(),
  ]);
  const startDay = prefs.financialMonthStartDay;
  // Pinned: the tiles count the budget's accounts, narrowed to the ones this
  // user may read — a shared plan can hold accounts that were never shared
  // with them. Otherwise everyday money only: all checking accounts (see
  // defaultScopeAccountIds). Drives the Earned/Spent/Net tiles.
  const visibleIds = new Set(scopeRows.map((a) => a.id));
  const pinnedScope =
    pinned && mainPlan ? mainPlan.accountIds.filter((id) => visibleIds.has(id)) : [];
  const accountIds =
    pinnedScope.length > 0
      ? pinnedScope
      : defaultScopeAccountIds(scopeRows, prefs.defaultAccountId);
  // Free-to-spend math follows the main budget's accounts; without plans it
  // falls back to the same all-checking scope.
  const mainPlanAccountIds = mainPlan ? mainPlan.accountIds : accountIds;
  // A shared main plan runs its card as the OWNER (their data, their financial
  // month) so both parties see identical numbers. The other cards keep the
  // member's own identity and startDay.
  const planIsForeign = mainPlan !== null && mainPlan.ownerId !== userId;
  const planUserId = planIsForeign ? mainPlan.ownerId : userId;
  const planStartDay = planIsForeign
    ? (await getUserPreferences(mainPlan.ownerId)).financialMonthStartDay
    : startDay;
  // Only a plan that actually resolved gets passed on; the cards fall back to
  // the main plan on their own when this is undefined.
  const pinnedPlanId = pinned && mainPlan ? mainPlan.id : undefined;

  return (
    <div className="space-y-4">
      <DashboardHeader
        startDay={startDay}
        pinnedPlanName={pinned && mainPlan ? mainPlan.name : null}
        i18n={i18n}
      />

      <Suspense fallback={<PeriodSummarySkeleton />}>
        <PeriodSummary
          userId={userId}
          startDay={startDay}
          accountIds={accountIds}
          planId={pinnedPlanId}
        />
      </Suspense>

      {/* Budgets carry the page, so they get the wide column; the side cards
          are all glanceable and keep their fixed width. */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="space-y-4">
          <Suspense fallback={<BudgetCategoriesSkeleton />}>
            <BudgetCategories userId={userId} startDay={startDay} planId={pinnedPlanId} />
          </Suspense>
          {/* What the budget card can't know: the money already promised to
              bills and salaries that haven't moved yet. Simple mode drops it
              along with the other extras. */}
          {!prefs.simpleMode && (
            <Suspense fallback={<UpcomingMoneyCardSkeleton />}>
              <UpcomingMoneyCard
                userId={userId}
                startDay={startDay}
                accountIds={pinnedScope.length > 0 ? pinnedScope : undefined}
              />
            </Suspense>
          )}
        </div>

        <div className="space-y-4">
          <Suspense fallback={<AccountsCardSkeleton />}>
            <AccountsCard userId={userId} />
          </Suspense>
          {/* Simple mode: balances and budgets only — the extra glanceable
              cards are exactly the clutter it exists to remove. */}
          {!prefs.simpleMode && (
            <>
              <Suspense fallback={<ComingUpThisMonthCardSkeleton />}>
                <ComingUpThisMonthCard
                  userId={planUserId}
                  startDay={planStartDay}
                  accountIds={mainPlanAccountIds}
                />
              </Suspense>
              <Suspense fallback={<TopSpendingCardSkeleton />}>
                <TopSpendingCard userId={userId} startDay={startDay} />
              </Suspense>
              <Suspense fallback={<SavingTowardCardSkeleton />}>
                <SavingTowardCard userId={userId} startDay={startDay} />
              </Suspense>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
