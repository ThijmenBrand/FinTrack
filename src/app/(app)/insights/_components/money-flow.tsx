"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { layoutSankey } from "@/lib/sankey";
import { formatCurrency } from "@/lib/utils";
import type { MoneyFlowData } from "@/types/api";

interface MoneyFlowProps {
  data: MoneyFlowData | undefined;
  isLoading: boolean;
}

const WIDTH = 900;
const MARGIN_LEFT = 118;
const MARGIN_RIGHT = 150;
const NODE_WIDTH = 12;
const ROW = 30;

// Labels sit on top of the ribbons in the middle columns, so they're painted
// with a card-coloured outline to stay legible.
const LABEL_STYLE = {
  paintOrder: "stroke" as const,
  stroke: "var(--card)",
  strokeWidth: 3,
  strokeLinejoin: "round" as const,
};

/**
 * Where the money came from, which account it landed in, and where it left to —
 * a Sankey across income sources → accounts → spending categories, with
 * account-to-account ribbons for internal transfers.
 */
export function MoneyFlow({ data, isLoading }: MoneyFlowProps) {
  const [hovered, setHovered] = useState<string | null>(null);

  const height = Math.max(
    320,
    Math.min(760, (data?.nodes.length ?? 0) * ROW),
  );

  const layout = useMemo(
    () =>
      layoutSankey(data?.nodes ?? [], data?.links ?? [], {
        width: WIDTH - MARGIN_LEFT - MARGIN_RIGHT,
        height,
        nodeWidth: NODE_WIDTH,
      }),
    [data, height],
  );

  const nodeById = useMemo(
    () => new Map(layout.nodes.map((n) => [n.id, n])),
    [layout],
  );
  const maxDepth = Math.max(0, ...layout.nodes.map((n) => n.depth));
  const active = (id: string) => hovered === null || hovered === id;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-baseline justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="text-base">Money flow</CardTitle>
        <span className="text-xs text-muted-foreground">
          income → accounts → spending · net of reimbursements and refunds
        </span>
      </CardHeader>
      <CardContent>
        {isLoading && !data ? (
          <p className="text-muted-foreground text-sm py-8 text-center">
            Following the money…
          </p>
        ) : layout.nodes.length === 0 ? (
          <p className="text-muted-foreground text-sm py-8 text-center">
            No flows to show for this period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <svg
              viewBox={`0 0 ${WIDTH} ${height + 16}`}
              className="w-full min-w-[720px]"
              role="img"
              aria-label="Money flow diagram"
            >
              <g transform={`translate(${MARGIN_LEFT}, 8)`}>
                {layout.links.map((l) => (
                  <path
                    key={`${l.source} ${l.target}`}
                    d={l.path}
                    fill="none"
                    stroke={nodeById.get(l.source)?.color ?? "currentColor"}
                    strokeWidth={l.width}
                    className="transition-opacity"
                    opacity={active(l.source) || active(l.target) ? 0.42 : 0.08}
                    onMouseEnter={() => setHovered(l.source)}
                    onMouseLeave={() => setHovered(null)}
                  >
                    <title>
                      {`${nodeById.get(l.source)?.name} → ${
                        nodeById.get(l.target)?.name
                      }: ${formatCurrency(l.value)}`}
                    </title>
                  </path>
                ))}

                {layout.nodes.map((n) => {
                  // First column labels outside on the left, everything else to
                  // the right of its bar.
                  const leftLabel = n.depth === 0 && maxDepth > 0;
                  return (
                    <g
                      key={n.id}
                      onMouseEnter={() => setHovered(n.id)}
                      onMouseLeave={() => setHovered(null)}
                    >
                      <rect
                        x={n.x0}
                        y={n.y0}
                        width={n.x1 - n.x0}
                        height={Math.max(n.y1 - n.y0, 1)}
                        fill={n.color ?? "currentColor"}
                        rx={2}
                      >
                        <title>{`${n.name}: ${formatCurrency(n.value)}`}</title>
                      </rect>
                      <text
                        x={leftLabel ? n.x0 - 8 : n.x1 + 8}
                        y={(n.y0 + n.y1) / 2}
                        textAnchor={leftLabel ? "end" : "start"}
                        dominantBaseline="middle"
                        className="fill-foreground text-[11px]"
                        style={LABEL_STYLE}
                        opacity={active(n.id) ? 1 : 0.35}
                      >
                        {n.name}
                        <tspan className="fill-muted-foreground" dx={6}>
                          {formatCurrency(n.value)}
                        </tspan>
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
