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

const badgeClass: Record<Invite["status"], string> = {
  pending: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400",
  expired: "bg-muted text-muted-foreground",
  revoked: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400",
  accepted: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400",
};

export function InviteList({ onError }: { onError: (message: string) => void }) {
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
      fail(err, "Failed to resend invite");
    }
  }

  async function handleRevoke(invite: Invite) {
    if (!confirm(`Revoke the invite for ${invite.email}? Their link stops working.`)) return;
    onError("");
    try {
      await revoke.mutateAsync(invite.id);
    } catch (err) {
      fail(err, "Failed to revoke invite");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invites</CardTitle>
        <CardDescription>
          {open.filter((i) => i.status === "pending").length} waiting to be accepted
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
                    className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${badgeClass[invite.status]}`}
                  >
                    {invite.status}
                  </span>
                  {invite.isAdmin && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-500/20 dark:text-amber-400">
                      <Shield className="h-3 w-3" />
                      Admin
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  Invited {new Date(invite.createdAt).toLocaleDateString()}
                  {invite.status === "pending" &&
                    ` · expires ${new Date(invite.expiresAt).toLocaleDateString()}`}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {invite.status !== "revoked" && (
                  <button
                    onClick={() => handleResend(invite)}
                    disabled={resend.isPending}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                    title="Send a fresh link — the old one stops working"
                  >
                    <Send className="h-3.5 w-3.5" />
                    Resend
                  </button>
                )}
                {invite.status === "pending" && (
                  <button
                    onClick={() => handleRevoke(invite)}
                    disabled={revoke.isPending}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                    title="Revoke invite"
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
