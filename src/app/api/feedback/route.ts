import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
import { withUser } from "@/lib/auth";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { sendFeedbackEmail } from "@/lib/email";
import { validateFeedback } from "@/lib/validation";
import { createRateLimiter } from "@/lib/rate-limit";

// Sending mail on a user's say-so is abusable; cap it at 5 per hour per user.
const allow = createRateLimiter(60 * 60 * 1000, 5);

export async function POST(req: NextRequest) {
  return withUser(async (userId) => {
    const inbox = process.env.FEEDBACK_EMAIL;
    if (!inbox) {
      console.error("[feedback] FEEDBACK_EMAIL not set — dropping submission");
      return apiError("api.feedbackNotConfigured", 503);
    }

    const body = await req.json().catch(() => ({}));
    const check = validateFeedback(body.message);
    if (!check.ok) {
      return apiError(check.error, 400, check.vars);
    }

    if (!allow(userId)) {
      return apiError("api.rateLimitedMessages", 429);
    }

    const result = await db.run(
      sql`SELECT name, email FROM "user" WHERE id = ${userId}`,
    );
    const user = result.rows[0] as { name?: string; email?: string } | undefined;

    await sendFeedbackEmail(
      inbox,
      check.value,
      user?.name || "Someone",
      user?.email || "",
      typeof body.page === "string" ? body.page.slice(0, 200) : "",
    );

    return NextResponse.json({ success: true });
  }, "Failed to send feedback");
}
