"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { UserAvatar } from "@/components/user-avatar";
import { Check, Send } from "lucide-react";
import {
  useAccountMembers,
  useInviteMember,
  useRevokeMember,
  useUpdateMemberRole,
} from "@/hooks/use-account-members";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { AccountMember } from "@/types/api";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";

type ShareRole = "viewer" | "editor";

const ROLES: ShareRole[] = ["viewer", "editor"];

const ROLE_KEYS: Record<ShareRole, MessageKey> = {
  viewer: "sharing.role.viewer",
  editor: "sharing.role.editor",
};

const ROLE_HINT_KEYS: Record<ShareRole, MessageKey> = {
  viewer: "sharing.role.viewerHint",
  editor: "sharing.role.editorHint",
};

/**
 * Accepted is the resting state and gets no badge — the member's real name and
 * profile picture already say they're in. Only the two states that need the
 * owner to do something announce themselves.
 */
const ATTENTION_STATUS: Partial<
  Record<AccountMember["status"], { key: MessageKey; dot: string; text: string }>
> = {
  pending: {
    key: "sharing.status.pending",
    dot: "bg-amber-500",
    text: "text-amber-600 dark:text-amber-400",
  },
  expired: {
    key: "sharing.status.expired",
    dot: "bg-red-500",
    text: "text-red-600 dark:text-red-400",
  },
};

/** One person's row: identity on the left, what they may do on the right. */
function MemberRow({
  member,
  onRoleChange,
  onRevoke,
  revoking,
}: {
  member: AccountMember;
  onRoleChange: (role: ShareRole) => void;
  onRevoke: () => Promise<void>;
  revoking: boolean;
}) {
  const { t } = useI18n();
  const isOwner = member.role === "owner";
  const status = ATTENTION_STATUS[member.status];
  // Until someone accepts we only know the address we sent to, so it doubles as
  // the display name and the second line is dropped rather than repeated.
  const displayName = member.memberName || member.email;
  const secondary = member.memberName ? member.email : null;

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
      <UserAvatar
        name={displayName}
        image={member.memberImage}
        className="h-9 w-9 text-xs"
      />
      <div className="min-w-[9rem] flex-1 space-y-0.5">
        <p className="truncate text-sm font-medium leading-tight">
          {displayName}
          {(isOwner || member.isMe) && (
            <span className="ml-1.5 font-normal text-muted-foreground">
              ({t("sharing.you")})
            </span>
          )}
        </p>
        {secondary && (
          <p className="truncate text-xs leading-tight text-muted-foreground">
            {secondary}
          </p>
        )}
        {status && (
          <p className={cn("flex items-center gap-1.5 text-xs leading-tight", status.text)}>
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", status.dot)} />
            <span className="truncate">{t(status.key)}</span>
          </p>
        )}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {isOwner ? (
          // The owner's role is a fact, not a choice — no control to poke at.
          <span className="px-2 text-xs font-medium text-muted-foreground">
            {t("sharing.role.owner")}
          </span>
        ) : (
          <>
            <Select
              value={member.role}
              onValueChange={(v) => onRoleChange(v as ShareRole)}
            >
              <SelectTrigger
                className="h-8 w-[7rem] text-xs"
                aria-label={t("sharing.roleLabel")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {t(ROLE_KEYS[r])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ConfirmDeleteButton
              onConfirm={onRevoke}
              pending={revoking}
              label={t("sharing.revoke")}
            />
          </>
        )}
      </div>
    </li>
  );
}

/** Invite form + member list; rendered inside ShareAccountDialog, owners only. */
export function AccountSharingSection({ accountId }: { accountId: string }) {
  const { t, plural } = useI18n();
  const { data: members, isLoading } = useAccountMembers(accountId);
  const invite = useInviteMember(accountId);
  const updateRole = useUpdateMemberRole(accountId);
  const revoke = useRevokeMember(accountId);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ShareRole>("viewer");
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState("");

  // The owner row comes first from the API; keeping it makes the list the whole
  // truth instead of "everyone except the person reading this".
  const people = members ?? [];
  const shared = people.filter((m) => m.role !== "owner");

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSentTo("");
    const address = email.trim();
    try {
      await invite.mutateAsync({ email: address, role });
      setEmail("");
      setRole("viewer");
      setSentTo(address);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message || t("sharing.inviteFailed")
          : t("sharing.inviteFailed"),
      );
    }
  }

  return (
    <div className="grid gap-5">
      {/* Inviting is the reason this dialog opens, so it leads. */}
      <form
        onSubmit={handleInvite}
        className="grid gap-3 rounded-lg border bg-muted/40 p-4"
      >
        <div className="grid gap-1.5">
          <Label htmlFor="share-email">{t("sharing.inviteHeading")}</Label>
          <Input
            id="share-email"
            type="email"
            required
            autoComplete="off"
            placeholder={t("sharing.emailPlaceholder")}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError("");
              setSentTo("");
            }}
            className="bg-background"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented
            name="share-invite-role"
            legend={t("sharing.roleLabel")}
            value={role}
            onChange={setRole}
            options={ROLES.map((r) => ({ value: r, label: t(ROLE_KEYS[r]) }))}
          />
          <Button type="submit" disabled={!email.trim() || invite.isPending}>
            <Send className="h-4 w-4" />
            {invite.isPending ? t("common.saving") : t("sharing.invite")}
          </Button>
        </div>

        {/* What the picked role actually grants, next to the picker that grants
            it — the dialog description used to carry both definitions as prose. */}
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t(ROLE_HINT_KEYS[role])}
        </p>

        {error && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        {sentTo && !error && (
          <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
            <Check className="h-3.5 w-3.5 shrink-0" />
            {t("sharing.inviteSent", { email: sentTo })}
          </p>
        )}
      </form>

      <div className="grid gap-2">
        <h3 className="text-sm font-medium">
          {plural(
            people.length,
            "sharing.memberCount.one",
            "sharing.memberCount.other",
          )}
        </h3>

        {isLoading ? (
          <div className="grid gap-2 rounded-lg border p-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : (
          <>
            <ul className="divide-y rounded-lg border">
              {people.map((m) => (
                <MemberRow
                  key={m.id}
                  member={m}
                  onRoleChange={(r) => updateRole.mutate({ memberId: m.id, role: r })}
                  onRevoke={() => revoke.mutateAsync(m.id).then(() => {})}
                  revoking={revoke.isPending}
                />
              ))}
            </ul>
            {shared.length === 0 && (
              <p className="text-xs text-muted-foreground">{t("sharing.empty")}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
