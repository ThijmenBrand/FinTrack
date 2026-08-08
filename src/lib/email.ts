// Transactional email via Resend's HTTP API. This file is the provider seam —
// swapping providers means rewriting only sendEmail().

import { INVITE_TTL_DAYS } from "@/lib/invites";

const RESEND_URL = "https://api.resend.com/emails";

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  // Legacy synthetic accounts (username@local.test) have no real mailbox.
  if (to.endsWith("@local") || to.endsWith("@local.test")) {
    console.log(`[email] skipped send to synthetic address ${to}`);
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // Dev fallback: surface the mail content so flows are testable locally.
    console.log(`[email] RESEND_API_KEY not set — would send to ${to}: ${subject}\n${html}`);
    return;
  }

  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || "FinTrack <onboarding@resend.dev>",
      to,
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[email] Resend responded ${res.status}: ${body}`);
    throw new Error("Failed to send email");
  }
}

/** Inviter display names are user-controlled and land inside the HTML body. */
function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );
}

function layout(heading: string, body: string, url: string, cta: string): string {
  return `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 12px">${heading}</h2>
  <p style="margin:0 0 20px;color:#444">${body}</p>
  <a href="${url}" style="display:inline-block;background:#1d6ec1;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none">${cta}</a>
  <p style="margin:20px 0 0;font-size:12px;color:#888">If the button doesn't work, copy this link:<br>${url}</p>
</div>`;
}

export function sendVerificationEmail(to: string, url: string): Promise<void> {
  return sendEmail(
    to,
    "Verify your FinTrack email",
    layout(
      "Verify your email",
      "Confirm your email address to finish setting up your FinTrack account. This link expires in 1 hour.",
      url,
      "Verify email",
    ),
  );
}

export function sendInviteEmail(
  to: string,
  url: string,
  inviterName: string,
): Promise<void> {
  return sendEmail(
    to,
    "You're invited to FinTrack",
    layout(
      "You're invited to FinTrack",
      `${escapeHtml(inviterName)} invited you to FinTrack. Pick a password to activate your account — this link expires in ${INVITE_TTL_DAYS} days.`,
      url,
      "Accept invite",
    ),
  );
}

export function sendPasswordResetEmail(to: string, url: string): Promise<void> {
  return sendEmail(
    to,
    "Reset your FinTrack password",
    layout(
      "Reset your password",
      "Someone requested a password reset for your FinTrack account. If this wasn't you, you can ignore this email.",
      url,
      "Reset password",
    ),
  );
}
