"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BankLogo } from "@/components/bank-logo";
import { useAccountMembers, useLeaveShare } from "@/hooks/use-account-members";
import type { Account } from "@/types/api";
import { useI18n } from "@/lib/i18n/client";
import { AccountSharingSection } from "./account-sharing";

/** Owner-only invite + member management, reached from the card's ⋮ menu. */
export function ShareAccountDialog({
  account,
  onOpenChange,
}: {
  account: Account | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();

  return (
    <Dialog open={!!account} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          {/* Logo + name, same header shape as the balance dialog, so the two
              things you can open from a card feel like the same account. */}
          <div className="flex items-start gap-3 pr-8">
            <BankLogo bank={account?.bank ?? null} size={40} />
            <div className="min-w-0 flex-1 space-y-1.5 text-left">
              <DialogTitle className="truncate">
                {t("sharing.dialogTitle", { name: account?.name ?? "" })}
              </DialogTitle>
              <DialogDescription className="leading-relaxed">
                {t("sharing.dialogDescription")}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        {/* Keyed so switching accounts without closing resets the invite form. */}
        {account && <AccountSharingSection key={account.id} accountId={account.id} />}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Owner-side delete confirm. Fetches the member list only while open (lazy —
 * the accounts grid never N+1s this) to warn how many people lose access.
 */
export function DeleteAccountDialog({
  account,
  pending,
  onConfirm,
  onOpenChange,
}: {
  account: Account | null;
  pending: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, plural } = useI18n();
  const { data: members } = useAccountMembers(account?.id ?? null);
  const memberCount = members?.filter((m) => m.role !== "owner").length ?? 0;

  return (
    <Dialog open={!!account} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("accounts.delete.title", { name: account?.name ?? "" })}</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2">
              <p>{t("accounts.delete.body")}</p>
              {memberCount > 0 && (
                <p className="text-amber-600 dark:text-amber-400">
                  {plural(
                    memberCount,
                    "accounts.delete.memberWarning.one",
                    "accounts.delete.memberWarning.other",
                  )}
                </p>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={pending}>
            {pending ? t("common.deleting") : t("common.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Member-side leave confirm — the API marks the caller's own row with isMe. */
export function LeaveAccountDialog({
  account,
  onOpenChange,
}: {
  account: Account | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const { data: members, isLoading } = useAccountMembers(account?.id ?? null);
  const leaveShare = useLeaveShare();

  const myMembership = members?.find((m) => m.isMe);

  const handleLeave = async () => {
    if (!myMembership) return;
    await leaveShare.mutateAsync(myMembership.id);
    onOpenChange(false);
  };

  return (
    <Dialog open={!!account} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("accounts.leave.title", { name: account?.name ?? "" })}</DialogTitle>
          <DialogDescription>{t("accounts.leave.body")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={leaveShare.isPending}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={handleLeave}
            disabled={leaveShare.isPending || isLoading || !myMembership}
          >
            {leaveShare.isPending ? t("common.saving") : t("accounts.leave.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
