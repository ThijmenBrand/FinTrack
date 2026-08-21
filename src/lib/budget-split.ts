import type { Account, BudgetPlanData } from "@/types/api";

/**
 * The cost-split key of a shared budget: the owner carries
 * `ownerSharePercent` of every budgeted euro, each person the plan is shared
 * with carries their own percentage (keyed by the address they were invited
 * on). Together they add up to 100. It is a lens on the same numbers —
 * allocations and spend are stored and tracked whole — so nothing here writes.
 */

/**
 * Whether the split key means anything for this plan yet: it either reaches
 * the caller through somebody else's account, or one of the caller's own
 * accounts in it is shared out.
 */
export function planIsShared(
  plan: Pick<BudgetPlanData, "role" | "accounts">,
  accounts: Pick<Account, "id" | "sharedWith">[],
): boolean {
  if (plan.role !== "owner") return true;
  const ids = new Set(plan.accounts.map((a) => a.id));
  return accounts.some((a) => ids.has(a.id) && a.sharedWith > 0);
}

/**
 * Resolve each member's percentage. Stored keys win; whoever has none (a
 * freshly invited person, or a plan whose key was never edited) splits what
 * the owner leaves evenly — which for a single member is the old
 * `100 - ownerSharePercent`.
 */
export function memberSharePercents(
  emails: string[],
  ownerSharePercent: number,
  stored: Record<string, number> | null | undefined,
): Record<string, number> {
  const set = emails.filter((e) => typeof stored?.[e] === "number");
  // Sorted so every side of the share lands on the same rounding.
  const unset = emails.filter((e) => typeof stored?.[e] !== "number").sort();
  const left = Math.max(
    0,
    100 - ownerSharePercent - set.reduce((sum, e) => sum + stored![e], 0),
  );
  const each = Math.floor(left / (unset.length || 1));
  return Object.fromEntries(
    emails.map((e) => [
      e,
      stored?.[e] ??
        // The first of an uneven split carries the leftover percent, so the
        // shares still add back to the whole budget.
        (e === unset[0] ? left - each * (unset.length - 1) : each),
    ]),
  );
}

/**
 * An even key across the owner and `memberCount` other people — what the
 * "split evenly" shortcut fills the fields with. The owner absorbs the
 * remainder of a division that doesn't come out whole, so three people get
 * 34/33/33 rather than 33/33/33 and a budget that is 1% short of itself.
 */
export function evenSplitPercents(memberCount: number): {
  owner: number;
  each: number;
} {
  const each = Math.floor(100 / (memberCount + 1));
  return { owner: 100 - each * memberCount, each };
}

/** The caller's slice of an amount budgeted for (or spent on) a shared plan. */
export function callerShareOf(
  amount: number,
  plan: Pick<BudgetPlanData, "sharePercent">,
): number {
  return (amount * plan.sharePercent) / 100;
}

/** One person carrying part of a shared budget, as a budget row shows them. */
export interface SplitShare {
  /** What to call them on the row — a display name, or the caller's own "You". */
  name: string;
  percent: number;
}

/**
 * Everyone this plan is divided between, owner first, for the per-category
 * split under each budget row. Empty when there is nobody to divide with: one
 * column of 100% would only repeat the amount beside it.
 *
 * A plan reached through somebody else's account knows only two of the
 * percentages — the owner's, and the caller's own; the other members' invite
 * addresses are deliberately not sent to them. Whatever is left over is named
 * as one anonymous remainder rather than guessed at, so the columns still add
 * back to the whole budget without inventing people.
 */
export function splitShares(
  plan: Pick<
    BudgetPlanData,
    | "role"
    | "accounts"
    | "ownerName"
    | "ownerSharePercent"
    | "sharePercents"
    | "sharePercent"
  >,
  accounts: Pick<Account, "id" | "sharedWith" | "sharedWithUsers">[],
  labels: { you: string; others: string },
): SplitShare[] {
  if (!planIsShared(plan, accounts)) return [];

  if (plan.role !== "owner") {
    const rest = 100 - plan.ownerSharePercent - plan.sharePercent;
    return [
      { name: plan.ownerName ?? labels.others, percent: plan.ownerSharePercent },
      { name: labels.you, percent: plan.sharePercent },
      ...(rest > 0 ? [{ name: labels.others, percent: rest }] : []),
    ];
  }

  // Deduped the same way the plan dialog does it, and kept in the same order:
  // one address may hold invites on several of the plan's accounts, but it
  // carries one share of the budget.
  const ids = new Set(plan.accounts.map((a) => a.id));
  const people = [
    ...new Map(
      accounts
        .filter((a) => ids.has(a.id))
        .flatMap((a) => a.sharedWithUsers)
        .flatMap((u) => (u.email ? [[u.email, u] as const] : [])),
    ).values(),
  ];
  if (people.length === 0) return [];

  const resolved = memberSharePercents(
    people.map((p) => p.email as string),
    plan.ownerSharePercent,
    plan.sharePercents,
  );
  return [
    { name: labels.you, percent: plan.ownerSharePercent },
    ...people.map((p) => ({
      // A pending invite has no name yet — the address is who they are so far.
      name: p.name || (p.email as string),
      percent: resolved[p.email as string] ?? 0,
    })),
  ];
}
