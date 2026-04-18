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
import { getAccountBalances, formatCurrency } from "../_lib/dashboard-queries";

export async function AccountsCard({ userId }: { userId: string }) {
  const accountBalances = await getAccountBalances(userId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Accounts</CardTitle>
        <CardDescription>
          {accountBalances.length} account
          {accountBalances.length !== 1 ? "s" : ""} connected
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
          <div className="space-y-2">
            {accountBalances.map((account) => (
              <Link
                key={account.id}
                href="/accounts"
                className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted/50"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                    <Landmark className="h-4 w-4 text-primary" />
                  </div>
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
