"use client";

import { useMemo, useState } from "react";
import { ListPlus, Pause, Pencil, Play, Plus, Repeat, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { getNextOccurrence, toMonthly } from "@/lib/recurring";
import {
  useRecurring,
  useCreateRecurring,
  useUpdateRecurring,
  useDeleteRecurring,
} from "@/hooks/use-recurring";
import { useI18n } from "@/lib/i18n/client";
import type {
  Account,
  CategoryWithDetails,
  FixedCost,
  IncomeLine,
  RecurringTx,
} from "@/types/api";
import {
  RecurringFormDialog,
  type RecurringPrefill,
} from "@/app/(app)/recurring/_components/recurring-form-dialog";
import { BudgetRow } from "./allocation-row";
import type { SplitShare } from "@/lib/budget-split";
import type { MessageKey } from "@/lib/i18n/translate";
import { fixedCostStatus, incomeStatus } from "./budget-row";
import { PausedBadge, PlanMeta, SubRow } from "./sub-row";
import type { HistoryTarget } from "@/components/budget-history-dialog";

/** Server-side bucket key for a recurring row with no category. */
export const UNCATEGORIZED = "uncategorized";

/**
 * The accounts a budget plan's recurring form may offer: the plan's own, or
 * everything when nothing scopes the page. Falls back to everything if the
 * plan owns no account, so the form never opens with an empty picker.
 */
export function scopeAccounts<T extends { id: string }>(
  accounts: T[],
  planAccountIds: string[] | null,
): T[] {
  if (planAccountIds === null) return accounts;
  const scoped = accounts.filter((a) => planAccountIds.includes(a.id));
  return scoped.length > 0 ? scoped : accounts;
}

/**
 * A drafted plan as the rest of this file expects to find it: the dialog's
 * payload with the names and dates the server would have filled in. Its id is
 * local — `draft:…` — and that is what marks it unsaved everywhere below.
 */
function draftTx(
  payload: Record<string, unknown>,
  id: string,
  accounts: Account[],
  categories: CategoryWithDetails[],
): RecurringTx {
  const type = String(payload.type);
  const amount = Math.abs(Number(payload.amount));
  const categoryId = (payload.categoryId as string | null) ?? null;
  const category = categories.find((c) => c.id === categoryId);
  const frequency = String(payload.frequency);
  const startDate = String(payload.startDate);
  const dayOfWeek = (payload.dayOfWeek as number | null) ?? null;
  const dayOfMonth = (payload.dayOfMonth as number | null) ?? null;
  return {
    id,
    accountId: String(payload.accountId),
    accountName: accounts.find((a) => a.id === payload.accountId)?.name ?? null,
    description: String(payload.description),
    // Signed the way the server stores it, so every total that reads this row
    // adds up to the same figure before and after the save.
    amount: type === "income" ? amount : -amount,
    type,
    categoryId,
    categoryKind: category?.kind ?? null,
    categoryName: category?.name ?? null,
    categoryColor: category?.color ?? null,
    frequency,
    dayOfWeek,
    dayOfMonth,
    monthOfYear: null,
    startDate,
    endDate: null,
    isActive: true,
    nextOccurrence: getNextOccurrence(frequency, startDate, dayOfWeek, dayOfMonth, null),
  };
}

/**
 * A category with only drafted plans has no line from the server to patch.
 *
 * Name and colour fall back the way the server's own grouping does, so a
 * synthesised row is indistinguishable from a real one and nothing downstream
 * has to know which kind it got. (`FixedCost` promises a string for both — an
 * empty one would satisfy the type and defeat every `??` that reads it.)
 */
function blankFixedCost(
  categoryId: string,
  items: RecurringTx[],
  uncategorized: string,
): FixedCost {
  return {
    categoryId,
    categoryName: items[0]?.categoryName || uncategorized,
    categoryColor: items[0]?.categoryColor || "#94a3b8",
    monthlyAmount: 0,
    spent: 0,
    avgMonthly: 0,
    avgMonths: 0,
    items: [],
  };
}

/** What every recurring row needs; identical for income and fixed costs. */
export interface PlanRowProps {
  showAccount: boolean;
  /**
   * Plans that exist only in the caller's draft. They get no pause button —
   * there is nothing running to pause — and their edit and delete go back to
   * the draft instead of the server.
   */
  pendingIds?: Set<string>;
  onEdit: (item: RecurringTx) => void;
  onDelete: (id: string) => void;
  onToggle: (item: RecurringTx) => void;
  /**
   * File this payment as a sub-line of the category above it, so its amount
   * counts toward the cap instead of only sitting under it. Only the budget
   * editor offers it, and only where the line would be counted.
   */
  onFile?: (item: RecurringTx) => void;
}

/** One category's fixed cost, with the plans that produce it. */
export interface FixedCostGroup {
  categoryId: string;
  /** Absent when every plan in the category is paused — nothing is due then. */
  fc?: FixedCost;
  items: RecurringTx[];
}

/** One category's income line, with the plans that promise it. */
export interface IncomeGroup {
  categoryId: string;
  /** Absent when every plan in the category is paused — nothing is expected. */
  line?: IncomeLine;
  /** The period's figures, already resolved to the scope on screen. */
  expected: number;
  received: number;
  items: RecurringTx[];
}

/**
 * The recurring plans behind the budget list, grouped by the category they
 * land in: income on one side, fixed costs on the other.
 *
 * A hook rather than a section component because a fixed cost is a budgeted
 * expense like any other — the page sorts those groups in among the
 * allocations rather than stacking them below in a section of their own.
 * Income rows are built the same way and queue above them in the same list:
 * the API's line joined to the plans that promise it.
 */
export function useRecurringPlans({
  planAccountIds,
  fixedCosts,
  incomeLines,
  yearScope,
  accounts,
  categories,
  linkedRecurringIds,
  pending,
  draftCreates,
}: {
  /** Accounts this plan owns; null when no plan scopes the page (= all). */
  planAccountIds: string[] | null;
  fixedCosts: FixedCost[] | undefined;
  /** The API's income side: one line per income category. */
  incomeLines: IncomeLine[] | undefined;
  /** Year scope reads a line's yearly figures instead of the month's. */
  yearScope: boolean;
  accounts: Account[];
  categories: CategoryWithDetails[];
  /**
   * Plans already absorbed by a sub-line row (see `linkedRecurringIds` in
   * `./budget-row`). Dropped before grouping so a linked plan never gets a
   * standalone row of its own — the category's other plans are unaffected.
   */
  linkedRecurringIds: Set<string>;
  /**
   * Plans the caller has drafted but not written. Grouped and totalled exactly
   * like a saved one, so the figures on screen answer "what would this plan be
   * if I saved now". Monthly figures: a caller in year scope would need them
   * converted, and the only caller that drafts (the budget editor) is not.
   */
  pending?: RecurringTx[];
  /**
   * Present when the caller drafts creates rather than writing them — the
   * budget editor, where nothing is saved until Save. Edits to plans that are
   * ALREADY saved still write straight through: they are the same edit
   * wherever it is made, and the budget page offers it too.
   */
  draftCreates?: {
    add: (tx: RecurringTx) => void;
    update: (tx: RecurringTx) => void;
    remove: (id: string) => void;
  };
}) {
  const { t } = useI18n();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringTx | null>(null);
  // Seeds a NEW plan for an income category that has none to edit yet.
  const [prefill, setPrefill] = useState<RecurringPrefill | null>(null);
  // Set when the add came from a row in the list. A category means that
  // category is the answer and the picker is locked; null only fixes the side
  // — "add income", where picking the category is the point.
  const [addUnder, setAddUnder] = useState<{
    categoryId: string | null;
    type: "income" | "expense";
  } | null>(null);

  // A plan's recurring payments belong on the plan's own accounts — offering
  // the rest is offering a payment this budget will never see.
  const planAccounts = scopeAccounts(accounts, planAccountIds);

  const { data: allItems = [] } = useRecurring();
  const createRecurring = useCreateRecurring();
  const updateRecurring = useUpdateRecurring();
  const deleteRecurring = useDeleteRecurring();

  // Mirror the server's scope: a plan only counts plans on the accounts it
  // owns, so a Joint budget shows joint salary and joint bills and nothing else.
  const pendingIds = useMemo(
    () => new Set((pending ?? []).map((p) => p.id)),
    [pending],
  );

  const { incomeGroups, expenseGroups, showAccount } = useMemo(() => {
    const all = pending ? [...allItems, ...pending] : allItems;
    // A drafted plan is always in scope, whatever account it names: the form
    // offers every account when the plan owns none (see `scopeAccounts`), and
    // a payment counted in the totals below with no row to show for it is
    // worse than one filed under a plan it only half belongs to.
    const scoped =
      planAccountIds === null
        ? all
        : all.filter((i) => planAccountIds.includes(i.accountId) || pendingIds.has(i.id));
    // What the drafted plans would add to each bucket's monthly figure. The
    // lines below come from the server, which has never heard of them, so the
    // group rows get them added back here — otherwise a drafted payment would
    // show up as a sub-row under a category total that ignores it.
    const drafted = new Map<string, number>();
    for (const item of pending ?? []) {
      const key = `${item.type}:${item.categoryId ?? UNCATEGORIZED}`;
      drafted.set(
        key,
        (drafted.get(key) ?? 0) + toMonthly(item.amount, item.frequency),
      );
    }
    // Paused last within each group — they don't count toward any total, so
    // they shouldn't sit between the plans that do.
    const byActive = (a: RecurringTx, b: RecurringTx) =>
      Number(b.isActive) - Number(a.isActive);

    const progress = new Map((fixedCosts ?? []).map((fc) => [fc.categoryId, fc]));
    const groups = new Map<string, { fc?: FixedCost; items: RecurringTx[] }>();
    const incomePlans = new Map<string, RecurringTx[]>();
    for (const item of scoped) {
      // Absorbed by its sub-line row already — showing it again here would be
      // the same bill counted as two rows.
      if (linkedRecurringIds.has(item.id)) continue;
      const key = item.categoryId ?? UNCATEGORIZED;
      if (item.type === "income") {
        const plans = incomePlans.get(key) ?? [];
        plans.push(item);
        incomePlans.set(key, plans);
        continue;
      }
      if (item.type !== "expense") continue;
      const group = groups.get(key) ?? { fc: progress.get(key), items: [] };
      group.items.push(item);
      groups.set(key, group);
    }
    // Biggest monthly commitment first; a category whose plans are all paused
    // carries no fixed cost and sinks to the bottom rather than vanishing.
    const ordered: FixedCostGroup[] = [...groups.entries()]
      .map(([categoryId, group]) => {
        const items = [...group.items].sort(byActive);
        const extra = drafted.get(`expense:${categoryId}`) ?? 0;
        return {
          categoryId,
          items,
          fc:
            extra === 0
              ? group.fc
              : {
                  ...(group.fc ??
                    blankFixedCost(categoryId, items, t("common.uncategorized"))),
                  monthlyAmount: (group.fc?.monthlyAmount ?? 0) + extra,
                },
        };
      })
      .sort((a, b) => (b.fc?.monthlyAmount ?? 0) - (a.fc?.monthlyAmount ?? 0));

    // The same shape for income. A yearly plan's line carries the year's own
    // expected/received so a year-scoped row measures a year rather than
    // repeating one month twelve times; a monthly plan has no year half, and
    // never renders in year scope anyway, so the month's figures stand.
    const lines = incomeLines ?? [];
    const scopeOf = (line: IncomeLine) => (yearScope && line.year) || line;
    const lineIds = new Set(lines.map((l) => l.categoryId));
    const incomeRows: IncomeGroup[] = [
      ...lines.map((line) => ({
        categoryId: line.categoryId,
        line,
        expected:
          scopeOf(line).expected + (drafted.get(`income:${line.categoryId}`) ?? 0),
        received: scopeOf(line).received,
        items: [...(incomePlans.get(line.categoryId) ?? [])].sort(byActive),
      })),
      // A category whose income plans are all paused gets no line — it expects
      // nothing this period — but keeps its row so those plans stay reachable,
      // exactly as a fully-paused fixed-cost category does.
      ...[...incomePlans.entries()]
        .filter(([categoryId]) => !lineIds.has(categoryId))
        .map(([categoryId, items]) => ({
          categoryId,
          expected: drafted.get(`income:${categoryId}`) ?? 0,
          received: 0,
          items: [...items].sort(byActive),
        })),
      // Biggest earner first, paused categories last on an expected of zero.
    ].sort((a, b) => b.expected - a.expected);

    return {
      incomeGroups: incomeRows,
      expenseGroups: ordered,
      showAccount: new Set(scoped.map((i) => i.accountId)).size > 1,
    };
  }, [
    allItems,
    pending,
    pendingIds,
    planAccountIds,
    fixedCosts,
    incomeLines,
    yearScope,
    linkedRecurringIds,
    t,
  ]);

  const handleSubmit = async (payload: Record<string, unknown>) => {
    // A create goes to the draft when the caller keeps one; so does an edit of
    // a plan that only lives there. Anything else is a real row, and writes.
    if (draftCreates && (!editing || pendingIds.has(editing.id))) {
      const tx = draftTx(
        payload,
        editing?.id ?? `draft:${crypto.randomUUID()}`,
        accounts,
        categories,
      );
      if (editing) draftCreates.update(tx);
      else draftCreates.add(tx);
    } else {
      await (editing
        ? updateRecurring.mutateAsync({ id: editing.id, ...payload })
        : createRecurring.mutateAsync(payload));
    }
    setDialogOpen(false);
    setEditing(null);
    setPrefill(null);
    setAddUnder(null);
  };

  // `mutate`, not `mutateAsync` — these fire from a row with nothing awaiting
  // them, so a failed request belongs in the mutation's error state rather
  // than an unhandled rejection.
  const rowProps: PlanRowProps = {
    showAccount,
    pendingIds,
    onEdit: (item) => {
      setEditing(item);
      setAddUnder(null);
      setDialogOpen(true);
    },
    onDelete: (id) =>
      pendingIds.has(id) ? draftCreates?.remove(id) : deleteRecurring.mutate(id),
    onToggle: (item) =>
      updateRecurring.mutate({ id: item.id, isActive: !item.isActive }),
  };

  return {
    incomeGroups,
    expenseGroups,
    rowProps,
    /** Open the form for a new plan; a category locks the picker to it. */
    addUnderCategory: (categoryId: string | null, type: "income" | "expense") => {
      setEditing(null);
      setPrefill(null);
      setAddUnder({ categoryId, type });
      setDialogOpen(true);
    },
    /**
     * Add/edit form for both kinds of plan — the form itself picks income or
     * expense. Rendered in the list header: it is also what the pencil on a
     * row opens, so it has to be mounted whichever period is on screen.
     */
    formDialog: (
      <RecurringFormDialog
        open={dialogOpen}
        onOpenChange={(next) => {
          setDialogOpen(next);
          if (!next) {
            setEditing(null);
            setPrefill(null);
            setAddUnder(null);
          }
        }}
        editing={editing}
        prefill={prefill}
        // Only a seeded create knows which side it is: the plain "add" button
        // opens on expense, as it always has.
        defaultType={addUnder?.type ?? (prefill ? "income" : undefined)}
        accounts={planAccounts}
        accountNote={
          planAccountIds === null ? undefined : t("recurring.form.accountScopeNote")
        }
        categories={categories}
        lockedCategoryId={addUnder?.categoryId ?? undefined}
        onSubmit={handleSubmit}
        trigger={
          // Icon-only on a phone, like the other controls in that header — and
          // the repeat mark rather than a plus, because it shares the row with
          // "add category" and two plus buttons say nothing about which is which.
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-9 p-0 sm:h-8 sm:w-auto sm:px-3"
            aria-label={t("recurring.add")}
          >
            <Repeat className="h-3.5 w-3.5 sm:hidden" />
            <Plus className="hidden h-3.5 w-3.5 sm:mr-1.5 sm:inline" />
            <span className="hidden sm:inline">{t("recurring.add")}</span>
          </Button>
        }
      />
    ),
  };
}

/**
 * What the amount column would say if this plan ran every month — the figure
 * the whisper under it converts from. A "/2wk" of its own would be one more
 * unit on a page that already talks in months.
 */
const FREQ_SHORT_KEYS: Record<string, MessageKey> = {
  weekly: "recurring.perWeekShort",
  biweekly: "recurring.perTwoWeeksShort",
  monthly: "recurring.perMonthShort",
  yearly: "recurring.perYearShort",
};

/**
 * The recurring plans under a category — the same row as that category's
 * sub-lines, because that is what they are: a named part of what the category
 * costs. Only the controls differ, since a plan can be paused and a sub-line
 * cannot.
 *
 * The headline figure is the plan's MONTHLY equivalent, not what the bank will
 * actually take. The column it sits in is the category's monthly cap and the
 * sub-lines beside it are stored monthly too, so a yearly bill showing €600
 * here would read as blowing a €200 budget it in fact uses a quarter of. The
 * real charge and its period go underneath, where they answer "what leaves the
 * account" without pretending to answer "what does this cost a month".
 */
export function PlanRows({
  items,
  rowProps,
}: {
  items: RecurringTx[];
  /** Absent on the budget view: reading a month changes no plan. */
  rowProps?: PlanRowProps;
}) {
  return items.map((item) => <PlanRow key={item.id} item={item} {...rowProps} />);
}

function PlanRow({
  item,
  showAccount = false,
  pendingIds,
  onEdit,
  onDelete,
  onToggle,
  onFile,
}: { item: RecurringTx } & Partial<PlanRowProps>) {
  const { t, formatCurrency } = useI18n();
  const pending = pendingIds?.has(item.id) ?? false;

  return (
    <SubRow
      color={item.categoryColor}
      name={item.description}
      muted={!item.isActive}
      nameSuffix={
        <>
          {!item.isActive && <PausedBadge />}
          {/* Which account gets debited sits on the title line, not the meta
              line: it's the detail that decides whether a plan is affordable,
              and at the end of the meta line it was the first thing to
              truncate. */}
          {showAccount && item.accountName && (
            <span
              className="flex min-w-0 max-w-[9rem] shrink items-center gap-1 rounded border px-1.5 py-px text-[10px] text-muted-foreground"
              title={`${t("common.account")}: ${item.accountName}`}
            >
              <Wallet className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{item.accountName}</span>
            </span>
          )}
        </>
      }
      meta={<PlanMeta frequency={item.frequency} next={item.nextOccurrence} />}
      amount={formatCurrency(toMonthly(item.amount, item.frequency))}
      amountNote={
        item.frequency !== "monthly" && (
          <>
            {formatCurrency(Math.abs(item.amount))}
            {FREQ_SHORT_KEYS[item.frequency] && t(FREQ_SHORT_KEYS[item.frequency])}
          </>
        )
      }
      actions={
        onEdit && onDelete && onToggle ? (
        <>
          {/* The money argument, one click wide: this payment is under a
              category whose budget is the sum of its lines, so until it IS one
              its amount is in nothing the page adds up. */}
          {onFile && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => onFile(item)}
              aria-label={t("budgets.subLines.fileLabel", { name: item.description })}
              title={t("budgets.subLines.file")}
            >
              <ListPlus className="h-3.5 w-3.5" />
            </Button>
          )}
          {/* Nothing to pause on a plan that has not been written yet. */}
          {!pending && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => onToggle(item)}
            aria-label={
              item.isActive
                ? t("recurring.pauseLabel", { name: item.description })
                : t("recurring.resumeLabel", { name: item.description })
            }
            title={item.isActive ? t("recurring.pause") : t("recurring.resume")}
          >
            {item.isActive ? (
              <Pause className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            )}
          </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => onEdit(item)}
            aria-label={t("recurring.editLabel", { name: item.description })}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <ConfirmDeleteButton
            onConfirm={() => onDelete(item.id)}
            label={t("recurring.deleteLabel", { name: item.description })}
          />
        </>
        ) : undefined
      }
    />
  );
}

/**
 * A fixed-cost category as a budget line: the category's planned-vs-paid row,
 * with the recurring plans that produce it as its sub-lines.
 *
 * The same expandable row as an allocation — a fixed-cost category is spent
 * against like any other, so it owes the same facts and the same history. Its
 * plans hang under it inside its own bracket, the way an allocation's
 * sub-lines do.
 */
export function FixedCostRow({
  group,
  rowProps,
  split,
  card,
  onHistory,
}: {
  group: FixedCostGroup;
  /** Absent on the budget view: reading a month changes no plan. */
  rowProps?: PlanRowProps;
  /** Who carries this bill on a shared budget; see BudgetRow. */
  split?: SplitShare[];
  /** Draw a tile rather than a row; see BudgetRow. */
  card?: boolean;
  onHistory: (target: HistoryTarget) => void;
}) {
  const { t, plural, formatCurrency } = useI18n();
  const first = group.items[0];
  const { limit, spent, percentage, outstanding, status } = fixedCostStatus(group.fc);
  const settled = Math.abs(outstanding) < 0.01;
  const color = group.fc?.categoryColor || first.categoryColor || "#94a3b8";
  const name =
    group.fc?.categoryName || first.categoryName || t("common.uncategorized");

  return (
    <BudgetRow
      name={name}
      color={color}
      tone={status}
      card={card}
      percentage={percentage}
      spent={spent}
      limit={limit}
      split={split}
      unit={t("budgets.perMonthShort")}
      subNote={plural(
        group.items.length,
        "budgets.stat.recurringPayments.one",
        "budgets.stat.recurringPayments.other",
      )}
      delta={
        // A category whose plans are all paused owes nothing this month —
        // "paid" would be a lie, so it gets no note at all.
        limit === 0 && spent === 0
          ? ""
          : status === "exceeded"
            ? t("budgets.overAmount", { amount: formatCurrency(-outstanding) })
            : settled
              ? t("budgets.paid")
              : t("budgets.dueAmount", { amount: formatCurrency(outstanding) })
      }
      facts={
        <>
          {group.fc && group.fc.avgMonthly > 0 && (
            <span>
              {t("budgets.row.avgPerMonth", {
                amount: formatCurrency(group.fc.avgMonthly),
                months: group.fc.avgMonths,
              })}
            </span>
          )}
          <span>
            {t("budgets.row.pctUsed", { pct: Math.round(percentage) })}
          </span>
        </>
      }
      // Uncategorized plans have no category to look history up by.
      onHistory={
        group.categoryId === UNCATEGORIZED
          ? undefined
          : () =>
              onHistory({
                categoryId: group.categoryId,
                categoryName: name,
                categoryColor: color,
                amount: limit,
              })
      }
    >
      <PlanRows items={group.items} rowProps={rowProps} />
    </BudgetRow>
  );
}

/**
 * An income category as a budget line: what its recurring plans promise this
 * period against what actually landed, with those plans as its sub-lines.
 *
 * Deliberately the same row as a fixed cost — income is planned and then
 * reconciled exactly the way a bill is, so it should read the same way. Only
 * the direction of "good" flips: beating the plan is a windfall rather than an
 * overspend, which `incomeStatus` handles by topping out at emerald and never
 * reaching red. What a category expects IS the recurring income behind it, so
 * there is no amount of its own to edit: the plans hang under the row and each
 * one is edited where it is written.
 */
export function IncomeRow({
  group,
  rowProps,
  yearScope,
  card,
  onHistory,
}: {
  group: IncomeGroup;
  /** Absent on the budget view: reading a month changes no plan. */
  rowProps?: PlanRowProps;
  /** The figures are a whole year's when set — the row's unit says so. */
  yearScope?: boolean;
  /** Draw a tile rather than a row; see BudgetRow. */
  card?: boolean;
  onHistory: (target: HistoryTarget) => void;
}) {
  const { t, plural, formatCurrency } = useI18n();
  const first = group.items[0];
  const { expected, received, percentage, outstanding, status } =
    incomeStatus(group);
  const settled = Math.abs(outstanding) < 0.01;
  const color = group.line?.categoryColor || first?.categoryColor || "#94a3b8";
  // The API labels its no-category bucket in its own tongue; the list speaks
  // the user's, so that one row is named here rather than passed through.
  const name =
    group.categoryId === UNCATEGORIZED
      ? t("common.uncategorized")
      : group.line?.categoryName || first?.categoryName || t("common.uncategorized");

  return (
    <BudgetRow
      name={name}
      color={color}
      tone={status}
      card={card}
      percentage={percentage}
      spent={received}
      limit={expected}
      flow="income"
      unit={t(yearScope ? "budgets.perYearShort" : "budgets.perMonthShort")}
      subNote={plural(
        group.items.length,
        "budgets.stat.recurringPayments.one",
        "budgets.stat.recurringPayments.other",
      )}
      delta={
        // A category whose plans are all paused expects nothing this period —
        // "received" would claim a payday that was never planned.
        expected === 0 && received === 0
          ? ""
          : outstanding <= -0.01
            ? t("budgets.extraAmount", {
                amount: formatCurrency(-outstanding),
              })
            : settled
              ? t("budgets.received")
              : t("budgets.expectedAmount", {
                  amount: formatCurrency(outstanding),
                })
      }
      facts={
        <>
          {group.line && group.line.avgMonthly > 0 && (
            <span>
              {t("budgets.row.avgReceivedPerMonth", {
                amount: formatCurrency(group.line.avgMonthly),
                months: group.line.avgMonths,
              })}
            </span>
          )}
          <span>
            {t("budgets.row.pctReceived", { pct: Math.round(percentage) })}
          </span>
        </>
      }
      // Uncategorized plans have no category to look history up by.
      onHistory={
        group.categoryId === UNCATEGORIZED
          ? undefined
          : () =>
              onHistory({
                categoryId: group.categoryId,
                categoryName: name,
                categoryColor: color,
                // The history plots months, so it wants the monthly figure —
                // `expected` above may be a whole year's worth in year scope.
                amount: group.line?.expected ?? 0,
                kind: "income",
              })
      }
    >
      <PlanRows items={group.items} rowProps={rowProps} />
    </BudgetRow>
  );
}
