"use client";

import { useMemo } from "react";
import { ChevronRight } from "lucide-react";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import type { MoneyFlowData } from "@/types/api";

interface MoneyFlowProps {
  data: MoneyFlowData | undefined;
  isLoading: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Leg = { id: string; name: string; color: string; value: number };

const total = (legs: Leg[]) => legs.reduce((s, l) => s + l.value, 0);
const bySize = (a: Leg, b: Leg) => b.value - a.value;

function Legs({
  title,
  legs,
  max,
}: {
  title: string;
  legs: Leg[];
  max: number;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-baseline justify-between gap-2 border-b pb-1">
        <span className="text-xs font-medium text-muted-foreground">
          {title}
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {formatCurrency(total(legs))}
        </span>
      </div>
      {legs.length === 0 ? (
        <p className="py-1 text-sm text-muted-foreground">Nothing this period</p>
      ) : (
        legs.map((leg) => (
          <div
            key={leg.id}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 py-1"
          >
            <span className="min-w-0 truncate text-sm">{leg.name}</span>
            <span className="text-right text-sm tabular-nums whitespace-nowrap">
              {formatCurrency(leg.value)}
            </span>
            <div className="col-span-2 h-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${(leg.value / max) * 100}%`,
                  backgroundColor: leg.color,
                }}
              />
            </div>
          </div>
        ))
      )}
    </div>
  );
}

/**
 * Where the money came from and where it left to, per account: income sources
 * and incoming transfers on one side, spending categories and outgoing
 * transfers on the other. Bars are scaled across the whole period, so a leg's
 * width is comparable between accounts.
 */
export function MoneyFlow({
  data,
  isLoading,
  open,
  onOpenChange,
}: MoneyFlowProps) {
  const { groups, max } = useMemo(() => {
    const nodes = new Map((data?.nodes ?? []).map((n) => [n.id, n]));
    const links = data?.links ?? [];
    const leg = (id: string, value: number): Leg => {
      const node = nodes.get(id);
      return {
        id,
        name: node?.name ?? "Unknown",
        color: node?.color ?? "currentColor",
        value,
      };
    };
    const groups = (data?.nodes ?? [])
      .filter((n) => n.kind === "account")
      .map((account) => ({
        account,
        inLegs: links
          .filter((l) => l.target === account.id)
          .map((l) => leg(l.source, l.value))
          .sort(bySize),
        outLegs: links
          .filter((l) => l.source === account.id)
          .map((l) => leg(l.target, l.value))
          .sort(bySize),
      }))
      .sort(
        (a, b) =>
          total(b.inLegs) +
          total(b.outLegs) -
          total(a.inLegs) -
          total(a.outLegs),
      );
    return { groups, max: Math.max(1, ...links.map((l) => l.value)) };
  }, [data]);

  return (
    <Card>
      {/* ponytail: native <details> — no collapsible primitive in the UI kit. */}
      <details
        open={open}
        onToggle={(e) => onOpenChange(e.currentTarget.open)}
        className="group"
      >
        <summary className="flex cursor-pointer list-none flex-row flex-wrap items-baseline gap-2 px-6 py-5 [&::-webkit-details-marker]:hidden">
          <ChevronRight className="h-4 w-4 shrink-0 self-center text-muted-foreground transition-transform group-[[open]]:rotate-90" />
          <CardTitle className="text-base">Money flow</CardTitle>
          <span className="text-xs text-muted-foreground">
            per account: what came in, where it left to · net of reimbursements
          </span>
        </summary>
        <CardContent>
          {isLoading && !data ? (
            <p className="text-muted-foreground text-sm py-8 text-center">
              Following the money…
            </p>
          ) : groups.length === 0 ? (
            <p className="text-muted-foreground text-sm py-8 text-center">
              No flows to show for this period.
            </p>
          ) : (
            <div className="space-y-6">
              {groups.map(({ account, inLegs, outLegs }) => (
                <div key={account.id}>
                  <p className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: account.color }}
                    />
                    {account.name}
                  </p>
                  <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                    <Legs title="In" legs={inLegs} max={max} />
                    <Legs title="Out" legs={outLegs} max={max} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </details>
    </Card>
  );
}
