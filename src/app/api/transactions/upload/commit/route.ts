import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
import { withUser } from "@/lib/auth";
import { requireAccountAccess } from "@/lib/account-access";
import { logDataEvent } from "@/lib/audit";
import { commitImport, type CommitTransaction, type NewRule } from "@/lib/import/commit";

// Backstop against unbounded request bodies — a real bank CSV is far smaller.
const MAX_IMPORT_ROWS = 5000;

interface CommitRequest {
  accountId: string;
  fileName: string;
  transactions: CommitTransaction[];
  newRules: NewRule[];
}

/**
 * POST /api/transactions/upload/commit
 * Insert reviewed transactions into the database and create any new rules.
 */
export async function POST(request: NextRequest) {
  return withUser(async (userId) => {
    const body: CommitRequest = await request.json();
    const { accountId, fileName, transactions: txList, newRules } = body;

    if (!accountId || !txList || txList.length === 0) {
      return NextResponse.json(
        { error: "accountId and transactions are required" },
        { status: 400 }
      );
    }
    if (txList.length > MAX_IMPORT_ROWS) {
      return apiError("api.tooManyTransactions", 400, { max: MAX_IMPORT_ROWS });
    }

    // Write access to the target account — 404 if the caller can't see it,
    // 403 if they're a viewer. Every id the client references must belong to
    // the ACCOUNT OWNER's space, not necessarily the caller's own — imported
    // rows land there regardless of who's importing.
    const access = await requireAccountAccess(userId, accountId, "write");
    const ownerId = access.account.userId;
    // A client-supplied external id would let a CSV row squat on the id a
    // later bank sync delivers; only the sync sets one.
    for (const tx of txList) delete tx.externalId;

    const result = await commitImport({
      actorId: userId,
      account: access.account,
      batchLabel: fileName || "import.csv",
      source: "csv",
      transactions: txList,
      newRules: newRules || [],
    });
    if (!result.ok) return apiError(result.error, 400, result.vars);

    logDataEvent({
      userId,
      action: "csv_import",
      targetId: result.batchId,
      targetType: "import_batch",
      details: {
        fileName: fileName || "import.csv",
        transactionCount: result.imported,
        accountId,
        ...(ownerId !== userId ? { accountOwnerId: ownerId } : {}),
      },
    });

    return NextResponse.json({
      success: true,
      imported: result.imported,
      duplicatesSkipped: result.duplicatesSkipped,
      mirrorsAbsorbed: result.mirrorsAbsorbed,
      mirrorTransactions: result.mirrorTransactions,
      batchId: result.batchId,
      rulesCreated: result.rulesCreated,
      existingUpdated: result.existingUpdated,
      transfersDetected: result.transfersDetected,
    });
  }, "Failed to commit import");
}
