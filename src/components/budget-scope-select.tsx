"use client";

import Link from "next/link";
import { Check, ChevronsUpDown, Layers, Settings2, Star, Users, Wallet } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ALL_BUDGETS, useBudgetScope } from "@/hooks/use-budget-scope";
import { useIsHydrated } from "@/hooks/use-browser";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import type { BudgetPlanData } from "@/types/api";

/**
 * The app-wide budget selector. One control, in the sidebar on desktop and
 * under the page title on phones, standing for one selection — the dashboard,
 * budgets, insights and transactions all follow it.
 *
 * Hidden entirely below two plans: a selector with one option is furniture.
 */
export function BudgetScopeSelect({
  variant = "sidebar",
  collapsed = false,
  className,
}: {
  variant?: "sidebar" | "header";
  /** Sidebar rail: icon only, name hidden. */
  collapsed?: boolean;
  className?: string;
}) {
  const { t, plural } = useI18n();
  const { plans, value, plan, setValue, isLoading, hasChoice } = useBudgetScope();
  // Server-rendered pages mount this too, and the scope only exists once the
  // client queries resolve — rendering the trigger before then is a hydration
  // mismatch, not a flash of the wrong budget.
  const hydrated = useIsHydrated();

  if (!hydrated || isLoading || !hasChoice) return null;

  const isAll = value === ALL_BUDGETS;
  const label = isAll ? t("nav.budgetScope.all") : plan?.name ?? t("nav.budgetScope.all");

  const subtitle = (p: BudgetPlanData) =>
    [
      t(p.period === "yearly" ? "budgets.plan.period.yearly" : "budgets.plan.period.monthly"),
      p.isMain ? t("budgets.switcher.mainShort") : null,
      plural(
        p.accounts.length,
        "budgets.switcher.accounts.one",
        "budgets.switcher.accounts.other",
      ),
      p.ownerName ? t("sharing.sharedBy", { name: p.ownerName }) : null,
    ]
      .filter(Boolean)
      .join(" · ");

  const trigger =
    variant === "sidebar" ? (
      <DropdownMenuTrigger
        aria-label={t("nav.budgetScope.label")}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg border bg-background/60 px-2.5 py-2 text-left transition-colors hover:bg-sidebar-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          collapsed && "justify-center px-0",
          className,
        )}
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          {isAll ? <Layers className="h-3.5 w-3.5" /> : <Wallet className="h-3.5 w-3.5" />}
        </span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {t("nav.budgetScope.heading")}
              </span>
              <span className="block truncate text-sm font-medium text-sidebar-foreground">
                {label}
              </span>
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </>
        )}
      </DropdownMenuTrigger>
    ) : (
      <DropdownMenuTrigger
        aria-label={t("nav.budgetScope.label")}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-full bg-muted px-3 text-sm font-medium transition-colors hover:bg-muted/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        {isAll ? (
          <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <Wallet className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="max-w-[9rem] truncate">{label}</span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
    );

  return (
    <DropdownMenu modal={false}>
      {trigger}
      <DropdownMenuContent
        align="start"
        side={variant === "sidebar" ? "right" : "bottom"}
        className="w-72"
      >
        <DropdownMenuLabel className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("nav.budgetScope.heading")}
        </DropdownMenuLabel>
        {plans.map((p) => (
          <DropdownMenuItem key={p.id} onSelect={() => setValue(p.id)} className="gap-2">
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-sm">{p.name}</span>
                {p.isMain && (
                  <Star
                    className="h-3 w-3 shrink-0 fill-current text-amber-500"
                    aria-label={t("dashboard.budgetCard.mainBudgetStar")}
                  />
                )}
                {p.ownerName && (
                  <Users
                    className="h-3 w-3 shrink-0 text-violet-500"
                    aria-label={t("sharing.sharedByTooltip", { name: p.ownerName })}
                  />
                )}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {subtitle(p)}
              </span>
            </span>
            {value === p.id && <Check className="h-4 w-4 shrink-0 text-primary" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {/* Not a budget, so it sits below the rule: the cross-budget view the
            insights page has always had, now reachable from everywhere. */}
        <DropdownMenuItem onSelect={() => setValue(ALL_BUDGETS)} className="gap-2">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm">{t("nav.budgetScope.all")}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {t("nav.budgetScope.allSubtitle")}
            </span>
          </span>
          {isAll && <Check className="h-4 w-4 shrink-0 text-primary" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/budgets" className="flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            {t("nav.budgetScope.manage")}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
