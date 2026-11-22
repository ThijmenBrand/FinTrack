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
import { getScopeAccountRows } from "./_lib/dashboard-queries";
import { effectiveStartDay, resolveBudgetPlan, resolveBudgetScope } from "@/lib/budget-plan";
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
  InvestmentsCard,
  InvestmentsCardSkeleton,
} from "./_components/investments-card";
import {
  ComingUpThisMonthCard,
  ComingUpThisMonthCardSkeleton,
} from "./_components/coming-up-this-month-card";
import {
  SavingTowardCard,
  SavingTowardCardSkeleton,
} from "./_components/saving-toward-card";
import {
  PotBudgetsCard,
  PotBudgetsCardSkeleton,
} from "./_components/pot-budgets-card";
import {
  UpcomingMoneyCard,
  UpcomingMoneyCardSkeleton,
} from "./_components/upcoming-money-card";
import { BudgetScopeSelect } from "@/components/budget-scope-select";
import { getI18n } from "@/lib/i18n/server";
import type { I18n } from "@/lib/i18n/translate";

/** Period line above the cards — the only place the dates are spelled out. */
function DashboardHeader({
  startDay,
  pinnedPlanName,
  i18n,
}: {
  startDay: number;
  /**
   * Set only when a ?budget= link pointed the page at a budget. The sidebar
   * selector needs no banner — it shows the scope itself.
   */
  pinnedPlanName: string | null;
  i18n: I18n;
}) {
  const { t, plural, intlLocale } = i18n;
  const now = new Date();
  const { daysLeft, progress } = getPeriodProgress(now, startDay);

  return (
    // Phones put the budgets link beside the large title, where a native app
    // keeps its one header action; wider screens keep it on the bottom edge.
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 md:items-end">
      <h1 className="text-3xl font-bold tracking-tight md:text-2xl">{t("dashboard.title")}</h1>
      <p className="col-span-2 row-start-2 text-sm text-muted-foreground md:col-span-1">
        {plural(daysLeft, "dashboard.periodLine.one", "dashboard.periodLine.other", {
          label: formatFinancialMonthLabel(now, startDay, intlLocale),
          pct: Math.round(progress * 100),
        })}
      </p>
      {/* Phones have no sidebar, so the scope selector lives under the title
          — the one place a page header action belongs on a phone. */}
      <div className="col-span-2 row-start-3 mt-1 md:hidden">
        <BudgetScopeSelect variant="header" />
      </div>

      {/* Every number below is a pinned budget's, which the page otherwise
          never says — and without a way out you'd be stuck on a link. */}
      {pinnedPlanName && (
        <p className="col-span-2 row-start-4 mt-1 flex flex-wrap items-center gap-x-2 text-sm md:col-span-1 md:row-start-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 font-medium">
            <Wallet className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t("dashboard.pinnedToBudget", { name: pinnedPlanName })}
          </span>
          <Link href="/" className="rounded text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring">
            {t("dashboard.clearPinnedBudget")}
          </Link>
        </p>
      )}
      <Link
        href="/budgets"
        className="col-start-2 row-start-1 flex shrink-0 items-center gap-0.5 rounded text-sm text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring max-md:h-8 max-md:rounded-full max-md:bg-primary/10 max-md:px-3 max-md:font-medium max-md:hover:no-underline md:row-span-3 md:self-end"
      >
        {t("dashboard.allBudgets")}{" "}
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </div>
  );
}

/**
 * The plan the dashboard runs on: the one ?budget= names, else whatever the
 * sidebar selector is scoped to. A stale link — a deleted plan, or an account
 * that stopped being shared — falls back to the scope rather than to an empty
 * dashboard.
 *
 * `scoped` says whether the page narrows to this plan's accounts. It is false
 * under "All budgets", where the plan is only what the category card falls
 * back to (it names the plan it shows, so the two never disagree).
 */
async function resolveDashboardPlan(userId: string, requestedPlanId: string | null) {
  if (requestedPlanId) {
    const linked = await resolveBudgetPlan(userId, requestedPlanId);
    if (linked) return { plan: linked, scoped: true, fromLink: true };
  }
  const scope = await resolveBudgetScope(userId);
  return { plan: scope.plan, scoped: !scope.all, fromLink: false };
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
  const [prefs, scopeRows, { plan: scopedPlan, scoped, fromLink }, i18n] = await Promise.all([
    getUserPreferences(userId),
    getScopeAccountRows(userId),
    resolveDashboardPlan(userId, requestedPlanId),
    getI18n(),
  ]);
  const startDay = prefs.financialMonthStartDay;
  // Scoped to one budget: the tiles count that budget's accounts, narrowed to
  // the ones this user may read — a shared plan can hold accounts that were
  // never shared with them. Under "All budgets" it's everyday money only: all
  // checking accounts (see defaultScopeAccountIds). Drives Earned/Spent/Net.
  const visibleIds = new Set(scopeRows.map((a) => a.id));
  const scopedAccountIds =
    scoped && scopedPlan ? scopedPlan.accountIds.filter((id) => visibleIds.has(id)) : [];
  const accountIds =
    scopedAccountIds.length > 0
      ? scopedAccountIds
      : defaultScopeAccountIds(scopeRows, prefs.defaultAccountId);
  // Free-to-spend math follows the scoped budget's accounts; without plans it
  // falls back to the same all-checking scope.
  const scopedPlanAccountIds = scopedPlan ? scopedPlan.accountIds : accountIds;
  // A shared plan runs its card as the OWNER (their data, their financial
  // month) so both parties see identical numbers. The other cards keep the
  // member's own identity and startDay.
  const planIsForeign = scopedPlan !== null && scopedPlan.ownerId !== userId;
  const planUserId = planIsForeign ? scopedPlan.ownerId : userId;
  const planStartDay = await effectiveStartDay(userId, scopedPlan, startDay);
  // Only a plan that actually resolved gets passed on; the cards fall back to
  // the main plan on their own when this is undefined. Passed under "All
  // budgets" too — the category card can only show one budget, and this is
  // the one it names.
  const scopedPlanId = scopedPlan ? scopedPlan.id : undefined;

  return (
    <div className="space-y-4">
      <DashboardHeader
        startDay={startDay}
        pinnedPlanName={fromLink && scopedPlan ? scopedPlan.name : null}
        i18n={i18n}
      />

      <Suspense fallback={<PeriodSummarySkeleton />}>
        <PeriodSummary
          userId={userId}
          startDay={startDay}
          accountIds={accountIds}
          planId={scopedPlanId}
        />
      </Suspense>

      {/* Budgets carry the page, so they get the wide column; the side cards
          are all glanceable and keep their fixed width. */}
      {/* grid-cols-1 is minmax(0,1fr): the implicit mobile column is `auto`,
          which let a wide budget row stretch the card past the screen. */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="space-y-4">
          <Suspense fallback={<BudgetCategoriesSkeleton />}>
            <BudgetCategories userId={userId} startDay={startDay} planId={scopedPlanId} />
          </Suspense>
          {/* What the budget card can't know: the money already promised to
              bills and salaries that haven't moved yet. Simple mode drops it
              along with the other extras. */}
          {!prefs.simpleMode && (
            <Suspense fallback={<UpcomingMoneyCardSkeleton />}>
              <UpcomingMoneyCard
                userId={userId}
                startDay={startDay}
                accountIds={scopedAccountIds.length > 0 ? scopedAccountIds : undefined}
              />
            </Suspense>
          )}
        </div>

        <div className="space-y-4">
          <Suspense fallback={<AccountsCardSkeleton />}>
            <AccountsCard userId={userId} />
          </Suspense>
          {/* Cash, then what cash was turned into. Outside the simple-mode
              guard on purpose: the card renders nothing until the user has
              made an investment account, so it is opted into rather than
              clutter to hide. */}
          <Suspense fallback={<InvestmentsCardSkeleton />}>
            <InvestmentsCard userId={userId} />
          </Suspense>
          {/* Simple mode: balances and budgets only — the extra glanceable
              cards are exactly the clutter it exists to remove. */}
          {!prefs.simpleMode && (
            <>
              <Suspense fallback={<ComingUpThisMonthCardSkeleton />}>
                <ComingUpThisMonthCard
                  userId={planUserId}
                  startDay={planStartDay}
                  accountIds={scopedPlanAccountIds}
                />
              </Suspense>
              <Suspense fallback={<TopSpendingCardSkeleton />}>
                <TopSpendingCard
                  userId={userId}
                  startDay={startDay}
                  accountIds={scopedAccountIds.length > 0 ? scopedAccountIds : undefined}
                />
              </Suspense>
              <Suspense fallback={<SavingTowardCardSkeleton />}>
                <SavingTowardCard userId={userId} startDay={startDay} />
              </Suspense>
              {/* After Saving toward: the same pots, once their date has come. */}
              <Suspense fallback={<PotBudgetsCardSkeleton />}>
                <PotBudgetsCard userId={userId} />
              </Suspense>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
