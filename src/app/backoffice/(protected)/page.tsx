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
import { UserPlus, ScrollText } from "lucide-react";
import {
  useAdminUsers,
  useAppSettings,
  useUpdateAppSettings,
} from "@/hooks/use-admin";
import { Checkbox } from "@/components/ui/checkbox";
import { ApiError } from "@/lib/api";
import { UserRow } from "./_components/user-row";
import { InviteUserForm } from "./_components/invite-user-form";
import { InviteList } from "./_components/invite-list";

function SignupToggleCard({ onError }: { onError: (msg: string) => void }) {
  const { data: settings } = useAppSettings();
  const updateSettings = useUpdateAppSettings();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign-ups</CardTitle>
        <CardDescription>
          When enabled, anyone can create an account with a verified email
          address.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <label className="flex w-fit cursor-pointer items-center gap-2 text-sm font-medium">
          <Checkbox
            checked={settings?.signupsEnabled ?? false}
            disabled={!settings || updateSettings.isPending}
            onCheckedChange={(checked) =>
              updateSettings.mutate(
                { signupsEnabled: checked === true },
                { onError: (e) => onError(e.message || "Failed to update settings") },
              )
            }
          />
          Allow public sign-ups
        </label>
      </CardContent>
    </Card>
  );
}

export default function AdminPage() {
  const router = useRouter();
  const { data: users = [], isLoading, error: fetchError } = useAdminUsers();

  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  // Redirect on 403
  useEffect(() => {
    if (fetchError && (fetchError as ApiError).status === 403) router.push("/");
  }, [fetchError, router]);

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
            href="/backoffice/audit-logs"
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
            Invite User
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      {showForm && <InviteUserForm onClose={() => setShowForm(false)} onError={setError} />}

      <InviteList onError={setError} />

      <SignupToggleCard onError={setError} />

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
              <UserRow
                key={user.id}
                user={user}
                expanded={expandedUserId === user.id}
                onToggleExpand={() => setExpandedUserId(expandedUserId === user.id ? null : user.id)}
                onError={setError}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
