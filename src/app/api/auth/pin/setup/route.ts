import { NextRequest, NextResponse } from "next/server";
import { auth, hashPassword, verifyPassword } from "@/lib/auth";
import { db } from "@/db/index";
import { userPin, account, user } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { headers } from "next/headers";
import { validateCsrfOrigin } from "@/lib/csrf";
import { validatePin } from "@/lib/pin-utils";
import { logAuthEvent, getRequestMeta } from "@/lib/audit";

// POST: Set or update PIN (requires active session + current password)
export async function POST(req: NextRequest) {
  try {
    // CSRF origin validation
    const csrfError = validateCsrfOrigin(req);
    if (csrfError) return csrfError;

    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { pin, currentPassword } = body;

    if (!pin || !currentPassword) {
      return NextResponse.json(
        { error: "PIN and current password are required" },
        { status: 400 },
      );
    }

    // Validate PIN complexity
    const pinError = validatePin(pin);
    if (pinError) {
      return NextResponse.json({ error: pinError }, { status: 400 });
    }

    // Verify current password
    const userAccount = await db
      .select()
      .from(account)
      .where(
        and(
          eq(account.userId, session.user.id),
          eq(account.providerId, "credential"),
        ),
      )
      .get();

    if (!userAccount?.password) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const passwordValid = await verifyPassword(currentPassword, userAccount.password);
    if (!passwordValid) {
      return NextResponse.json({ error: "Invalid password" }, { status: 403 });
    }

    // Hash and store PIN
    const pinHash = await hashPassword(pin);
    const now = new Date().toISOString();

    const existing = await db
      .select()
      .from(userPin)
      .where(eq(userPin.userId, session.user.id))
      .get();

    const { ipAddress, userAgent } = getRequestMeta(req.headers);

    if (existing) {
      await db
        .update(userPin)
        .set({ pinHash, failedAttempts: 0, lockedUntil: null, updatedAt: now })
        .where(eq(userPin.userId, session.user.id));
    } else {
      await db.insert(userPin).values({
        userId: session.user.id,
        pinHash,
      });
    }

    logAuthEvent({
      userId: session.user.id,
      action: existing ? "pin_change" : "pin_setup",
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE: Remove PIN (requires active session + current password)
export async function DELETE(req: NextRequest) {
  try {
    // CSRF origin validation
    const csrfError = validateCsrfOrigin(req);
    if (csrfError) return csrfError;

    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { currentPassword } = body;

    if (!currentPassword) {
      return NextResponse.json(
        { error: "Current password is required" },
        { status: 400 },
      );
    }

    // Verify current password
    const userAccount = await db
      .select()
      .from(account)
      .where(
        and(
          eq(account.userId, session.user.id),
          eq(account.providerId, "credential"),
        ),
      )
      .get();

    if (!userAccount?.password) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const passwordValid = await verifyPassword(currentPassword, userAccount.password);
    if (!passwordValid) {
      return NextResponse.json({ error: "Invalid password" }, { status: 403 });
    }

    await db.delete(userPin).where(eq(userPin.userId, session.user.id));

    const { ipAddress, userAgent } = getRequestMeta(req.headers);
    logAuthEvent({
      userId: session.user.id,
      action: "pin_remove",
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
