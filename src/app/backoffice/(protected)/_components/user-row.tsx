"use client";

import { useState } from "react";
import { Shield, Trash2, KeyRound, Pencil, ChevronDown, ChevronUp, Ban } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useDeleteUser, useResetPassword, useUpdateDisplayName, useSetBanned, useUpdateUserEmail } from "@/hooks/use-admin";
import type { AdminUser } from "@/types/api";
import { ApiError } from "@/lib/api";

type Mode = "view" | "editDisplay" | "editEmail" | "resetPassword";

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
  const resetPw = useResetPassword();
  const updateDisplayName = useUpdateDisplayName();
  const setBanned = useSetBanned();
  const updateEmail = useUpdateUserEmail();

  const [mode, setMode] = useState<Mode>("view");
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [resetPassword, setResetPassword] = useState("");

  function fail(err: unknown, fallback: string) {
    onError(err instanceof ApiError ? err.message || fallback : fallback);
  }

  async function handleDelete() {
    if (!confirm(`Delete user "${user.username}" and all their data? This cannot be undone.`)) return;
    try {
      await deleteUser.mutateAsync(user.id);
    } catch (err) {
      fail(err, "Failed to delete user");
    }
  }

  async function handleUpdateDisplayName() {
    if (!editDisplayName.trim()) return;
    try {
      await updateDisplayName.mutateAsync({ id: user.id, displayUsername: editDisplayName.trim() });
      setMode("view");
      setEditDisplayName("");
    } catch (err) {
      fail(err, "Failed to update display name");
    }
  }

  // Changing the address clears verification server-side — the admin re-confirms
  // with the badge below, which is how legacy @local accounts get migrated.
  async function handleUpdateEmail() {
    if (!editEmail.trim()) return;
    try {
      await updateEmail.mutateAsync({ id: user.id, email: editEmail.trim() });
      setMode("view");
      setEditEmail("");
    } catch (err) {
      fail(err, "Failed to update email");
    }
  }

  async function handleToggleVerified() {
    try {
      await updateEmail.mutateAsync({ id: user.id, emailVerified: !user.emailVerified });
    } catch (err) {
      fail(err, "Failed to update email verification");
    }
  }

  async function handleToggleBan() {
    try {
      if (user.banned) {
        await setBanned.mutateAsync({ id: user.id, banned: false });
      } else {
        const reason = prompt(`Ban "${user.username}"? Their sessions are revoked and sign-in is blocked.\n\nOptional reason:`);
        if (reason === null) return; // cancelled
        await setBanned.mutateAsync({ id: user.id, banned: true, banReason: reason || undefined });
      }
    } catch (err) {
      fail(err, user.banned ? "Failed to unban user" : "Failed to ban user");
    }
  }

  async function handleResetPassword() {
    if (!resetPassword) return;
    try {
      await resetPw.mutateAsync({ id: user.id, password: resetPassword });
      setMode("view");
      setResetPassword("");
    } catch (err) {
      fail(err, "Failed to reset password");
    }
  }

  return (
    <div className="rounded-lg border">
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            {user.displayUsername.charAt(0).toUpperCase()}
          </div>
          <div>
            {mode === "editDisplay" ? (
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  value={editDisplayName}
                  onChange={(e) => setEditDisplayName(e.target.value)}
                  className="h-8 w-48"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleUpdateDisplayName();
                    if (e.key === "Escape") {
                      setMode("view");
                      setEditDisplayName("");
                    }
                  }}
                />
                <button
                  onClick={handleUpdateDisplayName}
                  className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                >
                  Save
                </button>
                <button
                  onClick={() => {
                    setMode("view");
                    setEditDisplayName("");
                  }}
                  className="h-8 rounded-md border px-3 text-xs font-medium hover:bg-muted"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <p className="font-medium">{user.displayUsername}</p>
                <button
                  onClick={() => {
                    setMode("editDisplay");
                    setEditDisplayName(user.displayUsername);
                  }}
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                  title="Edit display name"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                {user.isAdmin && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-500/20 dark:text-amber-400">
                    <Shield className="h-3 w-3" />
                    Admin
                  </span>
                )}
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
            )}
            {mode === "editEmail" ? (
              <div className="mt-1 flex items-center gap-2">
                <Input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="h-8 w-56"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleUpdateEmail();
                    if (e.key === "Escape") {
                      setMode("view");
                      setEditEmail("");
                    }
                  }}
                />
                <button
                  onClick={handleUpdateEmail}
                  className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                >
                  Save
                </button>
                <button
                  onClick={() => {
                    setMode("view");
                    setEditEmail("");
                  }}
                  className="h-8 rounded-md border px-3 text-xs font-medium hover:bg-muted"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                <span>{user.email}</span>
                <button
                  onClick={() => {
                    setMode("editEmail");
                    setEditEmail(user.email);
                  }}
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                  title="Change email"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  onClick={handleToggleVerified}
                  disabled={updateEmail.isPending}
                  className={`rounded-full px-2 py-0.5 text-xs font-medium disabled:opacity-50 ${
                    user.emailVerified
                      ? "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400"
                      : "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400"
                  }`}
                  title={user.emailVerified ? "Mark unverified" : "Mark verified"}
                >
                  {user.emailVerified ? "Verified" : "Unverified"}
                </button>
                <span>
                  &middot; @{user.username} &middot; Joined{" "}
                  {new Date(user.createdAt).toLocaleDateString()}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {mode === "resetPassword" ? (
            <div className="flex items-center gap-2">
              <Input
                type="password"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                placeholder="New password"
                className="h-8 w-36"
              />
              <button
                onClick={handleResetPassword}
                className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                Save
              </button>
              <button
                onClick={() => {
                  setMode("view");
                  setResetPassword("");
                }}
                className="h-8 rounded-md border px-3 text-xs font-medium hover:bg-muted"
              >
                Cancel
              </button>
            </div>
          ) : (
            <>
              <button
                onClick={onToggleExpand}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Show details"
              >
                {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              <button
                onClick={() => {
                  setMode("resetPassword");
                  setResetPassword("");
                }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Reset password"
              >
                <KeyRound className="h-4 w-4" />
              </button>
              <button
                onClick={handleToggleBan}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                title={user.banned ? "Unban user" : "Ban user"}
              >
                <Ban className="h-4 w-4" />
              </button>
              <button
                onClick={handleDelete}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                title="Delete user"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t px-4 py-3 text-sm text-muted-foreground">
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 sm:grid-cols-4">
            <div>
              <p className="text-xs font-medium text-foreground">Last Active</p>
              <p>{user.lastActive ? new Date(Number(user.lastActive)).toLocaleDateString() : "Never"}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-foreground">Bank Accounts</p>
              <p>{user.accountCount}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-foreground">Transactions</p>
              <p>{user.transactionCount.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-foreground">Security</p>
              <p>
                {user.hasPin ? "PIN set" : "No PIN"}
                {user.passkeyCount > 0 ? ` · ${user.passkeyCount} passkey${user.passkeyCount > 1 ? "s" : ""}` : ""}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
