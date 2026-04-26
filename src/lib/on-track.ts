import type { SpikeOnTrack } from "@/types/api";

/**
 * Classify a spike's funding progress against its pay-cycle pace.
 *
 * Given a target (`targetAmount`) due over `totalPaydays` paychecks, the
 * "expected funded by now" is a linear interpolation: `slice * elapsedPaydays`,
 * capped at `targetAmount`. The spike is considered:
 *
 *   - "behind"  if funded < expected − slice
 *   - "ahead"   if funded > expected + slice
 *   - "on_pace" otherwise (i.e. within ±1 slice of the expected value, inclusive)
 *
 * Returns `{ expectedFundedByNow: 0, onTrack: "on_pace" }` if the schedule is
 * degenerate (no paydays in the cycle, or zero target amount).
 */
export function classifyOnTrack(args: {
  fundedAmount: number;
  targetAmount: number;
  totalPaydays: number;
  elapsedPaydays: number;
}): { expectedFundedByNow: number; onTrack: SpikeOnTrack } {
  const { fundedAmount, targetAmount, totalPaydays, elapsedPaydays } = args;

  if (totalPaydays === 0 || targetAmount === 0) {
    return { expectedFundedByNow: 0, onTrack: "on_pace" };
  }

  const slice = targetAmount / totalPaydays;
  const expectedFundedByNow = Math.min(targetAmount, slice * elapsedPaydays);

  let onTrack: SpikeOnTrack;
  if (fundedAmount < expectedFundedByNow - slice) onTrack = "behind";
  else if (fundedAmount > expectedFundedByNow + slice) onTrack = "ahead";
  else onTrack = "on_pace";

  return { expectedFundedByNow, onTrack };
}
