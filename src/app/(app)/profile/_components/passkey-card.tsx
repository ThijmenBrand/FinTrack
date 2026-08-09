"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Fingerprint, Loader2, Trash2 } from "lucide-react";
import { usePasskeys, useDeletePasskey, useRegisterPasskey } from "@/hooks/use-passkey";
import { ApiError } from "@/lib/api";
import { FormMessage, type FormMessageState } from "./form-message";
import { useI18n } from "@/lib/i18n/client";

export function PasskeyCard() {
  const { t, formatDate } = useI18n();
  const [webAuthnSupported, setWebAuthnSupported] = useState(false);
  const [passkeyMsg, setPasskeyMsg] = useState<FormMessageState>(null);
  const [registeringPasskey, setRegisteringPasskey] = useState(false);
  const [deletePasskeyId, setDeletePasskeyId] = useState<string | null>(null);
  const [deletePasskeyPassword, setDeletePasskeyPassword] = useState("");

  const qc = useQueryClient();
  const { register: registerPasskey } = useRegisterPasskey();
  const { data: passkeys = [] } = usePasskeys(webAuthnSupported);
  const deletePasskey = useDeletePasskey();

  useEffect(() => {
    if (typeof window !== "undefined" && window.PublicKeyCredential) {
      setWebAuthnSupported(true);
    }
  }, []);

  async function handleRegisterPasskey() {
    setPasskeyMsg(null);
    setRegisteringPasskey(true);
    try {
      await registerPasskey();
      setPasskeyMsg({ type: "success", text: "Passkey registered successfully" });
      qc.invalidateQueries({ queryKey: ["passkeys"] });
    } catch (err) {
      setPasskeyMsg({
        type: "error",
        text: err instanceof Error ? err.message : t("profile.passkey.registerFailed"),
      });
    } finally {
      setRegisteringPasskey(false);
    }
  }

  async function handleDeletePasskey(e: React.FormEvent) {
    e.preventDefault();
    if (!deletePasskeyId) return;
    setPasskeyMsg(null);
    try {
      await deletePasskey.mutateAsync({ id: deletePasskeyId, currentPassword: deletePasskeyPassword });
      setPasskeyMsg({ type: "success", text: "Passkey removed" });
      setDeletePasskeyId(null);
      setDeletePasskeyPassword("");
    } catch (err) {
      setPasskeyMsg({
        type: "error",
        text: err instanceof ApiError ? err.message : t("profile.passkey.removeFailed"),
      });
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <Fingerprint className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle>{t("profile.passkey.title")}</CardTitle>
            <CardDescription>{t("profile.passkey.hint")}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <FormMessage message={passkeyMsg} className="mb-4" />

        {!webAuthnSupported ? (
          <p className="text-sm text-muted-foreground">
            {t("profile.passkey.unsupported")}
          </p>
        ) : (
          <div className="space-y-4">
            {passkeys.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">{t("profile.passkey.registered")}</p>
                {passkeys.map((pk) => (
                  <div key={pk.id}>
                    <div className="flex items-center justify-between rounded-md border p-3">
                      <div className="flex items-center gap-2">
                        <Fingerprint className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">
                          {pk.name || t("profile.passkey.fallbackName")}
                        </span>
                        {pk.createdAt && (
                          <span className="text-xs text-muted-foreground">
                            {formatDate(pk.createdAt)}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => { setDeletePasskeyId(pk.id); setDeletePasskeyPassword(""); setPasskeyMsg(null); }}
                        className="inline-flex items-center justify-center rounded-md p-1 text-muted-foreground hover:text-destructive transition-colors"
                        title={t("profile.passkey.remove")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    {deletePasskeyId === pk.id && (
                      <form onSubmit={handleDeletePasskey} className="mt-2 space-y-3 rounded-md border border-destructive/20 bg-destructive/5 p-3">
                        <p className="text-sm text-muted-foreground">
                          {t("profile.passkey.confirmRemoval")}
                        </p>
                        <div className="space-y-2">
                          <label htmlFor={`deletePasskeyPw-${pk.id}`} className="text-sm font-medium">
                            {t("profile.password.current")}
                          </label>
                          <Input
                            id={`deletePasskeyPw-${pk.id}`}
                            type="password"
                            value={deletePasskeyPassword}
                            onChange={(e) => setDeletePasskeyPassword(e.target.value)}
                            required
                            autoFocus
                          />
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="submit"
                            disabled={deletePasskey.isPending}
                            className="inline-flex items-center justify-center gap-2 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition-colors"
                          >
                            {deletePasskey.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                            {t("profile.passkey.removeButton")}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setDeletePasskeyId(null); setDeletePasskeyPassword(""); setPasskeyMsg(null); }}
                            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
                          >
                            {t("common.cancel")}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={handleRegisterPasskey}
              disabled={registeringPasskey}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {registeringPasskey ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Fingerprint className="h-4 w-4" />
              )}
              {passkeys.length > 0
                ? t("profile.passkey.addAnother")
                : t("profile.passkey.setUp")}
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
