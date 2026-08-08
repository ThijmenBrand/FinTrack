"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Landmark } from "lucide-react";
import { MIN_PASSWORD_LENGTH } from "@/lib/validation";

const inputClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

interface InviteInfo {
  email: string;
  displayName: string | null;
}

export default function InvitePage() {
  const router = useRouter();
  const token = useRef("");
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [checked, setChecked] = useState(false);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // window.location instead of useSearchParams to avoid a Suspense boundary
    const t = new URLSearchParams(window.location.search).get("token") || "";
    token.current = t;
    (t
      ? fetch(`/api/invites/accept?token=${encodeURIComponent(t)}`)
          .then((r) => (r.ok ? (r.json() as Promise<InviteInfo>) : null))
          .catch(() => null)
      : Promise.resolve(null)
    )
      .then((data) => {
        setInvite(data);
        setDisplayName(data?.displayName || "");
      })
      .finally(() => setChecked(true));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/invites/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: token.current,
          username: username.trim(),
          displayName: displayName.trim(),
          password,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || "Could not accept this invite");
        return;
      }

      if (data.signedIn === false) {
        router.push("/login");
        return;
      }

      localStorage.setItem("lockscreen_username", invite!.email);
      localStorage.setItem("lockscreen_last_active", String(Date.now()));
      router.push("/");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="rounded-xl border bg-card p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Landmark className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            FinTrack
          </h1>
          <p className="text-sm text-muted-foreground">
            {invite ? "Set up your account" : "Invitation"}
          </p>
        </div>

        {!checked ? (
          <p className="text-center text-sm text-muted-foreground">Loading...</p>
        ) : !invite ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-muted-foreground">
              This invite link is invalid, expired, or has already been used. Ask
              an administrator for a new one.
            </p>
            <Link
              href="/login"
              className="inline-flex h-10 w-full items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none text-foreground">
                Email
              </label>
              <input
                type="email"
                value={invite.email}
                readOnly
                className={`${inputClass} cursor-not-allowed text-muted-foreground`}
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="username"
                className="text-sm font-medium leading-none text-foreground"
              >
                Username
              </label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                autoFocus
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className={inputClass}
                placeholder="Choose a username"
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="displayName"
                className="text-sm font-medium leading-none text-foreground"
              >
                Display name
              </label>
              <input
                id="displayName"
                type="text"
                autoComplete="name"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className={inputClass}
                placeholder="How should we call you?"
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="password"
                className="text-sm font-medium leading-none text-foreground"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
                placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              />
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
            >
              {loading ? "Creating account..." : "Create account"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
