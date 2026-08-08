import { describe, it, expect } from "vitest";
import {
  INVITE_TTL_DAYS,
  hashInviteToken,
  inviteExpiry,
  inviteStatus,
  newInviteToken,
} from "./invites";

const DAY = 86_400_000;

describe("invite tokens", () => {
  it("mints distinct url-safe tokens", () => {
    const a = newInviteToken();
    const b = newInviteToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThan(32);
  });

  it("hashes deterministically and never returns the raw token", () => {
    const token = newInviteToken();
    expect(hashInviteToken(token)).toBe(hashInviteToken(token));
    expect(hashInviteToken(token)).not.toBe(token);
    expect(hashInviteToken(token)).not.toBe(hashInviteToken(newInviteToken()));
  });

  it("expires INVITE_TTL_DAYS out", () => {
    const now = new Date("2026-08-08T00:00:00.000Z");
    expect(inviteExpiry(now)).toBe(
      new Date(now.getTime() + INVITE_TTL_DAYS * DAY).toISOString(),
    );
  });
});

describe("inviteStatus", () => {
  const now = "2026-08-08T12:00:00.000Z";
  const future = "2026-09-01T00:00:00.000Z";
  const past = "2026-08-01T00:00:00.000Z";

  it("is pending while unused and unexpired", () => {
    expect(inviteStatus({ expiresAt: future }, now)).toBe("pending");
  });

  it("is expired once the deadline passes", () => {
    expect(inviteStatus({ expiresAt: past }, now)).toBe("expired");
    expect(inviteStatus({ expiresAt: now }, now)).toBe("expired");
  });

  it("ranks accepted over revoked over expired", () => {
    expect(
      inviteStatus({ expiresAt: past, revokedAt: past, acceptedAt: past }, now),
    ).toBe("accepted");
    expect(inviteStatus({ expiresAt: past, revokedAt: past }, now)).toBe("revoked");
  });

  it("treats a revoked-but-unexpired invite as revoked", () => {
    expect(inviteStatus({ expiresAt: future, revokedAt: now }, now)).toBe("revoked");
  });
});
