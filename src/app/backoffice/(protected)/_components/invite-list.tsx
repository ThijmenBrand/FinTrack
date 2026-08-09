"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Send, X, Shield } from "lucide-react";
import { useInvites, useResendInvite, useRevokeInvite } from "@/hooks/use-admin";
import { ApiError } from "@/lib/api";
import type { Invite } from "@/types/api";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";

const INVITE_STATUS_KEYS: Record<string, MessageKey> = {
  pending: "backoffice.inviteStatus.pending",
  accepted: "backoffice.inviteStatus.accepted",
  expired: "backoffice.inviteStatus.expired",
  revoked: "backoffice.inviteStatus.revoked",
};

const badgeClass: Record<Invite["status"], string> = {
  pending: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400",
  expired: "bg-muted text-muted-foreground",
  revoked: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400",
  accepted: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400",
};

export function InviteList({ onError }: { onError: (message: string) => void }) {
  const { t, formatDate } = useI18n();
  const { data: invites = [] } = useInvites();
  const resend = useResendInvite();
  const revoke = useRevokeInvite();

  // Accepted invites are just users now — they live in the list below.
  const open = invites.filter((invite) => invite.status !== "accepted");
  if (open.length === 0) return null;

  function fail(err: unknown, fallback: string) {
    onError(err instanceof ApiError ? err.message || fallback : fallback);
  }

  async function handleResend(invite: Invite) {
    onError("");
    try {
      await resend.mutateAsync(invite.id);
    } catch (err) {
      fail(err, t("backoffice.resendFailed"));
    }
  }

  async function handleRevoke(invite: Invite) {
    if (!confirm(`Revoke the invite for ${invite.email}? Their link stops working.`)) return;
    onError("");
    try {
      await revoke.mutateAsync(invite.id);
    } catch (err) {
      fail(err, t("backoffice.revokeFailed"));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("backoffice.invitesTitle")}</CardTitle>
        <CardDescription>
          {t("backoffice.invitesWaiting", {
            count: open.filter((i) => i.status === "pending").length,
          })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {open.map((invite) => (
            <div
              key={invite.id}
              className="flex items-center justify-between rounded-lg border p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate font-medium">{invite.email}</p>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass[invite.status]}`}
                  >
                    {t(INVITE_STATUS_KEYS[invite.status])}
                  </span>
                  {invite.isAdmin && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-500/20 dark:text-amber-400">
                      <Shield className="h-3 w-3" />
                      {t("backoffice.admin")}
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {t("backoffice.invitedOn", { date: formatDate(invite.createdAt) })}
                  {invite.status === "pending" &&
                    ` ${t("backoffice.expiresOn", { date: formatDate(invite.expiresAt) })}`}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {invite.status !== "revoked" && (
                  <button
                    onClick={() => handleResend(invite)}
                    disabled={resend.isPending}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                    title={t("backoffice.resendTitle")}
                  >
                    <Send className="h-3.5 w-3.5" />
                    {t("backoffice.resend")}
                  </button>
                )}
                {invite.status === "pending" && (
                  <button
                    onClick={() => handleRevoke(invite)}
                    disabled={revoke.isPending}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                    title={t("backoffice.revoke")}
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
