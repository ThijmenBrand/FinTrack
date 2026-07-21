"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";

interface RegenerateConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suggestionCount: number;
  lookbackMonths: number;
  pending: boolean;
  onConfirm: () => void;
}

export function RegenerateConfirmDialog({
  open,
  onOpenChange,
  suggestionCount,
  lookbackMonths,
  pending,
  onConfirm,
}: RegenerateConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Replace current suggestions?</DialogTitle>
          <DialogDescription>
            This will replace the {suggestionCount} pending suggestion
            {suggestionCount === 1 ? "" : "s"} with a fresh set based on the last{" "}
            {lookbackMonths} month
            {lookbackMonths === 1 ? "" : "s"} of spending. Any edits you&apos;ve
            made to the current suggestions will be lost.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Regenerate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
