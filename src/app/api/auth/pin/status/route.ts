import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db/index";
import { userPin } from "@/db/schema";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";

// GET: Check if the authenticated user has a PIN set
export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pinRecord = await db
    .select({ id: userPin.id })
    .from(userPin)
    .where(eq(userPin.userId, session.user.id))
    .get();

  return NextResponse.json({ hasPin: !!pinRecord });
}
