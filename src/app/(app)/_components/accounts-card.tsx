import Link from "next/link";
import { Landmark } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BankLogo } from "@/components/bank-logo";
import { PotSaldoGraph } from "@/components/pot-saldo-graph";
import {
  getAccountBalances,
  getAccountBalanceSeries,
} from "../_lib/dashboard-queries";
import { formatCurrency } from "@/lib/utils";

const LINE_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
];

export async function AccountsCard({ userId }: { userId: string }) {
  const [accountBalances, series] = await Promise.all([
    getAccountBalances(userId),
    getAccountBalanceSeries(userId),
  ]);
  const totalBalance = accountBalances.reduce(
    (acc, a) => acc + a.currentBalance,
    0
  );
  const colorFor = (id: string) =>
    LINE_COLORS[
      Math.max(0, accountBalances.findIndex((a) => a.id === id)) %
        LINE_COLORS.length
    ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-baseline justify-between gap-2">
          <CardTitle>Accounts</CardTitle>
          <span className="text-sm font-semibold tabular-nums">
            {formatCurrency(totalBalance)}
          </span>
        </div>
        <CardDescription>
          Total across {accountBalances.length} account
          {accountBalances.length !== 1 ? "s" : ""}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {accountBalances.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Landmark className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <p className="text-sm text-muted-foreground">
              No accounts yet. Add one on the Accounts page.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* The list below doubles as the legend — matching dots, no extra chrome. */}
            <PotSaldoGraph
              lines={series.map((s) => ({
                points: s.points,
                label: s.name,
                color: colorFor(s.id),
              }))}
              showPoints={false}
              height={180}
              ariaLabel="Balance over the last 6 months per account"
              emptyMessage="No balance history yet."
            />
            <div className="space-y-2">
            {accountBalances.map((account) => (
              <Link
                key={account.id}
                href="/settings/accounts"
                className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted/50"
              >
                <div className="flex items-center gap-3">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: colorFor(account.id) }}
                  />
                  <BankLogo bank={account.bank} size={36} />
                  <div>
                    <p className="font-medium text-sm">{account.name}</p>
                    <p className="text-xs capitalize text-muted-foreground">
                      {account.type}
                      {account.bankName ? ` \u00b7 ${account.bankName}` : ""}
                    </p>
                  </div>
                </div>
                <p
                  className={`text-sm font-semibold tabular-nums ${
                    account.currentBalance >= 0
                      ? "text-foreground"
                      : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {formatCurrency(account.currentBalance)}
                </p>
              </Link>
            ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function AccountsCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-4 w-32 mt-1" />
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-lg border p-3"
            >
              <div className="flex items-center gap-3">
                <Skeleton className="h-9 w-9 rounded-lg" />
                <div>
                  <Skeleton className="h-4 w-24 mb-1" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
