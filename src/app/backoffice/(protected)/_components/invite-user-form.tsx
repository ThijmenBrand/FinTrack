"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useCreateInvite } from "@/hooks/use-admin";
import { ApiError } from "@/lib/api";

export function InviteUserForm({
  onClose,
  onError,
}: {
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const createInvite = useCreateInvite();

  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [sending, setSending] = useState(false);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    onError("");

    try {
      await createInvite.mutateAsync({
        email: email.trim(),
        displayName: displayName.trim() || undefined,
        isAdmin,
      });

      onClose();
      setEmail("");
      setDisplayName("");
      setIsAdmin(false);
    } catch (err) {
      onError(err instanceof ApiError ? err.message || "Failed to send invite" : "Failed to send invite");
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite User</CardTitle>
        <CardDescription>
          They receive a link to pick a username and password. The account is
          created — with a verified email — once they accept.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleInvite} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Email</label>
              <Input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-10"
                placeholder="them@example.com"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Display Name <span className="text-muted-foreground">(optional)</span>
              </label>
              <Input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="h-10"
                placeholder="They can change this"
              />
            </div>
            <div className="flex items-end gap-2 pb-1">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isAdmin}
                  onChange={(e) => setIsAdmin(e.target.checked)}
                  className="rounded"
                />
                Admin privileges
              </label>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={sending}
              className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-50"
            >
              {sending ? "Sending..." : "Send Invite"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
