import { NextResponse } from "next/server";
import { withSession } from "@/lib/auth";
import { apiError } from "@/lib/api-errors";
import { createPasskeyChallenge } from "@/lib/passkey-assertion";

/** POST /api/unlock/passkey/options — the WebAuthn challenge for unlocking. */
export async function POST() {
  return withSession(async (ids) => {
    const options = await createPasskeyChallenge(ids);
    if (!options) return apiError("api.stepUpNoPasskey", 400);
    return NextResponse.json(options);
  }, "Failed to create unlock challenge");
}
