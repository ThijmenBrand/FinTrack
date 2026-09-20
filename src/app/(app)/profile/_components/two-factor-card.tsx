"use client";

import { useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useI18n } from "@/lib/i18n/client";
import { TwoFactorSetup } from "./two-factor-flows";

/**
 * Standalone enrolment card for the backoffice gate, where two-factor is a
 * wall rather than a setting: you land here with nothing else on the page and
 * can't go on until it's done. The profile page reaches the same flow through
 * a dialog instead — see `two-factor-dialog.tsx`.
 */
export function TwoFactorCard({
  enabled: initialEnabled,
  required = false,
  onEnabled,
  redirectTo,
}: {
  enabled: boolean;
  required?: boolean;
  onEnabled?: () => void;
  redirectTo?: string;
}) {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(initialEnabled);

  return (
    <Card id="two-factor-authentication">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <KeyRound className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle>{t("profile.twoFactor.title")}</CardTitle>
            <CardDescription>
              {enabled
                ? t("profile.twoFactor.enabledHint")
                : required
                  ? t("profile.twoFactor.requiredHint")
                  : t("profile.twoFactor.defaultHint")}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {enabled ? (
          <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm font-medium text-green-800 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300">
            <ShieldCheck className="h-4 w-4" />
            {t("profile.twoFactor.enabledBadge")}
          </div>
        ) : (
          <TwoFactorSetup
            redirectTo={redirectTo}
            onEnabled={() => {
              setEnabled(true);
              onEnabled?.();
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}
