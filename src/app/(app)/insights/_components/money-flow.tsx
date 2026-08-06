"use client";

import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { layoutSankey, type SankeyNode } from "@/lib/sankey";
import { formatCurrency } from "@/lib/utils";
import type { MoneyFlowData } from "@/types/api";

interface MoneyFlowProps {
  data: MoneyFlowData | undefined;
  isLoading: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opens the transactions list with these filters. */
  onSelect: (filters: Record<string, string>) => void;
}

// Width of the diagram itself; the label gutters are measured from the labels
// and added on top, so a long account name widens the SVG instead of clipping.
const INNER_WIDTH = 620;
const NODE_WIDTH = 12;
/** Enough for an 11px label plus the gap under it. */
const MIN_NODE_HEIGHT = 18;
const ROW = 34;
const CHAR_W = 6; // ~advance of the 11px label font
const MAX_NAME = 24;

const shortName = (name: string) =>
  name.length > MAX_NAME ? `${name.slice(0, MAX_NAME - 1)}…` : name;

const gutter = (nodes: { name: string; value: number }[]) =>
  Math.max(
    100,
    ...nodes.map(
      (n) =>
        (shortName(n.name).length + formatCurrency(n.value).length + 1) *
          CHAR_W +
        16,
    ),
  );

// Labels sit on top of the ribbons in the middle columns, so they're painted
// with a card-coloured outline to stay legible.
const LABEL_STYLE = {
  paintOrder: "stroke" as const,
  stroke: "var(--card)",
  strokeWidth: 3,
  strokeLinejoin: "round" as const,
};

/**
 * The transactions filters a node or ribbon stands for, or null for the
 * aggregate ones ("Other income", "Left in account", uncategorized) that no
 * filter can reproduce. Node ids come from buildMoneyFlow: `in:`/`cat:` +
 * category id, or `acct:` + account id for transfers. A null `accountId`
 * widens the filter to every account — that's a node click, where no single
 * account is implied.
 */
export function legFilters(
  accountId: string | null,
  nodeId: string,
): Record<string, string> | null {
  const sep = nodeId.indexOf(":");
  const kind = nodeId.slice(0, sep);
  const id = nodeId.slice(sep + 1);
  const account: Record<string, string> = accountId
    ? { account: accountId }
    : {};
  if (kind === "acct")
    return id === "external" || !accountId
      ? null
      : { ...account, type: "internal_transfer" };
  if (id === "__reimb") return { ...account, type: "reimbursement" };
  if (id === "none" || id === "other" || id.startsWith("__")) return null;
  return {
    ...account,
    category: id,
    type: kind === "in" ? "income" : "expense",
  };
}

const accountId = (node: SankeyNode) =>
  node.id.startsWith("acct:") ? node.id.slice("acct:".length) : null;

/** A ribbon is one account's money, so it filters to that account's side. */
function ribbonFilters(source: SankeyNode, target: SankeyNode) {
  const acct = source.id.startsWith("acct:") ? source : target;
  const other = acct === source ? target : source;
  const id = accountId(acct);
  return id && id !== "external" ? legFilters(id, other.id) : null;
}

function nodeFilters(node: SankeyNode) {
  const id = accountId(node);
  if (id) return id === "external" ? null : { account: id };
  return legFilters(null, node.id);
}

/**
 * Where the money came from, which account it landed in, and where it left to —
 * a Sankey across income sources → accounts → spending categories, with
 * account-to-account ribbons for internal transfers. Every bar and ribbon
 * clicks through to the transactions behind it.
 */
export function MoneyFlow({
  data,
  isLoading,
  open,
  onOpenChange,
  onSelect,
}: MoneyFlowProps) {
  const [hovered, setHovered] = useState<string | null>(null);

  const layout = useMemo(() => {
    const nodes = data?.nodes ?? [];
    const links = data?.links ?? [];
    // Room for the busiest column, not the node count: the columns are the
    // three kinds (accounts can split over more, which only leaves extra
    // room), and it's the fullest one that decides if labels have space.
    const perKind = new Map<string, number>();
    for (const n of nodes) perKind.set(n.kind, (perKind.get(n.kind) ?? 0) + 1);
    const widest = Math.max(1, ...perKind.values());
    return layoutSankey(nodes, links, {
      width: INNER_WIDTH,
      height: Math.max(320, Math.min(900, widest * ROW)),
      nodeWidth: NODE_WIDTH,
      minNodeHeight: MIN_NODE_HEIGHT,
    });
  }, [data]);

  const nodeById = useMemo(
    () => new Map(layout.nodes.map((n) => [n.id, n])),
    [layout],
  );
  const maxDepth = Math.max(0, ...layout.nodes.map((n) => n.depth));
  // Only the first column labels outward-left and only the last column runs
  // past the right edge; middle labels sit over the ribbons.
  const marginLeft = gutter(layout.nodes.filter((n) => n.depth === 0));
  const marginRight = gutter(layout.nodes.filter((n) => n.depth === maxDepth));
  const active = (id: string) => hovered === null || hovered === id;

  // SVG shapes aren't buttons, so clickable ones get the role and the keyboard
  // handling by hand.
  const clickable = (
    filters: Record<string, string> | null,
    label: string,
  ) =>
    filters
      ? {
          role: "button" as const,
          tabIndex: 0,
          "aria-label": `${label} — show transactions`,
          className: "cursor-pointer",
          onClick: () => onSelect(filters),
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect(filters);
            }
          },
        }
      : {};

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
            income → accounts → spending · click a bar or ribbon for its
            transactions
          </span>
        </summary>
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
                viewBox={`0 0 ${marginLeft + INNER_WIDTH + marginRight} ${
                  layout.height + 16
                }`}
                className="w-full min-w-[720px]"
                role="img"
                aria-label="Money flow diagram"
              >
                <g transform={`translate(${marginLeft}, 8)`}>
                  {layout.links.map((l) => {
                    const source = nodeById.get(l.source)!;
                    const target = nodeById.get(l.target)!;
                    const label = `${source.name} → ${target.name}: ${formatCurrency(l.value)}`;
                    return (
                      <path
                        key={`${l.source} ${l.target}`}
                        d={l.path}
                        fill="none"
                        // The end that isn't an account is the one with a
                        // meaningful colour: a category keeps its own on the
                        // way out, income sources theirs on the way in.
                        stroke={
                          (target.id.startsWith("cat:")
                            ? target.color
                            : source.color) ?? "currentColor"
                        }
                        strokeWidth={l.width}
                        className="transition-opacity"
                        opacity={
                          active(l.source) || active(l.target) ? 0.42 : 0.08
                        }
                        onMouseEnter={() => setHovered(l.source)}
                        onMouseLeave={() => setHovered(null)}
                        {...clickable(ribbonFilters(source, target), label)}
                      >
                        <title>{label}</title>
                      </path>
                    );
                  })}

                  {layout.nodes.map((n) => {
                    // First column labels outside on the left, everything else to
                    // the right of its bar.
                    const leftLabel = n.depth === 0 && maxDepth > 0;
                    const label = `${n.name}: ${formatCurrency(n.value)}`;
                    return (
                      <g
                        key={n.id}
                        onMouseEnter={() => setHovered(n.id)}
                        onMouseLeave={() => setHovered(null)}
                        {...clickable(nodeFilters(n), label)}
                      >
                        <rect
                          x={n.x0}
                          y={n.y0}
                          width={n.x1 - n.x0}
                          height={Math.max(n.y1 - n.y0, 1)}
                          fill={n.color ?? "currentColor"}
                          rx={2}
                        >
                          <title>{label}</title>
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
                          {shortName(n.name)}
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
      </details>
    </Card>
  );
}
