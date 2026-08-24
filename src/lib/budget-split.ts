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

/** One person carrying part of a shared budget, as a budget row shows them. */
export interface SplitShare {
  /** What to call them on the row — a display name, or the caller's own "You". */
  name: string;
  /** A face for the row, where we have one. Absent on an anonymous remainder. */
  image?: string | null;
  /** Share of the whole budget — derived from the euros in amount mode. */
  percent: number;
  /** The euros they carry of the period on screen. */
  amount: number;
  /** Their figure is whatever the fixed shares leave, so it moves with the plan. */
  rest: boolean;
  /** The caller's own row, so a view can mark it without matching on the name. */
  isYou: boolean;
}

/** Cents, not floats: money is compared and added up all over this app. */
const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * One row of a key being handed its euros: the fixed amounts it carries, and
 * how many of the people in it are on "the rest" instead. A row is usually one
 * person, but the anonymous remainder a shared-in viewer sees can stand for
 * several.
 */
interface SplitPart {
  fixed: number;
  restCount: number;
}

/**
 * Hand `total` out over the key. Whoever carries a fixed amount gets exactly
 * that; everyone left on the rest splits what those leave, evenly — which is
 * "A pays 600, B pays the rest" for a pair, and an even split when nobody is
 * fixed at all.
 *
 * Two deliberate edges. Fixed amounts adding up past the budget leave the rest
 * at zero rather than going negative: nobody is owed money for being in a
 * household, and the section that draws this reports the overrun in words.
 * And the cents a division doesn't come out on go to the first person on the
 * rest, so the column still adds back to the budget above it.
 */
function shareOut(parts: SplitPart[], total: number): number[] {
  const fixedTotal = parts.reduce((sum, p) => sum + p.fixed, 0);
  const restCount = parts.reduce((sum, p) => sum + p.restCount, 0);
  const rest = Math.max(0, cents(total - fixedTotal));
  const each = restCount > 0 ? Math.floor((rest / restCount) * 100) / 100 : 0;
  let leftover = cents(rest - each * restCount);

  return parts.map((part) => {
    if (part.restCount === 0) return cents(part.fixed);
    const amount = cents(part.fixed + each * part.restCount + leftover);
    leftover = 0;
    return amount;
  });
}

/** The euros of a key, as a percentage of the budget they were taken from. */
const asPercent = (amount: number, total: number) =>
  total > 0 ? (amount / total) * 100 : 0;

/**
 * Everyone this plan is divided between, owner first: what each of them
 * carries of `total` (the period's whole budget), as euros and as a share.
 * Empty when there is nobody to divide with — one row of 100% would only
 * repeat the amount beside it.
 *
 * A plan reached through somebody else's account knows only two of the key's
 * entries — the owner's, and the caller's own; the other members' invite
 * addresses are deliberately not sent to them. Whatever is left over is named
 * as one anonymous remainder rather than guessed at, so the rows still add
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
    | "splitMode"
    | "ownerShareAmount"
    | "shareAmounts"
    | "shareAmount"
    | "others"
  >,
  accounts: Pick<Account, "id" | "sharedWith" | "sharedWithUsers">[],
  labels: { you: string; others: string },
  /** What the period on screen costs in total — what the key is applied to. */
  total: number,
): SplitShare[] {
  if (!planIsShared(plan, accounts)) return [];
  const byAmount = plan.splitMode === "amount";
  /** A fixed euro amount as a part; null (nobody set one) as a rest-taker. */
  const part = (fixed: number | null | undefined): SplitPart =>
    fixed == null ? { fixed: 0, restCount: 1 } : { fixed, restCount: 0 };

  if (plan.role !== "owner") {
    const ownerName = plan.ownerName ?? labels.others;
    if (byAmount) {
      const parts = [
        part(plan.ownerShareAmount),
        part(plan.shareAmount),
        { fixed: plan.others.fixedAmount, restCount: plan.others.restCount },
      ];
      const [owner, mine, others] = shareOut(parts, total);
      return [
        row(ownerName, owner, total, plan.ownerShareAmount == null, false),
        row(labels.you, mine, total, plan.shareAmount == null, true),
        // The people behind this row carry nothing at all on a two-party plan,
        // and a zero row would read as a third person who pays nothing.
        ...(others > 0
          ? [row(labels.others, others, total, plan.others.restCount > 0, false)]
          : []),
      ];
    }
    const restPct = 100 - plan.ownerSharePercent - plan.sharePercent;
    return [
      pctRow(ownerName, plan.ownerSharePercent, total, false),
      pctRow(labels.you, plan.sharePercent, total, true),
      ...(restPct > 0 ? [pctRow(labels.others, restPct, total, false)] : []),
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
  // A pending invite has no name yet — the address is who they are so far.
  const nameOf = (p: (typeof people)[number]) => p.name || (p.email as string);

  if (byAmount) {
    // A member with no entry of their own is on the rest, exactly like a
    // member with no percentage falls back to a slice of what the owner
    // leaves: somebody invited after the key was written is never silently
    // set to nothing.
    const fixedOf = (email: string) => plan.shareAmounts[email];
    const amounts = shareOut(
      [plan.ownerShareAmount, ...people.map((p) => fixedOf(p.email as string))].map(part),
      total,
    );
    return [
      row(labels.you, amounts[0], total, plan.ownerShareAmount == null, true),
      ...people.map((p, i) =>
        row(
          nameOf(p),
          amounts[i + 1],
          total,
          fixedOf(p.email as string) == null,
          false,
          p.image,
        ),
      ),
    ];
  }

  const resolved = memberSharePercents(
    people.map((p) => p.email as string),
    plan.ownerSharePercent,
    plan.sharePercents,
  );
  return [
    pctRow(labels.you, plan.ownerSharePercent, total, true),
    ...people.map((p) =>
      pctRow(nameOf(p), resolved[p.email as string] ?? 0, total, false, p.image),
    ),
  ];
}

/** A row of an amount-mode key. */
function row(
  name: string,
  amount: number,
  total: number,
  rest: boolean,
  isYou: boolean,
  image?: string | null,
): SplitShare {
  return { name, image, amount, percent: asPercent(amount, total), rest, isYou };
}

/** A row of a percentage key, where the euros are what gets derived. */
function pctRow(
  name: string,
  percent: number,
  total: number,
  isYou: boolean,
  image?: string | null,
): SplitShare {
  return {
    name,
    image,
    percent,
    amount: cents((total * percent) / 100),
    rest: false,
    isYou,
  };
}
