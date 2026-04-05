import { NextRequest, NextResponse } from "next/server";
import { auth, hashPassword, verifyPassword } from "@/lib/auth";
import { db } from "@/db/index";
import { userPin, account, user } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { headers } from "next/headers";
import { validateCsrfOrigin } from "@/lib/csrf";

const TRIVIAL_PINS = [
  "0000", "1111", "2222", "3333", "4444", "5555", "6666", "7777", "8888", "9999",
  "00000", "11111", "22222", "33333", "44444", "55555", "66666", "77777", "88888", "99999",
  "000000", "111111", "222222", "333333", "444444", "555555", "666666", "777777", "888888", "999999",
  "1234", "12345", "123456", "4321", "54321", "654321",
  "0123", "01234", "012345",
  "9876", "98765", "987654",
];

function isSequential(pin: string): boolean {
  const digits = pin.split("").map(Number);
  let ascending = true;
  let descending = true;
  for (let i = 1; i < digits.length; i++) {
    if (digits[i] !== digits[i - 1] + 1) ascending = false;
    if (digits[i] !== digits[i - 1] - 1) descending = false;
  }
  return ascending || descending;
}

function validatePin(pin: string): string | null {
  if (!/^\d{4,6}$/.test(pin)) {
    return "PIN must be 4-6 digits";
  }
  if (TRIVIAL_PINS.includes(pin) || isSequential(pin)) {
    return "PIN is too simple. Avoid sequential or repeating digits.";
  }
  return null;
}

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

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
