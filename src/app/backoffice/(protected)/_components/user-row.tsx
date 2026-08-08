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

type AccountForm = {
  displayUsername: string;
  username: string;
  email: string;
  emailVerified: boolean;
  role: "admin" | "user";
};

function accountValues(user: AdminUser): AccountForm {
  return {
    displayUsername: user.displayUsername,
    username: user.username,
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
  const deleteUser = useDeleteUser();
  const resetPassword = useResetPassword();
  const setBanned = useSetBanned();
  const updateUser = useUpdateUser();

  const [account, setAccount] = useState<AccountForm>(() => accountValues(user));
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");

  const hasAccountChanges =
    account.displayUsername.trim() !== user.displayUsername ||
    account.username.trim() !== user.username ||
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
    if (!confirm(`Delete user "${user.username}" and all their data? This cannot be undone.`)) return;
    try {
      await deleteUser.mutateAsync(user.id);
    } catch (err) {
      fail(err, "Failed to delete user");
    }
  }

  async function handleToggleBan() {
    try {
      if (user.banned) {
        await setBanned.mutateAsync({ id: user.id, banned: false });
      } else {
        const reason = prompt(
          `Ban "${user.username}"? Their sessions are revoked and sign-in is blocked.\n\nOptional reason:`,
        );
        if (reason === null) return;
        await setBanned.mutateAsync({ id: user.id, banned: true, banReason: reason || undefined });
      }
    } catch (err) {
      fail(err, user.banned ? "Failed to unban user" : "Failed to ban user");
    }
  }

  async function handleSaveAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hasAccountChanges) return;

    const payload: UserUpdate = { id: user.id };
    const cleanUsername = account.username.trim();
    const cleanDisplayName = account.displayUsername.trim();
    const cleanEmail = account.email.trim().toLowerCase();

    if (cleanUsername !== user.username) payload.username = cleanUsername;
    if (cleanDisplayName !== user.displayUsername) payload.displayUsername = cleanDisplayName;
    if (cleanEmail !== user.email.toLowerCase()) payload.email = cleanEmail;
    if (account.emailVerified !== user.emailVerified) payload.emailVerified = account.emailVerified;
    if (!user.isCurrentUser && account.role !== user.role) {
      payload.isAdmin = account.role === "admin";
    }

    try {
      await updateUser.mutateAsync(payload);
    } catch (err) {
      fail(err, "Failed to update account");
    }
  }

  async function handlePasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError("");
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match.");
      return;
    }

    try {
      await resetPassword.mutateAsync({ id: user.id, password: newPassword });
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      const message = err instanceof ApiError ? err.message || "Failed to reset password" : "Failed to reset password";
      setPasswordError(message);
    }
  }

  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
            {user.displayUsername.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate font-medium text-foreground">{user.displayUsername}</p>
              <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                {user.role === "admin" ? "Admin" : "User"}
              </span>
              {user.banned && (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-500/20 dark:text-red-400"
                  title={user.banReason || undefined}
                >
                  <Ban className="h-3 w-3" />
                  Banned
                </span>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <span className="truncate">{user.email}</span>
              <span aria-hidden="true">·</span>
              <span>@{user.username}</span>
              <span
                className={user.emailVerified ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}
              >
                {user.emailVerified ? "Verified" : "Unverified"}
              </span>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant={expanded ? "secondary" : "outline"} size="sm" onClick={toggleManage}>
            <Settings2 className="h-4 w-4" />
            Manage
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={handleToggleBan}
            disabled={user.isCurrentUser || setBanned.isPending}
            className="hover:border-red-200 hover:bg-red-50 hover:text-red-700 dark:hover:border-red-900 dark:hover:bg-red-950/40 dark:hover:text-red-400"
            aria-label={user.banned ? `Unban ${user.displayUsername}` : `Ban ${user.displayUsername}`}
            title={user.isCurrentUser ? "You cannot ban your own account" : user.banned ? "Unban user" : "Ban user"}
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
            aria-label={`Delete ${user.displayUsername}`}
            title={user.isCurrentUser ? "You cannot delete your own account" : "Delete user"}
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
                <h2 className="font-semibold text-foreground">Account details</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Update identity, access level, and email verification in one place.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor={`display-name-${user.id}`}>Display name</Label>
                  <Input
                    id={`display-name-${user.id}`}
                    value={account.displayUsername}
                    onChange={(event) => updateAccount("displayUsername", event.target.value)}
                    autoComplete="name"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`username-${user.id}`}>Username</Label>
                  <Input
                    id={`username-${user.id}`}
                    value={account.username}
                    onChange={(event) => updateAccount("username", event.target.value)}
                    autoComplete="username"
                    required
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor={`email-${user.id}`}>Email address</Label>
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
                    Changing the address marks it unverified until you explicitly verify it below.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`verification-${user.id}`}>Email verification</Label>
                  <Select
                    value={account.emailVerified ? "verified" : "unverified"}
                    onValueChange={(value) => updateAccount("emailVerified", value === "verified")}
                  >
                    <SelectTrigger id={`verification-${user.id}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="verified">Verified</SelectItem>
                      <SelectItem value="unverified">Unverified</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`role-${user.id}`}>Role</Label>
                  <Select
                    value={account.role}
                    onValueChange={(value) => updateAccount("role", value as AccountForm["role"])}
                    disabled={user.isCurrentUser}
                  >
                    <SelectTrigger id={`role-${user.id}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                  {user.isCurrentUser && (
                    <p className="text-xs text-muted-foreground">Your own role is protected.</p>
                  )}
                </div>
              </div>

              <Button type="submit" disabled={!hasAccountChanges || updateUser.isPending}>
                {updateUser.isPending ? "Saving changes…" : "Save account changes"}
              </Button>
            </form>

            <div className="border-t pt-6 xl:border-t-0 xl:border-l xl:pl-6 xl:pt-0">
              <form onSubmit={handlePasswordReset} className="space-y-4">
                <div>
                  <div className="flex items-center gap-2 font-semibold text-foreground">
                    <KeyRound className="h-4 w-4 text-muted-foreground" />
                    Reset password
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Set a new password for this user. They can use it immediately.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`new-password-${user.id}`}>New password</Label>
                  <Input
                    id={`new-password-${user.id}`}
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    autoComplete="new-password"
                    minLength={10}
                    required
                    placeholder="At least 10 characters"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`confirm-password-${user.id}`}>Confirm password</Label>
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
                  {resetPassword.isPending ? "Setting password…" : "Set new password"}
                </Button>
              </form>

              <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-5 text-sm">
                <div>
                  <dt className="text-muted-foreground">Last active</dt>
                  <dd className="mt-0.5 font-medium text-foreground">
                    {user.lastActive ? new Date(Number(user.lastActive)).toLocaleDateString() : "Never"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Joined</dt>
                  <dd className="mt-0.5 font-medium text-foreground">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Bank accounts</dt>
                  <dd className="mt-0.5 font-medium text-foreground">{user.accountCount}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Transactions</dt>
                  <dd className="mt-0.5 font-medium text-foreground">{user.transactionCount.toLocaleString()}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-muted-foreground">Security</dt>
                  <dd className="mt-0.5 font-medium text-foreground">
                    {user.hasPin ? "PIN set" : "No PIN"}
                    {user.passkeyCount > 0 && ` · ${user.passkeyCount} passkey${user.passkeyCount > 1 ? "s" : ""}`}
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
