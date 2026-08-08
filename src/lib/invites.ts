import crypto from "crypto";

export const INVITE_TTL_DAYS = 14;

export type InviteStatus = "accepted" | "revoked" | "expired" | "pending";

/** 256 bits of entropy — not brute-forceable, so the accept route needs no rate limit. */
export function newInviteToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashInviteToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function inviteExpiry(from: Date = new Date()): string {
  return new Date(from.getTime() + INVITE_TTL_DAYS * 86_400_000).toISOString();
}

/**
 * Derived, never stored — a revoked invite that also expired is still "revoked".
 * ISO-8601 UTC strings compare correctly with `<`.
 */
export function inviteStatus(
  invite: {
    acceptedAt?: string | null;
    revokedAt?: string | null;
    expiresAt: string;
  },
  now: string = new Date().toISOString(),
): InviteStatus {
  if (invite.acceptedAt) return "accepted";
  if (invite.revokedAt) return "revoked";
  if (invite.expiresAt <= now) return "expired";
  return "pending";
}
