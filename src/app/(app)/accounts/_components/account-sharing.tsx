"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { UserAvatar } from "@/components/user-avatar";
import { UserPlus } from "lucide-react";
import {
  useAccountMembers,
  useInviteMember,
  useRevokeMember,
  useUpdateMemberRole,
} from "@/hooks/use-account-members";
import { ApiError } from "@/lib/api";
import type { AccountMember } from "@/types/api";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";

const STATUS_KEYS: Record<AccountMember["status"], MessageKey> = {
  pending: "sharing.status.pending",
  accepted: "sharing.status.accepted",
  expired: "sharing.status.expired",
};

const STATUS_CLASS: Record<AccountMember["status"], string> = {
  pending: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400",
  accepted: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400",
  expired: "bg-muted text-muted-foreground",
};

/** Invite form + member list; rendered inside ShareAccountDialog, owners only. */
export function AccountSharingSection({ accountId }: { accountId: string }) {
  const { t, plural } = useI18n();
  const { data: members, isLoading } = useAccountMembers(accountId);
  const invite = useInviteMember(accountId);
  const updateRole = useUpdateMemberRole(accountId);
  const revoke = useRevokeMember(accountId);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"viewer" | "editor">("viewer");
  const [error, setError] = useState("");

  const shared = members?.filter((m) => m.role !== "owner") ?? [];

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await invite.mutateAsync({ email: email.trim(), role });
      setEmail("");
      setRole("viewer");
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message || t("sharing.inviteFailed") : t("sharing.inviteFailed"),
      );
    }
  }

  return (
    <div className="grid gap-3">
      {shared.length > 0 && (
        <span className="text-xs text-muted-foreground">
          {plural(shared.length, "sharing.memberCount.one", "sharing.memberCount.other")}
        </span>
      )}

      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : shared.length > 0 ? (
        <ul className="divide-y rounded-md border">
          {shared.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 p-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <UserAvatar
                  name={m.memberName || m.email}
                  image={m.memberImage}
                  className="h-8 w-8 text-xs"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {m.memberName || m.email}
                  </p>
                  {m.memberName && (
                    <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span
                  className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_CLASS[m.status]}`}
                >
                  {t(STATUS_KEYS[m.status])}
                </span>
                <Select
                  value={m.role}
                  onValueChange={(v) =>
                    updateRole.mutate({ memberId: m.id, role: v as "viewer" | "editor" })
                  }
                >
                  <SelectTrigger className="h-7 w-[6.5rem] text-xs" aria-label={t("sharing.roleLabel")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="viewer">{t("sharing.role.viewer")}</SelectItem>
                    <SelectItem value="editor">{t("sharing.role.editor")}</SelectItem>
                  </SelectContent>
                </Select>
                <ConfirmDeleteButton
                  onConfirm={() => revoke.mutateAsync(m.id).then(() => {})}
                  pending={revoke.isPending}
                  label={t("sharing.revoke")}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{t("sharing.empty")}</p>
      )}

      <form onSubmit={handleInvite} className="flex flex-col gap-2 sm:flex-row">
        <Input
          type="email"
          required
          autoComplete="off"
          placeholder={t("sharing.emailPlaceholder")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="flex-1"
        />
        <div className="flex gap-2">
          <Select value={role} onValueChange={(v) => setRole(v as "viewer" | "editor")}>
            <SelectTrigger className="w-28" aria-label={t("sharing.roleLabel")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="viewer">{t("sharing.role.viewer")}</SelectItem>
              <SelectItem value="editor">{t("sharing.role.editor")}</SelectItem>
            </SelectContent>
          </Select>
          <Button type="submit" disabled={!email.trim() || invite.isPending}>
            <UserPlus className="mr-1.5 h-4 w-4" />
            {invite.isPending ? t("common.saving") : t("sharing.invite")}
          </Button>
        </div>
      </form>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
