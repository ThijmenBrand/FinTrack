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
import { useI18n } from "@/lib/i18n/client";

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
  const { t, plural } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("budgets.regen.title")}</DialogTitle>
          <DialogDescription>
            {plural(suggestionCount, "budgets.regen.body.one", "budgets.regen.body.other", {
              months: lookbackMonths,
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={onConfirm} disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("budgets.regenerate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
