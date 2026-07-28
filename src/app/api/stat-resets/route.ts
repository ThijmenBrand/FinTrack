import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { statResets } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { listStatResets } from "@/lib/stat-reset";
import { isIsoDate, MAX_NOTE_LENGTH } from "@/lib/validation";

/** GET /api/stat-resets — every reset point, newest first. */
export async function GET() {
  return withUser(async (userId) => {
    return NextResponse.json(await listStatResets(userId));
  }, "Failed to fetch reset points");
}

/** POST /api/stat-resets — add a reset point. Body: { date, note? } */
export async function POST(request: NextRequest) {
  return withUser(async (userId) => {
    const body = await request.json();
    if (!isIsoDate(body?.date)) {
      return NextResponse.json(
        { error: "A valid date is required" },
        { status: 400 },
      );
    }
    const rawNote = typeof body?.note === "string" ? body.note.trim() : "";
    if (rawNote.length > MAX_NOTE_LENGTH) {
      return NextResponse.json(
        { error: `Note must be ${MAX_NOTE_LENGTH} characters or fewer` },
        { status: 400 },
      );
    }
    // One reset per day — re-adding the same date edits the note instead of
    // stacking a duplicate marker on the charts.
    const [existing] = await db
      .select({ id: statResets.id })
      .from(statResets)
      .where(and(eq(statResets.userId, userId), eq(statResets.date, body.date)))
      .limit(1);
    if (existing) {
      await db
        .update(statResets)
        .set({ note: rawNote || null })
        .where(eq(statResets.id, existing.id));
    } else {
      await db.insert(statResets).values({
        id: crypto.randomUUID(),
        userId,
        date: body.date,
        note: rawNote || null,
      });
    }
    return NextResponse.json(await listStatResets(userId));
  }, "Failed to add reset point");
}

/** DELETE /api/stat-resets?id=… — remove a reset point. */
export async function DELETE(request: NextRequest) {
  return withUser(async (userId) => {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    await db
      .delete(statResets)
      .where(and(eq(statResets.id, id), eq(statResets.userId, userId)));
    return NextResponse.json(await listStatResets(userId));
  }, "Failed to remove reset point");
}
