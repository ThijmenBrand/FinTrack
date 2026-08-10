import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendInviteEmail, sendVerificationEmail, sendPasswordResetEmail } from "./email";

/** Capture the Resend payload instead of sending it. */
function stubResend() {
  let sent = "";
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    sent = String(init.body);
    return new Response("{}", { status: 200 });
  });
  vi.stubEnv("RESEND_API_KEY", "test-key");
  return () => JSON.parse(sent);
}

describe("sendInviteEmail", () => {
  let payload: () => { subject: string; html: string; text: string };

  beforeEach(() => {
    payload = stubResend();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("writes the invite in the inviter's language", async () => {
    await sendInviteEmail("new@example.com", "https://app/invite?token=t", "Ann", "nl");
    const { subject, html, text } = payload();

    expect(subject).toBe("Je bent uitgenodigd voor FinTrack");
    expect(html).toContain('<html lang="nl"');
    expect(html).toContain("Ann");
    expect(text).toContain("Uitnodiging accepteren");
  });

  it("falls back to English", async () => {
    await sendInviteEmail("new@example.com", "https://app/invite?token=t", "Ann");
    expect(payload().subject).toBe("You're invited to FinTrack");
  });

  it("localizes the verification email", async () => {
    await sendVerificationEmail("new@example.com", "https://app/verify?token=t", "nl");
    const { subject, html } = payload();
    expect(subject).toBe("Bevestig je e-mailadres voor FinTrack");
    expect(html).toContain('<html lang="nl"');
  });

  it("localizes the password reset email, defaulting to English", async () => {
    await sendPasswordResetEmail("new@example.com", "https://app/reset?token=t", "nl");
    expect(payload().subject).toBe("Stel je FinTrack-wachtwoord opnieuw in");

    await sendPasswordResetEmail("new@example.com", "https://app/reset?token=t");
    expect(payload().subject).toBe("Reset your FinTrack password");
  });
});
