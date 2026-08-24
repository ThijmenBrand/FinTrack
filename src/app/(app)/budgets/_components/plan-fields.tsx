"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSessionUser } from "@/components/nav-shared";
import { AvatarStack, UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { evenSplitPercents, memberSharePercents } from "@/lib/budget-split";
import { useI18n } from "@/lib/i18n/client";
import type {
  Account,
  BudgetPlanData,
  BudgetPlanPeriod,
  SharedWithUser,
  SplitMode,
} from "@/types/api";

/**
 * The three decisions a budget plan is made of — how it runs, which accounts
 * feed it, who carries what — as pieces the edit dialog and the create wizard
 * both render. Same control, same look, one place to fix.
 */

// ── How this budget works ───────────────────────────────────────────

/**
 * Monthly or one annual envelope. Two cards rather than a toggle: carry-over
 * changes what "over budget" even means, so the consequence is on screen next
 * to the choice. Native radios, so arrow keys and grouping come for free.
 */
export function PeriodChoice({
  name,
  value,
  onChange,
}: {
  /** Unique per rendered group — radios sharing a name share a selection. */
  name: string;
  value: BudgetPlanPeriod;
  onChange: (value: BudgetPlanPeriod) => void;
}) {
  const { t } = useI18n();

  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium leading-none">
        {t("budgets.plan.periodLabel")}
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {(["monthly", "yearly"] as const).map((option) => {
          const selected = value === option;
          return (
            <label key={option} className="cursor-pointer">
              <input
                type="radio"
                name={name}
                value={option}
                checked={selected}
                onChange={() => onChange(option)}
                className="peer sr-only"
              />
              <span
                className={cn(
                  "flex h-full items-start gap-2.5 rounded-lg border p-3 transition-colors duration-150",
                  "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background",
                  selected
                    ? "border-primary bg-primary/5"
                    : "border-input hover:bg-muted/50",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors duration-150",
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input",
                  )}
                >
                  {selected && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                <span className="min-w-0">
                  {/* Full contrast on both: an unpicked option is not a
                      disabled one, and muting it read as unavailable. */}
                  <span className="block text-sm font-medium">
                    {t(`budgets.plan.period.${option}`)}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {t(`budgets.plan.period.${option}Hint`)}
                  </span>
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

// ── Which accounts feed it ──────────────────────────────────────────

/**
 * The accounts a budget watches. Each row carries the bank and the balance, so
 * you pick by what the account *is* rather than by a name you have to
 * remember, and the faces show who a shared account brings along — which is
 * exactly what the split key below is about.
 */
export function AccountPicker({
  accounts,
  planNameById,
  currentPlanId,
  selectedIds,
  onToggle,
}: {
  /** Already filtered to budgetable types by the caller. */
  accounts: Account[];
  planNameById: Map<string, string>;
  /** The plan being edited, so "already in this one" is not flagged as a move. */
  currentPlanId?: string;
  selectedIds: string[];
  onToggle: (id: string, checked: boolean) => void;
}) {
  const { t, plural, formatCurrency } = useI18n();

  if (accounts.length === 0) {
    return (
      <div className="space-y-2">
        <Label>{t("budgets.plan.accountsLabel")}</Label>
        <p className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
          {t("budgets.plan.noAccounts")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <Label>{t("budgets.plan.accountsLabel")}</Label>
        <span
          className={cn(
            "text-xs tabular-nums",
            selectedIds.length > 0
              ? "text-muted-foreground"
              : "text-amber-600 dark:text-amber-400",
          )}
        >
          {plural(
            selectedIds.length,
            "budgets.plan.selected.one",
            "budgets.plan.selected.other",
          )}
        </span>
      </div>

      <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border">
        {accounts.map((acc) => {
          const checked = selectedIds.includes(acc.id);
          const otherPlanName =
            acc.budgetId && acc.budgetId !== currentPlanId
              ? planNameById.get(acc.budgetId)
              : null;
          const meta = [acc.bankName, formatCurrency(acc.currentBalance)]
            .filter(Boolean)
            .join(" · ");
          return (
            <li key={acc.id}>
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors duration-150",
                  checked ? "bg-primary/5" : "hover:bg-muted/40",
                )}
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(v) => onToggle(acc.id, v === true)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {acc.name}
                  </span>
                  <span className="block truncate text-xs tabular-nums text-muted-foreground">
                    {meta}
                  </span>
                </span>
                {acc.sharedWithUsers.length > 0 && (
                  <AvatarStack
                    people={acc.sharedWithUsers.map((u) => ({
                      name: u.name ?? u.email,
                      image: u.image,
                    }))}
                    title={acc.sharedWithUsers
                      .map((u) => u.name ?? u.email ?? "")
                      .join(", ")}
                  />
                )}
                {otherPlanName && (
                  <span
                    className={cn(
                      "max-w-[38%] shrink-0 truncate text-xs",
                      checked
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-muted-foreground",
                    )}
                  >
                    {t(
                      checked
                        ? "budgets.plan.movesFrom"
                        : "budgets.plan.currentlyIn",
                      { name: otherPlanName },
                    )}
                  </span>
                )}
              </label>
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-muted-foreground">
        {t("budgets.plan.exclusiveHint")}
      </p>
    </div>
  );
}

// ── Who carries what ────────────────────────────────────────────────

interface ShareRow {
  key: string;
  label: string;
  /** Null on the owner row — that's you, and you have no invite to draw. */
  person: SharedWithUser | null;
  value: string;
  set: (value: string) => void;
}

export interface SplitKey {
  /** The key only means something once one of the picked accounts is shared. */
  isShared: boolean;
  /** Percentages of the whole, or euros per period with one person on the rest. */
  mode: SplitMode;
  setMode: (mode: SplitMode) => void;
  rows: ShareRow[];
  /** The percentages added up, or the fixed euros added up — whichever is on. */
  total: number;
  valid: boolean;
  /** Percentages: an even key. Amounts: nobody fixed, which is the same thing. */
  splitEvenly: () => void;
  /** Spread into a create/update payload; empty unless shared and valid. */
  payload: {
    splitMode?: SplitMode;
    ownerSharePercent?: number;
    sharePercents?: Record<string, number>;
    ownerShareAmount?: number | null;
    shareAmounts?: Record<string, number | null>;
  };
}

const isWholePercent = (v: string) => {
  const n = Number(v);
  return v.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= 100;
};

/** An empty amount field is not a zero — it is "this person takes the rest". */
const isRest = (v: string) => v.trim() === "";
const isAmount = (v: string) => {
  const n = Number(v);
  return !isRest(v) && Number.isFinite(n) && n >= 0;
};
/** What a stored amount looks like in its field. Null is the rest: no number. */
const amountText = (v: number | null | undefined) => (v == null ? "" : String(v));

/**
 * The cost-split key of a shared budget, in whichever unit it is set in.
 * Values are held as text so a field can be cleared while typing — and in
 * amount mode a cleared field is itself an answer, "this person takes the
 * rest". `valid` is what a caller gates save on.
 *
 * One row per person, deduped: the same address may hold invites on several of
 * the plan's accounts, but carries one share of the budget.
 */
export function useSplitKey(
  accounts: Account[],
  selectedIds: string[],
  plan: BudgetPlanData | null,
): SplitKey {
  const { t } = useI18n();
  const [mode, setMode] = useState<SplitMode>(plan?.splitMode ?? "percent");
  const [ownerShare, setOwnerShare] = useState(
    String(plan?.ownerSharePercent ?? 50),
  );
  const [memberShares, setMemberShares] = useState<Record<string, string>>({});
  const [ownerAmount, setOwnerAmount] = useState(amountText(plan?.ownerShareAmount));
  const [memberAmounts, setMemberAmounts] = useState<Record<string, string>>({});

  const people = [
    ...new Map(
      accounts
        .filter((a) => selectedIds.includes(a.id))
        .flatMap((a) => a.sharedWithUsers)
        .flatMap((u) => (u.email ? [[u.email, u] as const] : [])),
    ).values(),
  ];
  const emails = people.map((p) => p.email!);
  const ownerValue = Number(ownerShare);
  // Anyone whose share was never set splits what the owner leaves, so the
  // fields start on a key that already adds up.
  const defaults = memberSharePercents(
    emails,
    Number.isFinite(ownerValue) ? ownerValue : 0,
    plan?.sharePercents,
  );
  const shareOf = (email: string) =>
    memberShares[email] ?? String(defaults[email] ?? 0);

  const amountOf = (email: string) =>
    memberAmounts[email] ?? amountText(plan?.shareAmounts?.[email]);

  const byAmount = mode === "amount";
  const parts = byAmount
    ? [ownerAmount, ...emails.map(amountOf)]
    : [ownerShare, ...emails.map(shareOf)];
  const total = parts.reduce((sum, v) => sum + (Number(v) || 0), 0);
  const valid = byAmount
    ? // Every filled field a number, and somebody left to carry the rest —
      // without one, a budget that grew since would have euros nobody pays.
      parts.every((v) => isRest(v) || isAmount(v)) && parts.some(isRest)
    : parts.every(isWholePercent) && total === 100;
  const isShared = people.length > 0;

  return {
    isShared,
    mode,
    setMode,
    total,
    valid,
    rows: [
      {
        key: "owner",
        label: t("budgets.plan.splitYou"),
        person: null,
        value: byAmount ? ownerAmount : ownerShare,
        set: byAmount ? setOwnerAmount : setOwnerShare,
      },
      ...people.map((p) => ({
        key: p.email!,
        label: p.name ?? p.email!,
        person: p,
        value: byAmount ? amountOf(p.email!) : shareOf(p.email!),
        set: (v: string) =>
          byAmount
            ? setMemberAmounts((prev) => ({ ...prev, [p.email!]: v }))
            : setMemberShares((prev) => ({ ...prev, [p.email!]: v })),
      })),
    ],
    splitEvenly: () => {
      if (byAmount) {
        // Nobody on a fixed amount means everybody is on the rest, and the
        // rest is handed out evenly — the same key, said in euros.
        setOwnerAmount("");
        setMemberAmounts(Object.fromEntries(emails.map((e) => [e, ""])));
        return;
      }
      const { owner, each } = evenSplitPercents(emails.length);
      setOwnerShare(String(owner));
      setMemberShares(Object.fromEntries(emails.map((e) => [e, String(each)])));
    },
    payload: !isShared || !valid
      ? {}
      : byAmount
        ? {
            splitMode: "amount",
            ownerShareAmount: isRest(ownerAmount) ? null : Number(ownerAmount),
            shareAmounts: Object.fromEntries(
              emails.map((e) => [
                e,
                isRest(amountOf(e)) ? null : Number(amountOf(e)),
              ]),
            ),
          }
        : {
            splitMode: "percent",
            ownerSharePercent: ownerValue,
            sharePercents: Object.fromEntries(
              emails.map((e) => [e, Number(shareOf(e))]),
            ),
          },
  };
}

/**
 * Percentages or euros. Two ways of saying the same thing — "half each", or
 * "you pay the 900 rent and I cover what is left" — and a household that
 * splits by amount cannot express it as a percentage, because a fixed amount
 * that stayed a percentage would move the moment the budget did.
 */
function SplitModeChoice({
  mode,
  onChange,
}: {
  mode: SplitMode;
  onChange: (mode: SplitMode) => void;
}) {
  const { t } = useI18n();

  return (
    <fieldset className="flex items-center rounded-md border p-0.5">
      <legend className="sr-only">{t("budgets.plan.splitModeLabel")}</legend>
      {(["percent", "amount"] as const).map((option) => (
        <label key={option} className="cursor-pointer">
          <input
            type="radio"
            name="plan-split-mode"
            value={option}
            checked={mode === option}
            onChange={() => onChange(option)}
            className="peer sr-only"
          />
          <span
            className={cn(
              "block rounded px-2 py-1 text-xs font-medium transition-colors duration-150",
              "peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
              mode === option
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`budgets.plan.splitMode.${option}`)}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * Who carries what of a shared budget. Everyone still sees the whole plan;
 * this only decides whose share the totals are read as.
 *
 * One list, two units. The rows never move between modes — the same people in
 * the same order, with the field beside them changing from a percentage to an
 * amount — so switching reads as re-stating the key rather than starting over.
 */
export function SplitEditor({ split }: { split: SplitKey }) {
  const { t, formatCurrency } = useI18n();
  // The owner row has no invite to draw a face off — that's you, so take your
  // picture from the session the way the nav does.
  const { user } = useSessionUser();
  const byAmount = split.mode === "amount";
  const restHolders = split.rows.filter((row) => row.value.trim() === "");

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label>{t("budgets.plan.splitLabel")}</Label>
        <SplitModeChoice mode={split.mode} onChange={split.setMode} />
      </div>

      <ul className="divide-y rounded-lg border">
        {split.rows.map((row) => (
          <li key={row.key} className="flex items-center gap-3 px-3 py-2">
            <UserAvatar
              name={row.person ? row.label : user?.displayName || row.label}
              image={row.person ? row.person.image : user?.imageUrl}
              className="h-6 w-6 text-[11px]"
            />
            <label
              htmlFor={`plan-share-${row.key}`}
              className="min-w-0 flex-1 truncate text-sm"
            >
              {row.label}
            </label>
            {byAmount ? (
              // An empty field is the answer "whatever is left", so it says so
              // in the placeholder rather than sitting there looking unfilled.
              <div className="relative">
                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  &euro;
                </span>
                <Input
                  id={`plan-share-${row.key}`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  placeholder={t("budgets.plan.splitRest")}
                  value={row.value}
                  onChange={(e) => row.set(e.target.value)}
                  className="h-8 w-32 pl-6 text-right tabular-nums"
                  aria-describedby="plan-share-hint"
                />
              </div>
            ) : (
              <>
                <Input
                  id={`plan-share-${row.key}`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={100}
                  step={1}
                  value={row.value}
                  onChange={(e) => row.set(e.target.value)}
                  className="h-8 w-16 text-right tabular-nums"
                  aria-describedby="plan-share-hint"
                />
                <span className="w-3 text-sm text-muted-foreground">%</span>
              </>
            )}
          </li>
        ))}
        {/* The running total, where the eye already is — the hint below says
            what the key means, this says whether it works. In euros there is
            no total to reach, so it reports what is already spoken for and
            who picks up the remainder. */}
        <li
          className={cn(
            "flex items-center justify-between gap-3 bg-muted/40 px-3 py-2 text-xs",
            split.valid
              ? "text-muted-foreground"
              : "text-amber-600 dark:text-amber-400",
          )}
        >
          <button
            type="button"
            onClick={split.splitEvenly}
            className="text-primary hover:underline"
          >
            {t("budgets.plan.splitEvenly")}
          </button>
          <span className={cn("font-medium tabular-nums", !byAmount && "pr-[4.75rem]")}>
            {byAmount
              ? t("budgets.plan.splitFixedTotal", {
                  amount: formatCurrency(split.total),
                })
              : `${t("budgets.plan.splitTotal")} ${split.total}%`}
          </span>
        </li>
      </ul>

      <p
        id="plan-share-hint"
        className={cn(
          "text-xs",
          split.valid
            ? "text-muted-foreground"
            : "text-amber-700 dark:text-amber-400",
        )}
      >
        {split.valid
          ? byAmount
            ? t("budgets.plan.splitRestGoesTo", {
                // Everyone left empty splits the remainder, so name them all
                // rather than let one of them find out on the budget page.
                names: restHolders.map((row) => row.label).join(", "),
              })
            : t("budgets.plan.splitHint")
          : byAmount
            ? t("budgets.plan.splitNeedsRest")
            : t("budgets.plan.splitInvalid", { total: split.total })}
      </p>
    </div>
  );
}
