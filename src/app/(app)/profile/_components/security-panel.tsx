"use client";

import { useState } from "react";
import { Shield, ShieldCheck } from "lucide-react";
import { SettingsPanel, SettingsRow } from "@/components/settings/settings-ui";
import { Button } from "@/components/ui/button";
import { useResetOnChange } from "@/hooks/use-reset-on-change";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { FormMessage, type FormMessageState } from "./form-message";
import { ChangePasswordDialog } from "./change-password-dialog";
import {
  TwoFactorDisableDialog,
  TwoFactorSetupDialog,
} from "./two-factor-dialog";

/** The state of a protection, stated before the button that changes it. */
function StatusPill({ on, children }: { on: boolean; children: React.ReactNode }) {
  const Icon = on ? ShieldCheck : Shield;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium",
        on
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : "border-border bg-muted text-muted-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </span>
  );
}

/**
 * Sign-in and security. Every row reads state-then-action: what protects the
 * account right now, and one button that opens the flow to change it. The
 * flows live in dialogs so a page you came to for your display name isn't
 * three password fields deep.
 */
export function SecurityPanel({
  twoFactorEnabled,
}: {
  twoFactorEnabled: boolean;
}) {
  const { t } = useI18n();

  // Mirrors the server value but leads it: the enable/disable calls go through
  // better-auth, so the profile query won't know until it refetches.
  const [enabled, setEnabled] = useState(twoFactorEnabled);
  useResetOnChange(twoFactorEnabled, () => setEnabled(twoFactorEnabled));

  const [passwordOpen, setPasswordOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [message, setMessage] = useState<FormMessageState>(null);

  /** Opening any flow clears the last one's verdict. */
  function open(set: (value: boolean) => void) {
    setMessage(null);
    set(true);
  }

  return (
    <>
      <SettingsPanel
        title="profile.security.title"
        description="profile.security.description"
        icon={ShieldCheck}
        footer={
          message && <FormMessage message={message} className="text-xs" />
        }
      >
        <SettingsRow
          label={t("profile.password.rowLabel")}
          hint={t("profile.password.rowHint")}
          control={
            <Button
              variant="outline"
              size="sm"
              onClick={() => open(setPasswordOpen)}
            >
              {t("profile.password.change")}
            </Button>
          }
        />

        <SettingsRow
          label={t("profile.twoFactor.title")}
          hint={
            enabled
              ? t("profile.twoFactor.enabledHint")
              : t("profile.twoFactor.defaultHint")
          }
          control={
            <div className="flex items-center gap-3">
              <StatusPill on={enabled}>
                {enabled
                  ? t("profile.twoFactor.enabledBadge")
                  : t("profile.twoFactor.off")}
              </StatusPill>
              <Button
                variant={enabled ? "outline" : "default"}
                size="sm"
                onClick={() => open(enabled ? setDisableOpen : setSetupOpen)}
              >
                {enabled
                  ? t("profile.twoFactor.disable")
                  : t("profile.twoFactor.setUpShort")}
              </Button>
            </div>
          }
        />
      </SettingsPanel>

      <ChangePasswordDialog
        open={passwordOpen}
        onOpenChange={setPasswordOpen}
        onChanged={() =>
          setMessage({ type: "success", text: t("profile.password.changed") })
        }
      />
      <TwoFactorSetupDialog
        open={setupOpen}
        onOpenChange={setSetupOpen}
        onEnabled={() => {
          setEnabled(true);
          setMessage({ type: "success", text: t("profile.twoFactor.nowEnabled") });
        }}
      />
      <TwoFactorDisableDialog
        open={disableOpen}
        onOpenChange={setDisableOpen}
        onDisabled={() => {
          setEnabled(false);
          setMessage({
            type: "success",
            text: t("profile.twoFactor.nowDisabled"),
          });
        }}
      />
    </>
  );
}
