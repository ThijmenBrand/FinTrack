"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface CategoryBreakdownEntry {
  categoryId: string | null;
  categoryName: string;
  categoryColor: string;
  total: number;
}

interface CategoryDistributionCardProps {
  sortedBreakdown: CategoryBreakdownEntry[];
  totalExpenses: number;
  onCategoryClick: (categoryId: string | null) => void;
}

// CSS conic-gradient pie chart + legend for the category breakdown.
export function CategoryDistributionCard({
  sortedBreakdown,
  totalExpenses,
  onCategoryClick,
}: CategoryDistributionCardProps) {
  return (
    <Card className="lg:col-span-1">
      <CardHeader>
        <CardTitle className="text-base">Category Distribution</CardTitle>
      </CardHeader>
      <CardContent>
        {sortedBreakdown.length === 0 ? (
          <p className="text-muted-foreground text-sm py-8 text-center">
            No expense data for this period.
          </p>
        ) : (
          <div className="flex flex-col items-center gap-6">
            <div
              className="w-48 h-48 rounded-full mx-auto max-w-full"
              style={{
                background: (() => {
                  let cumulative = 0;
                  const stops = sortedBreakdown.map((cat) => {
                    const pct = totalExpenses > 0 ? (cat.total / totalExpenses) * 100 : 0;
                    const start = cumulative;
                    cumulative += pct;
                    return `${cat.categoryColor} ${start}% ${cumulative}%`;
                  });
                  return `conic-gradient(${stops.join(", ")})`;
                })(),
              }}
            />
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm w-full">
              {sortedBreakdown.map((cat) => {
                const pct =
                  totalExpenses > 0
                    ? ((cat.total / totalExpenses) * 100).toFixed(1)
                    : "0";
                const clickable = Boolean(cat.categoryId);
                return (
                  <button
                    key={cat.categoryId || "none"}
                    type="button"
                    disabled={!clickable}
                    onClick={clickable ? () => onCategoryClick(cat.categoryId) : undefined}
                    className={`flex items-center gap-2 truncate text-left rounded-sm px-1 -mx-1 py-0.5 ${clickable ? "cursor-pointer hover:bg-muted/60 transition-colors" : "cursor-default"}`}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-sm shrink-0"
                      style={{ backgroundColor: cat.categoryColor }}
                    />
                    <span className="truncate">{cat.categoryName}</span>
                    <span className="text-muted-foreground ml-auto shrink-0">{pct}%</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
