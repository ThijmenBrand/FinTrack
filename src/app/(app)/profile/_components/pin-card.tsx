"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Lock, Save, Loader2, Trash2 } from "lucide-react";
import { useHasPin, useSetupPin, useRemovePin } from "@/hooks/use-pin";
import { ApiError } from "@/lib/api";
import { FormMessage, type FormMessageState } from "./form-message";
import { useI18n } from "@/lib/i18n/client";

export function PinCard() {
  const { t } = useI18n();
  const { data: pinStatus } = useHasPin();
  const hasPin = pinStatus?.hasPin ?? false;
  const setupPin = useSetupPin();
  const removePin = useRemovePin();

  const [showPinSetup, setShowPinSetup] = useState(false);
  const [pinPassword, setPinPassword] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinMsg, setPinMsg] = useState<FormMessageState>(null);
  const [removePinPassword, setRemovePinPassword] = useState("");
  const [showRemovePin, setShowRemovePin] = useState(false);

  async function handlePinSetup(e: React.FormEvent) {
    e.preventDefault();
    setPinMsg(null);

    if (pin !== confirmPin) {
      setPinMsg({ type: "error", text: t("profile.pin.mismatch") });
      return;
    }

    try {
      await setupPin.mutateAsync({ pin, currentPassword: pinPassword });
      setPinMsg({ type: "success", text: hasPin ? t("profile.pin.updated") : t("profile.pin.created") });
      setShowPinSetup(false);
      setPin("");
      setConfirmPin("");
      setPinPassword("");
    } catch (err) {
      if (err instanceof ApiError) {
        setPinMsg({ type: "error", text: err.message });
      } else {
        setPinMsg({ type: "error", text: t("profile.pin.setupFailed") });
      }
    }
  }

  async function handleRemovePin(e: React.FormEvent) {
    e.preventDefault();
    setPinMsg(null);

    try {
      await removePin.mutateAsync({ currentPassword: removePinPassword });
      setPinMsg({ type: "success", text: t("profile.pin.removed") });
      setShowRemovePin(false);
      setRemovePinPassword("");
    } catch (err) {
      if (err instanceof ApiError) {
        setPinMsg({ type: "error", text: err.message });
      } else {
        setPinMsg({ type: "error", text: t("profile.pin.removeFailed") });
      }
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <Lock className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle>{t("profile.pin.title")}</CardTitle>
            <CardDescription>
              {hasPin ? t("profile.pin.hasPin") : t("profile.pin.noPin")}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <FormMessage message={pinMsg} className="mb-4" />

        {!showPinSetup && !showRemovePin && (
          <div className="flex gap-2">
            <button
              onClick={() => { setShowPinSetup(true); setPinMsg(null); }}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Lock className="h-4 w-4" />
              {hasPin ? t("profile.pin.change") : t("profile.pin.setUp")}
            </button>
            {hasPin && (
              <button
                onClick={() => { setShowRemovePin(true); setPinMsg(null); }}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                <Trash2 className="h-4 w-4" />
                {t("profile.pin.remove")}
              </button>
            )}
          </div>
        )}

        {showPinSetup && (
          <form onSubmit={handlePinSetup} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="pinPassword" className="text-sm font-medium">
                {t("profile.password.current")}
              </label>
              <Input
                id="pinPassword"
                type="password"
                value={pinPassword}
                onChange={(e) => setPinPassword(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="pin" className="text-sm font-medium">
                {t("profile.pin.label")}
              </label>
              <Input
                id="pin"
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                className="tracking-[0.5em] text-center placeholder:tracking-normal"
                placeholder={t("profile.pin.enter")}
                required
                minLength={4}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="confirmPin" className="text-sm font-medium">
                {t("profile.pin.confirmLabel")}
              </label>
              <Input
                id="confirmPin"
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
                className="tracking-[0.5em] text-center placeholder:tracking-normal"
                placeholder={t("profile.pin.confirmLabel")}
                required
                minLength={4}
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={setupPin.isPending}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {setupPin.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {hasPin ? t("profile.pin.update") : t("profile.pin.set")}
              </button>
              <button
                type="button"
                onClick={() => { setShowPinSetup(false); setPin(""); setConfirmPin(""); setPinPassword(""); setPinMsg(null); }}
                className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                {t("common.cancel")}
              </button>
            </div>
          </form>
        )}

        {showRemovePin && (
          <form onSubmit={handleRemovePin} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("profile.pin.confirmRemoval")}
            </p>
            <div className="space-y-2">
              <label htmlFor="removePinPassword" className="text-sm font-medium">
                {t("profile.password.current")}
              </label>
              <Input
                id="removePinPassword"
                type="password"
                value={removePinPassword}
                onChange={(e) => setRemovePinPassword(e.target.value)}
                required
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={removePin.isPending}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition-colors"
              >
                {removePin.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                {t("profile.pin.remove")}
              </button>
              <button
                type="button"
                onClick={() => { setShowRemovePin(false); setRemovePinPassword(""); setPinMsg(null); }}
                className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                {t("common.cancel")}
              </button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
