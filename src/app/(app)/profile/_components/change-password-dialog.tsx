"use client";

import { useState } from "react";
import { Check, KeyRound, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUpdateProfile } from "@/hooks/use-profile";
import { ApiError } from "@/lib/api";
import { MIN_PASSWORD_LENGTH } from "@/lib/validation";
import { useI18n } from "@/lib/i18n/client";
import { useResetOnChange } from "@/hooks/use-reset-on-change";
import { FormMessage, type FormMessageState } from "./form-message";
import { PasswordStrength } from "./password-strength";

export function ChangePasswordDialog({
  open,
  onOpenChange,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const updateProfile = useUpdateProfile();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<FormMessageState>(null);

  // Each visit starts clean — a half-typed password left behind from a
  // cancelled attempt is a trap, not a convenience.
  useResetOnChange(open, () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setMessage(null);
  });

  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const matches = confirmPassword.length > 0 && newPassword === confirmPassword;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);

    if (newPassword !== confirmPassword) {
      setMessage({ type: "error", text: t("profile.password.mismatch") });
      return;
    }

    setSaving(true);
    try {
      await updateProfile.mutateAsync({ currentPassword, newPassword });
      onChanged();
      onOpenChange(false);
    } catch (err) {
      setMessage({
        type: "error",
        text:
          err instanceof ApiError ? err.message : t("profile.password.changeFailed"),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("profile.password.title")}</DialogTitle>
          <DialogDescription>
            {t("profile.password.dialogHint")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="currentPassword">{t("profile.password.current")}</Label>
            <Input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="newPassword">{t("profile.password.new")}</Label>
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={MIN_PASSWORD_LENGTH}
              aria-describedby="newPassword-strength"
            />
            <div id="newPassword-strength">
              <PasswordStrength password={newPassword} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">{t("profile.password.confirm")}</Label>
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={MIN_PASSWORD_LENGTH}
              aria-invalid={mismatch || undefined}
            />
            {/* Answered while you type rather than on submit, so the fix costs
                a keystroke instead of a round-trip. */}
            {mismatch && (
              <p className="text-xs text-destructive">
                {t("profile.password.mismatch")}
              </p>
            )}
            {matches && (
              <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                <Check className="h-3.5 w-3.5" />
                {t("profile.password.matches")}
              </p>
            )}
          </div>

          <FormMessage message={message} />

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={saving || mismatch}>
              {saving ? (
                <Loader2 className="animate-spin" />
              ) : (
                <KeyRound />
              )}
              {t("profile.password.title")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
