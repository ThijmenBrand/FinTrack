/**
 * The line the pot dialog draws, per phase: what has been set aside while a
 * pot saves toward its date, what has been spent against the budget once it
 * is being spent, and the running net for a pot with no budget at all.
 */
import type { PotPhase } from "@/lib/pot-budget";
import type { PotAllocationEvent, PotLinkedTransaction } from "@/types/api";

export interface SaldoPoint {
  date: string;
  value: number;
}

export interface PotGraph {
  series: SaldoPoint[];
  /** Dashed pace line: the payday schedule while saving. */
  expected?: SaldoPoint[];
  /** Horizontal reference: the total. */
  target: number | null;
}

interface GraphInput {
  phase: PotPhase;
  createdAt: string;
  targetAmount: number | null;
  fundedAmount: number;
  allocations: readonly PotAllocationEvent[];
  transactions: readonly Pick<PotLinkedTransaction, "date" | "amount" | "type">[];
  paydaySchedule?: readonly { date: string; expectedFunded: number }[];
  todayIso: string;
}

const byDate = <T extends { date: string }>(rows: readonly T[]) =>
  [...rows].sort((a, b) => a.date.localeCompare(b.date));

export function potGraph(input: GraphInput): PotGraph {
  const { phase, createdAt, targetAmount, todayIso } = input;
  const start = createdAt.slice(0, 10);

  if (phase === "saving") {
    const series: SaldoPoint[] = [{ date: start, value: 0 }];
    for (const a of input.allocations) series.push({ date: a.date.slice(0, 10), value: a.fundedAfter });
    if (series[series.length - 1].date < todayIso) series.push({ date: todayIso, value: input.fundedAmount });
    const expected = input.paydaySchedule?.length
      ? [{ date: start, value: 0 }, ...input.paydaySchedule.map((p) => ({ date: p.date, value: p.expectedFunded }))]
      : undefined;
    return { series, expected, target: targetAmount };
  }

  if (phase === "spending") {
    // Cumulative spend, the way the budget counts it: no funding transfers,
    // refunds taking it back down.
    const series: SaldoPoint[] = [];
    let spent = 0;
    for (const t of byDate(input.transactions)) {
      if (t.type === "internal_transfer") continue;
      spent -= t.amount;
      series.push({ date: t.date, value: Math.round(spent * 100) / 100 });
    }
    return { series, target: targetAmount };
  }

  const series: SaldoPoint[] = [];
  let running = 0;
  for (const t of byDate(input.transactions)) {
    running += t.amount;
    series.push({ date: t.date, value: running });
  }
  return { series, target: null };
}
