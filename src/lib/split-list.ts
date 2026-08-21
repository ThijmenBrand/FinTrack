import { sql, inArray, or, type SQL } from "drizzle-orm";
import { transactions } from "@/db/schema";
import type { ParsedSearch } from "@/lib/search-query";

/**
 * Category filters match a row's own `categoryId` (or, for a pot member, the
 * pot's category). A split parent has neither — its category is cleared on
 * split — but the list must still show it when the match lives on one of its
 * hidden children. True when the outer `transactions` row is a split parent
 * with at least one child whose own category (or pot) is in `categoryIds`.
 */
export function parentHasChildInCategories(categoryIds: string[]): SQL {
  return sql`(${transactions.isSplitParent} = 1 AND EXISTS (
    SELECT 1 FROM transactions c
    WHERE c.parent_transaction_id = ${transactions.id}
      AND c.user_id = "transactions"."user_id"
      AND (${inArray(sql`c.category_id`, categoryIds)}
        OR c.group_id IN (
          SELECT g.id FROM transaction_groups g
          WHERE g.user_id = c.user_id AND ${inArray(sql`g.category_id`, categoryIds)}
        ))
  ))`;
}

/** Same idea for `uncategorized=true`: a child with no category of its own. */
export function parentHasUncategorizedChild(): SQL {
  return sql`(${transactions.isSplitParent} = 1 AND EXISTS (
    SELECT 1 FROM transactions c
    WHERE c.parent_transaction_id = ${transactions.id}
      AND c.user_id = "transactions"."user_id"
      AND c.category_id IS NULL
  ))`;
}

/** The free-text search's own OR-branches (text/amount/date), rebuilt against
 * a correlated row alias. All values travel as bound params; `alias` is
 * always a hardcoded literal from this file, never user input. */
function searchBranches(alias: "c" | "p", parsed: ParsedSearch): SQL[] {
  const branches: SQL[] = [];
  if (parsed.text) {
    const pattern = `%${parsed.text}%`;
    branches.push(
      alias === "c"
        ? sql`(c.description LIKE ${pattern} OR c.name LIKE ${pattern})`
        : sql`(p.description LIKE ${pattern} OR p.name LIKE ${pattern})`,
    );
  }
  if (parsed.amount) {
    branches.push(
      alias === "c"
        ? sql`ABS(c.amount) BETWEEN ${parsed.amount.min} AND ${parsed.amount.max}`
        : sql`ABS(p.amount) BETWEEN ${parsed.amount.min} AND ${parsed.amount.max}`,
    );
  }
  if (parsed.date) {
    const datePattern = `${parsed.date}%`;
    branches.push(alias === "c" ? sql`c.date LIKE ${datePattern}` : sql`p.date LIKE ${datePattern}`);
  }
  return branches;
}

/**
 * Same idea as `parentHasChildInCategories`, for the free-text `search`
 * filter: a split parent has no useful text of its own for a match that only
 * lives on a hidden child (e.g. a child description edited to "beer"), so the
 * list must show the parent when ANY child matches the parsed search.
 */
export function parentHasChildMatchingSearch(parsed: ParsedSearch): SQL | null {
  const branches = searchBranches("c", parsed);
  if (!branches.length) return null;
  return sql`(${transactions.isSplitParent} = 1 AND EXISTS (
    SELECT 1 FROM transactions c
    WHERE c.parent_transaction_id = ${transactions.id}
      AND c.user_id = "transactions"."user_id"
      AND (${or(...branches)})
  ))`;
}

/**
 * The totals counterpart: a search that only matches the PARENT's own fields
 * (e.g. an amount search hitting the parent's total, not any individual
 * child's slice) must still count every child once the parent is listed —
 * otherwise totals show €0 for a family the list just surfaced. True when the
 * outer `transactions` row's parent matches the parsed search.
 */
export function childHasParentMatchingSearch(parsed: ParsedSearch): SQL | null {
  const branches = searchBranches("p", parsed);
  if (!branches.length) return null;
  return sql`EXISTS (
    SELECT 1 FROM transactions p
    WHERE p.id = ${transactions.parentTransactionId}
      AND p.user_id = "transactions"."user_id"
      AND (${or(...branches)})
  )`;
}
