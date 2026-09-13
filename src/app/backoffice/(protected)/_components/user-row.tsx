"use client";

import { useState, type FormEvent } from "react";
import {
  Ban,
  ChevronDown,
  ChevronUp,
  KeyRound,
  Settings2,
  Trash2,
} from "lucide-react";
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
import {
  useDeleteUser,
  useResetPassword,
  useSetBanned,
  useUpdateUser,
  type UserUpdate,
} from "@/hooks/use-admin";
import type { AdminUser } from "@/types/api";
import { ApiError } from "@/lib/api";
import { useI18n } from "@/lib/i18n/client";
import { UserAvatar } from "@/components/user-avatar";

type AccountForm = {
  displayName: string;
  email: string;
  emailVerified: boolean;
  role: "admin" | "user";
};

function accountValues(user: AdminUser): AccountForm {
  return {
    displayName: user.displayName,
    email: user.email,
    emailVerified: user.emailVerified,
    role: user.role,
  };
}

export function UserRow({
  user,
  expanded,
  onToggleExpand,
  onError,
}: {
  user: AdminUser;
  expanded: boolean;
  onToggleExpand: () => void;
  onError: (message: string) => void;
}) {
  const { t, plural, formatDate, formatNumber } = useI18n();
  const deleteUser = useDeleteUser();
  const resetPassword = useResetPassword();
  const setBanned = useSetBanned();
  const updateUser = useUpdateUser();

  const [account, setAccount] = useState<AccountForm>(() => accountValues(user));
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");

  const hasAccountChanges =
    account.displayName.trim() !== user.displayName ||
    account.email.trim().toLowerCase() !== user.email.toLowerCase() ||
    account.emailVerified !== user.emailVerified ||
    (!user.isCurrentUser && account.role !== user.role);

  function fail(err: unknown, fallback: string) {
    onError(err instanceof ApiError ? err.message || fallback : fallback);
  }

  function updateAccount<K extends keyof AccountForm>(key: K, value: AccountForm[K]) {
    setAccount((current) => ({ ...current, [key]: value }));
  }

  function toggleManage() {
    if (!expanded) {
      setAccount(accountValues(user));
      setNewPassword("");
      setConfirmPassword("");
      setPasswordError("");
    }
    onToggleExpand();
  }

  async function handleDelete() {
    if (!confirm(t("backoffice.confirmDeleteUser", { name: user.displayName }))) return;
    try {
      await deleteUser.mutateAsync(user.id);
    } catch (err) {
      fail(err, t("backoffice.deleteUserFailed"));
    }
  }

  async function handleToggleBan() {
    try {
      if (user.banned) {
        await setBanned.mutateAsync({ id: user.id, banned: false });
      } else {
        const reason = prompt(t("backoffice.confirmBanUser", { name: user.displayName }));
        if (reason === null) return;
        await setBanned.mutateAsync({ id: user.id, banned: true, banReason: reason || undefined });
      }
    } catch (err) {
      fail(err, user.banned ? t("backoffice.unbanFailed") : t("backoffice.banFailed"));
    }
  }

  async function handleSaveAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hasAccountChanges) return;

    const payload: UserUpdate = { id: user.id };
    const cleanDisplayName = account.displayName.trim();
    const cleanEmail = account.email.trim().toLowerCase();

    if (cleanDisplayName !== user.displayName) payload.displayName = cleanDisplayName;
    if (cleanEmail !== user.email.toLowerCase()) payload.email = cleanEmail;
    if (account.emailVerified !== user.emailVerified) payload.emailVerified = account.emailVerified;
    if (!user.isCurrentUser && account.role !== user.role) {
      payload.isAdmin = account.role === "admin";
    }

    try {
      await updateUser.mutateAsync(payload);
    } catch (err) {
      fail(err, t("backoffice.updateAccountFailed"));
    }
  }

  async function handlePasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError("");
    if (newPassword !== confirmPassword) {
      setPasswordError(t("backoffice.passwordsMismatch"));
      return;
    }

    try {
      await resetPassword.mutateAsync({ id: user.id, password: newPassword });
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message || t("backoffice.resetPasswordFailed")
          : t("backoffice.resetPasswordFailed");
      setPasswordError(message);
    }
  }

  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <UserAvatar
            name={user.displayName}
            image={user.imageUrl}
            className="h-10 w-10 text-sm"
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate font-medium text-foreground">{user.displayName}</p>
              <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                {user.role === "admin" ? t("backoffice.admin") : t("backoffice.user")}
              </span>
              {user.banned && (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-500/20 dark:text-red-400"
                  title={user.banReason || undefined}
                >
                  <Ban className="h-3 w-3" />
                  {t("backoffice.banned")}
                </span>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <span className="truncate">{user.email}</span>
              <span aria-hidden="true">·</span>
              <span
                className={user.emailVerified ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}
              >
                {user.emailVerified ? t("backoffice.verified") : t("backoffice.unverified")}
              </span>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant={expanded ? "secondary" : "outline"} size="sm" onClick={toggleManage}>
            <Settings2 className="h-4 w-4" />
            {t("backoffice.manage")}
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={handleToggleBan}
            disabled={user.isCurrentUser || setBanned.isPending}
            className="hover:border-red-200 hover:bg-red-50 hover:text-red-700 dark:hover:border-red-900 dark:hover:bg-red-950/40 dark:hover:text-red-400"
            aria-label={
              user.banned
                ? t("backoffice.unbanUser", { name: user.displayName })
                : t("backoffice.banUser", { name: user.displayName })
            }
            title={
              user.isCurrentUser
                ? t("backoffice.cannotBanSelf")
                : user.banned
                  ? t("backoffice.unbanTitle")
                  : t("backoffice.banTitle")
            }
          >
            <Ban />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={handleDelete}
            disabled={user.isCurrentUser || deleteUser.isPending}
            className="hover:border-red-200 hover:bg-red-50 hover:text-red-700 dark:hover:border-red-900 dark:hover:bg-red-950/40 dark:hover:text-red-400"
            aria-label={t("backoffice.deleteUserLabel", { name: user.displayName })}
            title={
              user.isCurrentUser
                ? t("backoffice.cannotDeleteSelf")
                : t("backoffice.deleteUser")
            }
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="border-t bg-muted/30 p-4 sm:p-5">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_17rem]">
            <form onSubmit={handleSaveAccount} className="space-y-4">
              <div>
                <h2 className="font-semibold text-foreground">{t("backoffice.accountDetails")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("backoffice.accountDetailsHint")}
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor={`display-name-${user.id}`}>{t("profile.displayName")}</Label>
                  <Input
                    id={`display-name-${user.id}`}
                    value={account.displayName}
                    onChange={(event) => updateAccount("displayName", event.target.value)}
                    autoComplete="name"
                    required
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor={`email-${user.id}`}>{t("backoffice.emailAddress")}</Label>
                  <Input
                    id={`email-${user.id}`}
                    type="email"
                    value={account.email}
                    onChange={(event) => {
                      const email = event.target.value;
                      setAccount((current) => ({
                        ...current,
                        email,
                        emailVerified: email.trim().toLowerCase() === user.email.toLowerCase()
                          ? current.emailVerified
                          : false,
                      }));
                    }}
                    autoComplete="email"
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("backoffice.emailChangeHint")}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`verification-${user.id}`}>{t("backoffice.emailVerification")}</Label>
                  <Select
                    value={account.emailVerified ? "verified" : "unverified"}
                    onValueChange={(value) => updateAccount("emailVerified", value === "verified")}
                  >
                    <SelectTrigger id={`verification-${user.id}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="verified">{t("backoffice.verified")}</SelectItem>
                      <SelectItem value="unverified">{t("backoffice.unverified")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`role-${user.id}`}>{t("backoffice.role")}</Label>
                  <Select
                    value={account.role}
                    onValueChange={(value) => updateAccount("role", value as AccountForm["role"])}
                    disabled={user.isCurrentUser}
                  >
                    <SelectTrigger id={`role-${user.id}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">{t("backoffice.user")}</SelectItem>
                      <SelectItem value="admin">{t("backoffice.admin")}</SelectItem>
                    </SelectContent>
                  </Select>
                  {user.isCurrentUser && (
                    <p className="text-xs text-muted-foreground">{t("backoffice.ownRoleProtected")}</p>
                  )}
                </div>
              </div>

              <Button type="submit" disabled={!hasAccountChanges || updateUser.isPending}>
                {updateUser.isPending
                  ? t("backoffice.savingChanges")
                  : t("backoffice.saveAccountChanges")}
              </Button>
            </form>

            <div className="border-t pt-6 xl:border-t-0 xl:border-l xl:pl-6 xl:pt-0">
              <form onSubmit={handlePasswordReset} className="space-y-4">
                <div>
                  <div className="flex items-center gap-2 font-semibold text-foreground">
                    <KeyRound className="h-4 w-4 text-muted-foreground" />
                    {t("backoffice.resetPassword")}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t("backoffice.resetPasswordHint")}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`new-password-${user.id}`}>{t("backoffice.newPassword")}</Label>
                  <Input
                    id={`new-password-${user.id}`}
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    autoComplete="new-password"
                    minLength={10}
                    required
                    placeholder={t("backoffice.passwordMinChars")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`confirm-password-${user.id}`}>{t("backoffice.confirmPassword")}</Label>
                  <Input
                    id={`confirm-password-${user.id}`}
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    autoComplete="new-password"
                    minLength={10}
                    required
                  />
                </div>
                {passwordError && <p className="text-sm text-destructive">{passwordError}</p>}
                <Button type="submit" variant="outline" disabled={!newPassword || !confirmPassword || resetPassword.isPending}>
                  {resetPassword.isPending
                    ? t("backoffice.settingPassword")
                    : t("backoffice.setNewPassword")}
                </Button>
              </form>

              <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-5 text-sm">
                <div>
                  <dt className="text-muted-foreground">{t("backoffice.lastActive")}</dt>
                  <dd className="mt-0.5 font-medium text-foreground">
                    {user.lastActive
                      ? formatDate(new Date(Number(user.lastActive)))
                      : t("common.never")}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("backoffice.joined")}</dt>
                  <dd className="mt-0.5 font-medium text-foreground">
                    {formatDate(user.createdAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("backoffice.bankAccounts")}</dt>
                  <dd className="mt-0.5 font-medium text-foreground">{user.accountCount}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("backoffice.transactions")}</dt>
                  <dd className="mt-0.5 font-medium text-foreground">{formatNumber(user.transactionCount)}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-muted-foreground">{t("backoffice.security")}</dt>
                  <dd className="mt-0.5 font-medium text-foreground">
                    {user.passkeyCount > 0
                      ? plural(user.passkeyCount, "backoffice.passkeys.one", "backoffice.passkeys.other")
                      : t("backoffice.noPasskeys")}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
