import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
import { db } from "@/db";
import { instrumentPrices, instruments, trades } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { requireAccountAccess } from "@/lib/account-access";
import { isInvestmentAccount } from "@/lib/account-kinds";
import { checkInstrument, checkPrice, checkTrade } from "@/lib/holdings-input";
import {
  getAccountHoldings,
  recomputeAccountsHolding,
  recomputeAccountValuations,
} from "@/lib/holdings-db";
import { logDataEvent } from "@/lib/audit";
import { toIsoDate } from "@/lib/utils";
import type { MessageKey } from "@/lib/i18n/translate";

// GET /api/accounts/[id]/holdings — positions derived from the account's
// trades, each priced at the newest figure on or before today.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withUser(async (userId) => {
    const { id } = await params;
    const { account } = await requireAccountAccess(userId, id, "read");
    if (!isInvestmentAccount(account)) return apiError("api.notAnInvestmentAccount", 400);

    return NextResponse.json(await getAccountHoldings(db, account.userId, id));
  }, "Failed to fetch holdings");
}

/**
 * POST /api/accounts/[id]/holdings — record a trade.
 *
 * Takes either an existing `instrumentId` or an `instrument` object to create
 * one, because "buy something I have never held before" is the common case and
 * splitting it across two round trips would mean a half-finished instrument
 * left behind whenever the trade turns out to be invalid.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withUser(async (userId) => {
    const { id } = await params;
    const { account } = await requireAccountAccess(userId, id, "write");
    if (!isInvestmentAccount(account)) return apiError("api.notAnInvestmentAccount", 400);

    const ownerId = account.userId;
    const body = (await request.json()) as Record<string, unknown>;
    const today = toIsoDate(new Date());

    // The instrument first, so the trade can be checked against a real id.
    let instrumentId = typeof body.instrumentId === "string" ? body.instrumentId : "";
    if (!instrumentId) {
      const checked = checkInstrument(
        (body.instrument as Record<string, unknown>) ?? {},
      );
      if (!checked.ok) return apiError(checked.error as MessageKey, 400);
      const [created] = await db
        .insert(instruments)
        .values({ userId: ownerId, ...checked.value })
        .returning({ id: instruments.id });
      instrumentId = created.id;
    } else {
      const [owned] = await db
        .select({ id: instruments.id })
        .from(instruments)
        .where(
          and(eq(instruments.id, instrumentId), eq(instruments.userId, ownerId)),
        );
      if (!owned) return apiError("api.instrumentNotFound", 404);
    }

    const trade = checkTrade({ ...body, instrumentId }, today);
    if (!trade.ok) return apiError(trade.error as MessageKey, 400);

    await db.insert(trades).values({
      userId: ownerId,
      accountId: id,
      ...trade.value,
      notes: typeof body.notes === "string" ? body.notes.slice(0, 500) : null,
    });

    // The account's value is now quantity x price, so its valuation history is
    // rebuilt from the holdings rather than left to whatever was last typed.
    await recomputeAccountValuations(db, ownerId, id);

    logDataEvent({
      userId,
      action: "account_update",
      targetId: id,
      targetType: "account",
      details: { trade: trade.value.type, date: trade.value.date },
    });

    return NextResponse.json(await getAccountHoldings(db, ownerId, id), {
      status: 201,
    });
  }, "Failed to record trade");
}

/**
 * PUT /api/accounts/[id]/holdings — record what one unit of an instrument was
 * worth on a date. Prices live on the instrument rather than the account: the
 * same fund held in two accounts is worth the same in both.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withUser(async (userId) => {
    const { id } = await params;
    const { account } = await requireAccountAccess(userId, id, "write");
    if (!isInvestmentAccount(account)) return apiError("api.notAnInvestmentAccount", 400);

    const ownerId = account.userId;
    const body = (await request.json()) as Record<string, unknown>;
    const today = toIsoDate(new Date());

    if (typeof body.instrumentId !== "string") {
      return apiError("api.instrumentRequired", 400);
    }
    const [owned] = await db
      .select({ id: instruments.id })
      .from(instruments)
      .where(
        and(eq(instruments.id, body.instrumentId), eq(instruments.userId, ownerId)),
      );
    if (!owned) return apiError("api.instrumentNotFound", 404);

    const checked = checkPrice(body, today);
    if (!checked.ok) return apiError(checked.error as MessageKey, 400);

    const now = new Date().toISOString();
    await db
      .insert(instrumentPrices)
      .values({
        userId: ownerId,
        instrumentId: body.instrumentId,
        date: checked.value.date,
        price: checked.value.price,
        source: "manual",
        createdAt: now,
      })
      // A second price for the same day is a correction, like a valuation.
      .onConflictDoUpdate({
        target: [instrumentPrices.instrumentId, instrumentPrices.date],
        set: { price: checked.value.price, source: "manual", createdAt: now },
      });

    // Not just this account: anywhere the owner holds this instrument.
    await recomputeAccountsHolding(db, ownerId, body.instrumentId);

    return NextResponse.json(await getAccountHoldings(db, ownerId, id));
  }, "Failed to record price");
}
