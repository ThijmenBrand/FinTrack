"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAllocateToPot } from "@/hooks/use-pots";

const eur = new Intl.NumberFormat("nl-NL", {
  style: "currency",
  currency: "EUR",
});
const fc = (n: number) => eur.format(n);

type Mode = "add" | "remove";

interface AllocateToPotDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  potId: string;
  potName: string;
  targetAmount: number;
  fundedAmount: number;
  suggestedAmount: number;
  onAllocated?: () => void;
}

export function AllocateToPotDialog({
  open,
  onOpenChange,
  potId,
  potName,
  targetAmount,
  fundedAmount,
  suggestedAmount,
  onAllocated,
}: AllocateToPotDialogProps) {
  const [mode, setMode] = useState<Mode>("add");
  const [amount, setAmount] = useState("");
  const allocate = useAllocateToPot();

  // Reset to suggested-add whenever the dialog opens.
  useEffect(() => {
    if (open) {
      setMode("add");
      const rounded = Math.max(0, Math.round(suggestedAmount * 100) / 100);
      setAmount(rounded > 0 ? rounded.toFixed(2) : "");
    }
  }, [open, suggestedAmount]);

  const remaining = Math.max(0, targetAmount - fundedAmount);
  const numericAmount = Number(amount);
  const isPositive = Number.isFinite(numericAmount) && numericAmount > 0;
  const exceedsFunded = mode === "remove" && numericAmount > fundedAmount;
  const valid = isPositive && !exceedsFunded;

  const signedDelta = mode === "add" ? numericAmount : -numericAmount;
  const projected = Math.max(
    0,
    fundedAmount + (isPositive ? signedDelta : 0)
  );

  const handleSubmit = async () => {
    if (!valid) return;
    try {
      await allocate.mutateAsync({ potId, amount: signedDelta });
      onAllocated?.();
      onOpenChange(false);
    } catch (err) {
      console.error("Failed to update pot allocation:", err);
    }
  };

  const submitLabel = mode === "add" ? "Allocate" : "Deallocate";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{submitLabel} — {potName}</DialogTitle>
          <DialogDescription>
            {fc(fundedAmount)} of {fc(targetAmount)} funded so far —{" "}
            {remaining > 0 ? `${fc(remaining)} to go.` : "fully funded."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Mode toggle */}
          <div className="flex rounded-md border p-0.5 bg-muted/40">
            <button
              type="button"
              onClick={() => setMode("add")}
              className={cn(
                "flex-1 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors",
                mode === "add"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => setMode("remove")}
              disabled={fundedAmount <= 0}
              className={cn(
                "flex-1 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
                mode === "remove"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Remove
            </button>
          </div>

          {mode === "remove" && (
            <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/30 px-3 py-2 flex items-start gap-2">
              <span className="text-lg leading-none mt-0.5" aria-hidden="true">
                😿
              </span>
              <p className="text-xs text-amber-800 dark:text-amber-300">
                Are you sure? Deallocating means undoing your own saving —
                future-you might miss this money.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="allocate-amount">Amount (€)</Label>
            <Input
              id="allocate-amount"
              type="number"
              min="0"
              max={mode === "remove" ? fundedAmount : undefined}
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit();
              }}
            />
            {isPositive && !exceedsFunded && (
              <p className="text-xs text-muted-foreground">
                After this {mode === "add" ? "allocation" : "removal"}:{" "}
                {fc(projected)} / {fc(targetAmount)}{" "}
                {mode === "add" && projected >= targetAmount && (
                  <span className="text-emerald-600 dark:text-emerald-400">
                    — fully funded
                  </span>
                )}
                {mode === "remove" && projected === 0 && (
                  <span className="text-muted-foreground">— back to zero</span>
                )}
              </p>
            )}
            {exceedsFunded && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Can&apos;t remove more than {fc(fundedAmount)} — that&apos;s all
                you&apos;ve allocated.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!valid || allocate.isPending}
            variant={mode === "remove" ? "destructive" : "default"}
          >
            {allocate.isPending && (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            )}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
