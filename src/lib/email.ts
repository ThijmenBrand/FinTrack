// Transactional email via Resend's HTTP API. This file is the provider seam —
// swapping providers means rewriting only sendEmail().

import { INVITE_TTL_DAYS } from "@/lib/invites";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n";
import { getI18nFor } from "@/lib/i18n/translate";

const RESEND_URL = "https://api.resend.com/emails";

async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text: string,
): Promise<void> {
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
      text,
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

type Mail = {
  /** Inbox preview snippet — shown next to the subject, never in the body. */
  preheader: string;
  heading: string;
  body: string;
  url: string;
  cta: string;
  /** Small print under the card. */
  note: string;
};

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/**
 * Table-based so Outlook behaves; every style inlined so Gmail keeps it.
 * ponytail: hand-rolled HTML — swap for react-email if these grow past three.
 */
function layout(m: Mail, locale: Locale): { html: string; text: string } {
  const url = escapeHtml(m.url);
  const { t } = getI18nFor(locale);

  const html = `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${m.heading}</title>
</head>
<body style="margin:0;padding:0;background:#eef1f7">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${m.preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef1f7">
  <tr>
    <td align="center" style="padding:32px 16px">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,41,0.08)">

        <tr>
          <td align="center" bgcolor="#070d1f" style="background-color:#070d1f;background-image:linear-gradient(135deg,#132347 0%,#070d1f 55%,#1a1140 100%);padding:32px 24px 28px">
            <p style="margin:0;font-family:${FONT};font-size:20px;font-weight:600;letter-spacing:-0.01em;color:#ffffff">FinTrack</p>
            <p style="margin:6px 0 0;font-family:${FONT};font-size:13px;color:rgba(255,255,255,0.55)">${t("email.tagline")}</p>
          </td>
        </tr>
        <tr><td height="3" style="height:3px;line-height:3px;font-size:0;background:#2f6bed;background-image:linear-gradient(90deg,#38bdf8,#2f6bed,#935cff)">&nbsp;</td></tr>

        <tr>
          <td style="padding:36px 40px 8px">
            <h1 style="margin:0 0 12px;font-family:${FONT};font-size:24px;line-height:32px;font-weight:600;letter-spacing:-0.02em;color:#0f1729">${m.heading}</h1>
            <p style="margin:0;font-family:${FONT};font-size:15px;line-height:24px;color:#475069">${m.body}</p>
          </td>
        </tr>

        <tr>
          <td style="padding:28px 40px 4px">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td bgcolor="#2f6bed" style="border-radius:10px">
                  <a href="${url}" style="display:inline-block;padding:13px 28px;font-family:${FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px">${m.cta}</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 40px 36px">
            <p style="margin:0 0 6px;font-family:${FONT};font-size:12px;color:#8a93a8">${t("email.linkFallback")}</p>
            <p style="margin:0;font-family:${FONT};font-size:12px;line-height:18px;word-break:break-all">
              <a href="${url}" style="color:#2f6bed;text-decoration:none">${url}</a>
            </p>
          </td>
        </tr>
      </table>

      <p style="margin:20px 0 0;font-family:${FONT};font-size:12px;line-height:18px;color:#8a93a8;max-width:560px">${m.note}</p>
    </td>
  </tr>
</table>
</body>
</html>`;

  const text = `${m.heading}\n\n${stripTags(m.body)}\n\n${m.cta}: ${m.url}\n\n${stripTags(m.note)}`;

  return { html, text };
}

// Undo escapeHtml for the text/plain part; &amp; last so &amp;lt; decodes once.
function stripTags(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

function send(
  to: string,
  subject: string,
  mail: Mail,
  locale: Locale = DEFAULT_LOCALE,
): Promise<void> {
  const { html, text } = layout(mail, locale);
  return sendEmail(to, subject, html, text);
}

export function sendVerificationEmail(
  to: string,
  url: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<void> {
  const { t } = getI18nFor(locale);
  return send(
    to,
    t("email.verifySubject"),
    {
      preheader: t("email.verifyPreheader"),
      heading: t("email.verifyHeading"),
      body: t("email.verifyBody"),
      url,
      cta: t("email.verifyCta"),
      note: t("email.verifyNote"),
    },
    locale,
  );
}

/** Sent in the inviter's language — it is their invitation, not ours. */
export function sendInviteEmail(
  to: string,
  url: string,
  inviterName: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<void> {
  const { t } = getI18nFor(locale);
  const name = escapeHtml(inviterName);

  return send(
    to,
    t("email.inviteSubject"),
    {
      preheader: t("email.invitePreheader", { inviter: name }),
      heading: t("email.inviteHeading"),
      body: t("email.inviteBody", {
        inviter: `<strong style="color:#0f1729">${name}</strong>`,
      }),
      url,
      cta: t("email.inviteCta"),
      note: t("email.inviteNote", { days: INVITE_TTL_DAYS }),
    },
    locale,
  );
}

/** Account sharing: both mails follow the OWNER's language — it's their account. */
export function sendShareInviteEmail(
  to: string,
  url: string,
  ownerName: string,
  accountName: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<void> {
  const { t } = getI18nFor(locale);
  const owner = escapeHtml(ownerName);
  const account = escapeHtml(accountName);

  return send(
    to,
    t("email.shareInviteSubject", { owner: ownerName }),
    {
      preheader: t("email.shareInvitePreheader", { owner, account }),
      heading: t("email.shareInviteHeading"),
      body: t("email.shareInviteBody", {
        owner: `<strong style="color:#0f1729">${owner}</strong>`,
        account: `<strong style="color:#0f1729">${account}</strong>`,
      }),
      url,
      cta: t("email.shareInviteCta"),
      note: t("email.shareInviteNote", { days: INVITE_TTL_DAYS }),
    },
    locale,
  );
}

export function sendShareAcceptedEmail(
  to: string,
  url: string,
  memberName: string,
  accountName: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<void> {
  const { t } = getI18nFor(locale);
  const member = escapeHtml(memberName);
  const account = escapeHtml(accountName);

  return send(
    to,
    t("email.shareAcceptedSubject", { member: memberName }),
    {
      preheader: t("email.shareAcceptedPreheader", { member, account }),
      heading: t("email.shareAcceptedHeading"),
      body: t("email.shareAcceptedBody", {
        member: `<strong style="color:#0f1729">${member}</strong>`,
        account: `<strong style="color:#0f1729">${account}</strong>`,
      }),
      url,
      cta: t("email.shareAcceptedCta"),
      note: t("email.shareAcceptedNote"),
    },
    locale,
  );
}

export function sendPasswordResetEmail(
  to: string,
  url: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<void> {
  const { t } = getI18nFor(locale);
  return send(
    to,
    t("email.resetSubject"),
    {
      preheader: t("email.resetPreheader"),
      heading: t("email.resetHeading"),
      body: t("email.resetBody"),
      url,
      cta: t("email.resetCta"),
      note: t("email.resetNote"),
    },
    locale,
  );
}
