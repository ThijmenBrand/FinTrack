import type { BatchItem } from "drizzle-orm/batch";
import { db } from "@/db";

type Slot = BatchItem<"sqlite"> | null;

/**
 * `db.batch` with optional slots.
 *
 * Against hosted libsql every awaited statement is a network round trip, so a
 * route that asks four questions in four `await`s spends four times the
 * latency before it can answer. `db.batch` sends them together — but it takes
 * a non-empty list, and a route often has a query it only *sometimes* needs
 * (a comparison period the caller didn't ask for, labels for a breakdown that
 * came back empty).
 *
 * Pass `null` for a slot that isn't wanted and `null` comes back in its place,
 * positionally, so callers can keep destructuring. Whatever is left travels in
 * one round trip; a call with nothing in it makes no round trip at all.
 */
export async function batchOptional<T extends readonly Slot[]>(
  ...slots: T
): Promise<{ -readonly [K in keyof T]: Awaited<NonNullable<T[K]>> | null }> {
  const present = slots.filter((q): q is BatchItem<"sqlite"> => q != null);
  if (present.length === 0) {
    return slots.map(() => null) as never;
  }
  const results = await db.batch(
    present as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
  );
  let next = 0;
  return slots.map((q) => (q == null ? null : results[next++])) as never;
}
