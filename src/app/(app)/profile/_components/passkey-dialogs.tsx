"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Fingerprint, Loader2, Trash2 } from "lucide-react";
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
import { useDeletePasskey, useRegisterPasskey, type PasskeyItem } from "@/hooks/use-passkey";
import { ApiError } from "@/lib/api";
import { useI18n } from "@/lib/i18n/client";
import { useResetOnChange } from "@/hooks/use-reset-on-change";
import { FormMessage, type FormMessageState } from "./form-message";

/**
 * A plausible name for the device you're registering from, so the list reads
 * "iPhone" and "Work laptop" rather than four rows of "Passkey". A proper noun
 * either way, so it isn't translated — only the fallback is.
 */
function deviceLabel(): string | null {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Macintosh|Mac OS X/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  if (/Linux/.test(ua)) return "Linux";
  return null;
}

export function AddPasskeyDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { register } = useRegisterPasskey();

  const [name, setName] = useState("");
  const [registering, setRegistering] = useState(false);
  const [message, setMessage] = useState<FormMessageState>(null);

  useResetOnChange(open, () => {
    setName(open ? (deviceLabel() ?? "") : "");
    setMessage(null);
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setRegistering(true);
    try {
      // An empty box means "I don't care what it's called", not an empty name.
      await register(name.trim() || undefined);
      qc.invalidateQueries({ queryKey: ["passkeys"] });
      onAdded();
      onOpenChange(false);
    } catch (err) {
      setMessage({
        type: "error",
        text:
          err instanceof Error ? err.message : t("profile.passkey.registerFailed"),
      });
    } finally {
      setRegistering(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("profile.passkey.add")}</DialogTitle>
          <DialogDescription>
            {t("profile.passkey.addHint")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="passkeyName">{t("profile.passkey.nameLabel")}</Label>
            <Input
              id="passkeyName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("profile.passkey.namePlaceholder")}
              maxLength={60}
              autoFocus
              aria-describedby="passkeyName-hint"
            />
            <p id="passkeyName-hint" className="text-xs text-muted-foreground">
              {t("profile.passkey.nameHint")}
            </p>
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
            <Button type="submit" disabled={registering}>
              {registering ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Fingerprint />
              )}
              {t("profile.passkey.continueToDevice")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RemovePasskeyDialog({
  passkey,
  onOpenChange,
  onRemoved,
}: {
  /** The passkey being removed; `null` keeps the dialog closed. */
  passkey: PasskeyItem | null;
  onOpenChange: (open: boolean) => void;
  onRemoved: () => void;
}) {
  const { t } = useI18n();
  const deletePasskey = useDeletePasskey();

  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<FormMessageState>(null);

  useResetOnChange(passkey?.id ?? null, () => {
    setPassword("");
    setMessage(null);
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!passkey) return;
    setMessage(null);
    try {
      await deletePasskey.mutateAsync({
        id: passkey.id,
        currentPassword: password,
      });
      onRemoved();
      onOpenChange(false);
    } catch (err) {
      setMessage({
        type: "error",
        text:
          err instanceof ApiError ? err.message : t("profile.passkey.removeFailed"),
      });
    }
  }

  return (
    <Dialog open={passkey !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("profile.passkey.remove")}</DialogTitle>
          <DialogDescription>
            {t("profile.passkey.removeWarning", {
              name: passkey?.name || t("profile.passkey.fallbackName"),
            })}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="removePasskeyPassword">
              {t("profile.password.current")}
            </Label>
            <Input
              id="removePasskeyPassword"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
            />
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
            <Button
              type="submit"
              variant="destructive"
              disabled={deletePasskey.isPending}
            >
              {deletePasskey.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Trash2 />
              )}
              {t("profile.passkey.removeButton")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
