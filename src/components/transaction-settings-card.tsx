"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ArrowLeftRight, Loader2 } from "lucide-react";
import { usePreferences, useUpdatePreferences } from "@/hooks/use-preferences";

export function TransactionSettingsCard() {
  const { data, isLoading } = usePreferences();
  const update = useUpdatePreferences();

  const hideInternal = data?.hideInternalTransfers ?? false;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <ArrowLeftRight className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle>Transactions</CardTitle>
            <CardDescription>
              Control what shows up in your transactions list by default.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : (
          <label className="flex cursor-pointer items-start justify-between gap-3 rounded-md border p-3">
            <div>
              <div className="text-sm font-medium">Hide internal transfers</div>
              <div className="text-xs text-muted-foreground">
                When on, transfers between your own accounts are hidden from the transactions list.
              </div>
            </div>
            <input
              type="checkbox"
              checked={hideInternal}
              disabled={update.isPending}
              onChange={(e) =>
                update.mutate({ hideInternalTransfers: e.target.checked })
              }
              className="mt-0.5 h-4 w-4 cursor-pointer accent-primary"
            />
          </label>
        )}
      </CardContent>
    </Card>
  );
}
