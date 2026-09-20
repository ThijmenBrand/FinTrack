"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/client";
import { TwoFactorDisable, TwoFactorSetup } from "./two-factor-flows";

export function TwoFactorSetupDialog({
  open,
  onOpenChange,
  onEnabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEnabled: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("profile.twoFactor.setUp")}</DialogTitle>
          <DialogDescription>
            {t("profile.twoFactor.defaultHint")}
          </DialogDescription>
        </DialogHeader>
        {/* Keyed on `open` so a cancelled enrolment doesn't reopen halfway
            through, holding a QR code the server has since forgotten. */}
        <TwoFactorSetup
          key={String(open)}
          onCancel={() => onOpenChange(false)}
          onEnabled={() => {
            onEnabled();
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

export function TwoFactorDisableDialog({
  open,
  onOpenChange,
  onDisabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDisabled: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("profile.twoFactor.disableButton")}</DialogTitle>
          <DialogDescription>
            {t("profile.twoFactor.disableWarning")}
          </DialogDescription>
        </DialogHeader>
        <TwoFactorDisable
          key={String(open)}
          onCancel={() => onOpenChange(false)}
          onDisabled={() => {
            onDisabled();
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
