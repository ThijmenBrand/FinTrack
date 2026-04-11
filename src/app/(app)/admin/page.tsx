"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Shield, UserPlus, Trash2, KeyRound, Pencil, ChevronDown, ChevronUp, ScrollText } from "lucide-react";
import { useAdminUsers, useCreateUser, useDeleteUser, useResetPassword, useUpdateDisplayName } from "@/hooks/use-admin";
import type { AdminUser } from "@/types/api";
import { ApiError } from "@/lib/api";

export default function AdminPage() {
  const router = useRouter();
  const { data: users = [], isLoading, error: fetchError } = useAdminUsers();
  const createUser = useCreateUser();
  const deleteUser = useDeleteUser();
  const resetPw = useResetPassword();
  const updateDisplayName = useUpdateDisplayName();

  const [error, setError] = useState("");

  // Redirect on 403
  useEffect(() => {
    if (fetchError && (fetchError as ApiError).status === 403) router.push("/");
  }, [fetchError, router]);

  // Create user form
  const [showForm, setShowForm] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newDisplayUsername, setNewDisplayUsername] = useState("");
  const [newIsAdmin, setNewIsAdmin] = useState(false);
  const [creating, setCreating] = useState(false);

  // Reset password
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");

  // Edit display name
  const [editDisplayUserId, setEditDisplayUserId] = useState<string | null>(null);
  const [editDisplayName, setEditDisplayName] = useState("");

  // Expanded user details
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError("");

    try {
      await createUser.mutateAsync({
        username: newUsername,
        password: newPassword,
        displayUsername: newDisplayUsername,
        isAdmin: newIsAdmin,
      });

      setShowForm(false);
      setNewUsername("");
      setNewPassword("");
      setNewDisplayUsername("");
      setNewIsAdmin(false);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message || "Failed to create user");
      } else {
        setError("Failed to create user");
      }
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string, username: string) {
    if (!confirm(`Delete user "${username}" and all their data? This cannot be undone.`)) return;

    try {
      await deleteUser.mutateAsync(id);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message || "Failed to delete user");
      } else {
        setError("Failed to delete user");
      }
    }
  }

  async function handleUpdateDisplayName(id: string) {
    if (!editDisplayName.trim()) return;
    try {
      await updateDisplayName.mutateAsync({ id, displayUsername: editDisplayName.trim() });
      setEditDisplayUserId(null);
      setEditDisplayName("");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message || "Failed to update display name");
      } else {
        setError("Failed to update display name");
      }
    }
  }

  async function handleResetPassword(id: string) {
    if (!resetPassword) return;

    try {
      await resetPw.mutateAsync({ id, password: resetPassword });
      setResetUserId(null);
      setResetPassword("");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message || "Failed to reset password");
      } else {
        setError("Failed to reset password");
      }
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">User Management</h1>
          <p className="text-muted-foreground">
            Create and manage user accounts
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/audit-logs"
            className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
          >
            <ScrollText className="h-4 w-4" />
            Audit Logs
          </Link>
          <button
            onClick={() => setShowForm(!showForm)}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
          >
            <UserPlus className="h-4 w-4" />
            New User
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Create user form */}
      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>Create User</CardTitle>
            <CardDescription>
              Add a new user account. They will be able to log in immediately.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Username</label>
                  <input
                    type="text"
                    required
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    placeholder="username"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Display Name</label>
                  <input
                    type="text"
                    required
                    value={newDisplayUsername}
                    onChange={(e) => setNewDisplayUsername(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    placeholder="Display Name"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Password</label>
                  <input
                    type="password"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    placeholder="Password"
                  />
                </div>
                <div className="flex items-end gap-2 pb-1">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={newIsAdmin}
                      onChange={(e) => setNewIsAdmin(e.target.checked)}
                      className="rounded"
                    />
                    Admin privileges
                  </label>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={creating}
                  className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-50"
                >
                  {creating ? "Creating..." : "Create User"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="inline-flex items-center rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
                >
                  Cancel
                </button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* User list */}
      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
          <CardDescription>
            {users.length} user{users.length !== 1 ? "s" : ""} registered
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {users.map((user) => (
              <div key={user.id} className="rounded-lg border">
                <div className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                      {user.displayUsername.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      {editDisplayUserId === user.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={editDisplayName}
                            onChange={(e) => setEditDisplayName(e.target.value)}
                            className="h-8 w-48 rounded-md border border-input bg-background px-2 text-sm"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleUpdateDisplayName(user.id);
                              if (e.key === "Escape") { setEditDisplayUserId(null); setEditDisplayName(""); }
                            }}
                          />
                          <button
                            onClick={() => handleUpdateDisplayName(user.id)}
                            className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => { setEditDisplayUserId(null); setEditDisplayName(""); }}
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
                              setEditDisplayUserId(user.id);
                              setEditDisplayName(user.displayUsername);
                              setResetUserId(null);
                              setResetPassword("");
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
                        </div>
                      )}
                      <p className="text-sm text-muted-foreground">
                        @{user.username} &middot; Joined{" "}
                        {new Date(user.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {resetUserId === user.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="password"
                          value={resetPassword}
                          onChange={(e) => setResetPassword(e.target.value)}
                          placeholder="New password"
                          className="h-8 w-36 rounded-md border border-input bg-background px-2 text-sm"
                        />
                        <button
                          onClick={() => handleResetPassword(user.id)}
                          className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => {
                            setResetUserId(null);
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
                          onClick={() => setExpandedUserId(expandedUserId === user.id ? null : user.id)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-muted hover:text-foreground"
                          title="Show details"
                        >
                          {expandedUserId === user.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                        <button
                          onClick={() => {
                            setResetUserId(user.id);
                            setResetPassword("");
                            setEditDisplayUserId(null);
                            setEditDisplayName("");
                          }}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-muted hover:text-foreground"
                          title="Reset password"
                        >
                          <KeyRound className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(user.id, user.username)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                          title="Delete user"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {expandedUserId === user.id && (
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
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
