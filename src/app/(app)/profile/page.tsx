"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { User, KeyRound, Save, Loader2, Lock, Fingerprint, Trash2 } from "lucide-react";
import { useProfile, useUpdateProfile } from "@/hooks/use-profile";
import { useSetupPin, useRemovePin } from "@/hooks/use-pin";
import { useRegisterPasskey } from "@/hooks/use-passkey";
import { authClient } from "@/lib/auth-client";
import { ApiError } from "@/lib/api";

export default function ProfilePage() {
  const router = useRouter();
  const { data: profile, isLoading, error } = useProfile();
  const updateProfile = useUpdateProfile();

  // Redirect on 401
  useEffect(() => {
    if (error && (error as ApiError).status === 401) router.push("/login");
  }, [error, router]);

  // Profile form
  const [displayUsername, setDisplayUsername] = useState("");
  const [username, setUsername] = useState("");
  const [saving, setSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Password form
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPw, setChangingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // PIN form
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [pinPassword, setPinPassword] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinMsg, setPinMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [hasPin, setHasPin] = useState(false);
  const setupPin = useSetupPin();
  const removePin = useRemovePin();

  // Passkey
  const [passkeyMsg, setPasskeyMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [passkeys, setPasskeys] = useState<Array<{ id: string; name?: string | null; createdAt?: Date | null }>>([]);
  const [webAuthnSupported, setWebAuthnSupported] = useState(false);
  const { register: registerPasskey } = useRegisterPasskey();
  const [registeringPasskey, setRegisteringPasskey] = useState(false);
  const [removePinPassword, setRemovePinPassword] = useState("");
  const [showRemovePin, setShowRemovePin] = useState(false);
  const [deletePasskeyId, setDeletePasskeyId] = useState<string | null>(null);
  const [deletePasskeyPassword, setDeletePasskeyPassword] = useState("");
  const [deletingPasskey, setDeletingPasskey] = useState(false);

  // Sync profile data to form state
  useEffect(() => {
    if (profile) {
      setDisplayUsername(profile.displayUsername);
      setUsername(profile.username);
    }
  }, [profile]);

  // Check PIN status and WebAuthn support
  useEffect(() => {
    if (profile?.username) {
      fetch(`/api/auth/pin/status`)
        .then((r) => r.json())
        .then((d) => setHasPin(d.hasPin))
        .catch(() => {});
    }

    if (typeof window !== "undefined" && window.PublicKeyCredential) {
      setWebAuthnSupported(true);
    }
  }, [profile?.username]);

  // Load passkeys
  const loadPasskeys = async () => {
    try {
      const res = await fetch("/api/auth/passkey/list-user-passkeys", { method: "GET" });
      if (res.ok) {
        const data = await res.json();
        setPasskeys(data);
      }
    } catch {}
  };

  useEffect(() => {
    if (webAuthnSupported) {
      loadPasskeys();
    }
  }, [webAuthnSupported]);

  async function handleProfileSave(e: React.FormEvent) {
    e.preventDefault();
    setProfileMsg(null);
    setSaving(true);
    try {
      await updateProfile.mutateAsync({ displayUsername, username });
      setProfileMsg({ type: "success", text: "Profile updated successfully" });
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setProfileMsg({ type: "error", text: err.message });
      } else {
        setProfileMsg({ type: "error", text: "Failed to update profile" });
      }
    } finally {
      setSaving(false);
    }
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg(null);

    if (newPassword !== confirmPassword) {
      setPwMsg({ type: "error", text: "New passwords do not match" });
      return;
    }

    setChangingPw(true);
    try {
      await updateProfile.mutateAsync({ currentPassword, newPassword });
      setPwMsg({ type: "success", text: "Password changed successfully" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      if (err instanceof ApiError) {
        setPwMsg({ type: "error", text: err.message });
      } else {
        setPwMsg({ type: "error", text: "Failed to change password" });
      }
    } finally {
      setChangingPw(false);
    }
  }

  async function handlePinSetup(e: React.FormEvent) {
    e.preventDefault();
    setPinMsg(null);

    if (pin !== confirmPin) {
      setPinMsg({ type: "error", text: "PINs do not match" });
      return;
    }

    try {
      await setupPin.mutateAsync({ pin, currentPassword: pinPassword });
      setPinMsg({ type: "success", text: hasPin ? "PIN updated successfully" : "PIN set up successfully" });
      setHasPin(true);
      setShowPinSetup(false);
      setPin("");
      setConfirmPin("");
      setPinPassword("");
    } catch (err) {
      if (err instanceof ApiError) {
        setPinMsg({ type: "error", text: err.message });
      } else {
        setPinMsg({ type: "error", text: "Failed to set up PIN" });
      }
    }
  }

  async function handleRemovePin(e: React.FormEvent) {
    e.preventDefault();
    setPinMsg(null);

    try {
      await removePin.mutateAsync({ currentPassword: removePinPassword });
      setPinMsg({ type: "success", text: "PIN removed successfully" });
      setHasPin(false);
      setShowRemovePin(false);
      setRemovePinPassword("");
    } catch (err) {
      if (err instanceof ApiError) {
        setPinMsg({ type: "error", text: err.message });
      } else {
        setPinMsg({ type: "error", text: "Failed to remove PIN" });
      }
    }
  }

  async function handleRegisterPasskey() {
    setPasskeyMsg(null);
    setRegisteringPasskey(true);
    try {
      await registerPasskey();
      setPasskeyMsg({ type: "success", text: "Passkey registered successfully" });
      await loadPasskeys();
    } catch (err) {
      setPasskeyMsg({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to register passkey",
      });
    } finally {
      setRegisteringPasskey(false);
    }
  }

  async function handleDeletePasskey(e: React.FormEvent) {
    e.preventDefault();
    if (!deletePasskeyId) return;
    setPasskeyMsg(null);
    setDeletingPasskey(true);
    try {
      const res = await fetch("/api/auth/passkey/delete-passkey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deletePasskeyId, currentPassword: deletePasskeyPassword }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setPasskeyMsg({ type: "error", text: data.error || "Failed to remove passkey" });
        return;
      }
      setPasskeys((prev) => prev.filter((p) => p.id !== deletePasskeyId));
      setPasskeyMsg({ type: "success", text: "Passkey removed" });
      setDeletePasskeyId(null);
      setDeletePasskeyPassword("");
    } catch {
      setPasskeyMsg({ type: "error", text: "Failed to remove passkey" });
    } finally {
      setDeletingPasskey(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!profile) return null;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
        <p className="text-muted-foreground">
          Manage your account settings
        </p>
      </div>

      {/* Profile Info Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <User className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle>Personal Information</CardTitle>
              <CardDescription>Update your display name and username</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleProfileSave} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="displayUsername" className="text-sm font-medium">
                Display Name
              </label>
              <input
                id="displayUsername"
                type="text"
                value={displayUsername}
                onChange={(e) => setDisplayUsername(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                required
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="username" className="text-sm font-medium">
                Username
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                required
              />
            </div>
            {profileMsg && (
              <p
                className={`text-sm ${profileMsg.type === "error" ? "text-destructive" : "text-green-600 dark:text-green-400"}`}
              >
                {profileMsg.text}
              </p>
            )}
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save Changes
            </button>
          </form>
        </CardContent>
      </Card>

      {/* Change Password Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <KeyRound className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle>Change Password</CardTitle>
              <CardDescription>Update your account password</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePasswordChange} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="currentPassword" className="text-sm font-medium">
                Current Password
              </label>
              <input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                required
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="newPassword" className="text-sm font-medium">
                New Password
              </label>
              <input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                required
                minLength={4}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="confirmPassword" className="text-sm font-medium">
                Confirm New Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                required
                minLength={4}
              />
            </div>
            {pwMsg && (
              <p
                className={`text-sm ${pwMsg.type === "error" ? "text-destructive" : "text-green-600 dark:text-green-400"}`}
              >
                {pwMsg.text}
              </p>
            )}
            <button
              type="submit"
              disabled={changingPw}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {changingPw ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <KeyRound className="h-4 w-4" />
              )}
              Change Password
            </button>
          </form>
        </CardContent>
      </Card>

      {/* PIN Setup Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <Lock className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle>PIN Code</CardTitle>
              <CardDescription>
                {hasPin
                  ? "You have a PIN set up for quick login"
                  : "Set up a PIN for quick mobile login"}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {pinMsg && (
            <p
              className={`mb-4 text-sm ${pinMsg.type === "error" ? "text-destructive" : "text-green-600 dark:text-green-400"}`}
            >
              {pinMsg.text}
            </p>
          )}

          {!showPinSetup && !showRemovePin && (
            <div className="flex gap-2">
              <button
                onClick={() => { setShowPinSetup(true); setPinMsg(null); }}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Lock className="h-4 w-4" />
                {hasPin ? "Change PIN" : "Set up PIN"}
              </button>
              {hasPin && (
                <button
                  onClick={() => { setShowRemovePin(true); setPinMsg(null); }}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                  Remove PIN
                </button>
              )}
            </div>
          )}

          {showPinSetup && (
            <form onSubmit={handlePinSetup} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="pinPassword" className="text-sm font-medium">
                  Current Password
                </label>
                <input
                  id="pinPassword"
                  type="password"
                  value={pinPassword}
                  onChange={(e) => setPinPassword(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  required
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="pin" className="text-sm font-medium">
                  PIN (4-6 digits)
                </label>
                <input
                  id="pin"
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm tracking-[0.5em] text-center ring-offset-background placeholder:text-muted-foreground placeholder:tracking-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  placeholder="Enter PIN"
                  required
                  minLength={4}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="confirmPin" className="text-sm font-medium">
                  Confirm PIN
                </label>
                <input
                  id="confirmPin"
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm tracking-[0.5em] text-center ring-offset-background placeholder:text-muted-foreground placeholder:tracking-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  placeholder="Confirm PIN"
                  required
                  minLength={4}
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={setupPin.isPending}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {setupPin.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {hasPin ? "Update PIN" : "Set PIN"}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowPinSetup(false); setPin(""); setConfirmPin(""); setPinPassword(""); setPinMsg(null); }}
                  className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {showRemovePin && (
            <form onSubmit={handleRemovePin} className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Enter your password to confirm PIN removal.
              </p>
              <div className="space-y-2">
                <label htmlFor="removePinPassword" className="text-sm font-medium">
                  Current Password
                </label>
                <input
                  id="removePinPassword"
                  type="password"
                  value={removePinPassword}
                  onChange={(e) => setRemovePinPassword(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  required
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={removePin.isPending}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition-colors"
                >
                  {removePin.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  Remove PIN
                </button>
                <button
                  type="button"
                  onClick={() => { setShowRemovePin(false); setRemovePinPassword(""); setPinMsg(null); }}
                  className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      {/* Passkey / Biometric Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <Fingerprint className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle>Face ID / Biometric Login</CardTitle>
              <CardDescription>
                Use biometrics for quick, secure sign-in
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {passkeyMsg && (
            <p
              className={`mb-4 text-sm ${passkeyMsg.type === "error" ? "text-destructive" : "text-green-600 dark:text-green-400"}`}
            >
              {passkeyMsg.text}
            </p>
          )}

          {!webAuthnSupported ? (
            <p className="text-sm text-muted-foreground">
              Biometric login is not available on this device or browser.
            </p>
          ) : (
            <div className="space-y-4">
              {passkeys.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Registered passkeys</p>
                  {passkeys.map((pk) => (
                    <div key={pk.id}>
                      <div className="flex items-center justify-between rounded-md border p-3">
                        <div className="flex items-center gap-2">
                          <Fingerprint className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">
                            {pk.name || "Passkey"}
                          </span>
                          {pk.createdAt && (
                            <span className="text-xs text-muted-foreground">
                              {new Date(pk.createdAt).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => { setDeletePasskeyId(pk.id); setDeletePasskeyPassword(""); setPasskeyMsg(null); }}
                          className="inline-flex items-center justify-center rounded-md p-1 text-muted-foreground hover:text-destructive transition-colors"
                          title="Remove passkey"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      {deletePasskeyId === pk.id && (
                        <form onSubmit={handleDeletePasskey} className="mt-2 space-y-3 rounded-md border border-destructive/20 bg-destructive/5 p-3">
                          <p className="text-sm text-muted-foreground">
                            Enter your password to confirm passkey removal.
                          </p>
                          <div className="space-y-2">
                            <label htmlFor={`deletePasskeyPw-${pk.id}`} className="text-sm font-medium">
                              Current Password
                            </label>
                            <input
                              id={`deletePasskeyPw-${pk.id}`}
                              type="password"
                              value={deletePasskeyPassword}
                              onChange={(e) => setDeletePasskeyPassword(e.target.value)}
                              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                              required
                              autoFocus
                            />
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="submit"
                              disabled={deletingPasskey}
                              className="inline-flex items-center justify-center gap-2 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition-colors"
                            >
                              {deletingPasskey ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                              Remove Passkey
                            </button>
                            <button
                              type="button"
                              onClick={() => { setDeletePasskeyId(null); setDeletePasskeyPassword(""); setPasskeyMsg(null); }}
                              className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={handleRegisterPasskey}
                disabled={registeringPasskey}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {registeringPasskey ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Fingerprint className="h-4 w-4" />
                )}
                {passkeys.length > 0
                  ? "Add another passkey"
                  : "Set up Face ID / Touch ID"}
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Account Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Account Info</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Role</span>
            <span className="font-medium">{profile.isAdmin ? "Admin" : "User"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Member since</span>
            <span className="font-medium">
              {new Date(profile.createdAt).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
