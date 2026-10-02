import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-errors";
import { withUser } from "@/lib/auth";
import { requireAccountAccess } from "@/lib/account-access";
import { bankHasSeparateFeeColumn } from "@/lib/banks";
import Papa from "papaparse";
import {
  parseAmount,
  parseDate,
  splitNameAndDescription,
  isUnsettledRow,
  applyFee,
  type ColumnMapping,
} from "@/lib/csv-utils";
import { classifyRows, dropExistingRows, type NormalizedRow } from "@/lib/import/classify";

interface CsvRow {
  [key: string]: string;
}

/**
 * POST /api/transactions/upload/preview
 * Parse CSV and apply categorization rules without writing to the database.
 * Returns a preview of transactions for user review.
 */
export async function POST(request: NextRequest) {
  return withUser(async (userId) => {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const accountId = formData.get("accountId") as string | null;
    const mappingJson = formData.get("mapping") as string | null;

    if (!file || !accountId || !mappingJson) {
      return apiError("api.uploadFieldsRequired", 400);
    }
    if (file.size > 10 * 1024 * 1024) {
      return apiError("api.fileTooLarge", 400);
    }

    // Write access to the target account — 404 if the caller can't see it,
    // 403 if they're a viewer. Rules, existing rows and recurring plans
    // (classifyRows) all read from the ACCOUNT OWNER's space, same as commit
    // will write to.
    const access = await requireAccountAccess(userId, accountId, "write");
    const ownedAccount = access.account;

    const mapping: ColumnMapping = JSON.parse(mappingJson);

    // Handle various encodings: UTF-16 LE/BE (common in Austrian/German bank exports)
    // and UTF-8 with BOM. file.text() assumes UTF-8, which garbles UTF-16 files.
    const rawBytes = new Uint8Array(await file.arrayBuffer());
    let csvText: string;
    if (rawBytes[0] === 0xFF && rawBytes[1] === 0xFE) {
      // UTF-16 LE BOM
      const decoder = new TextDecoder("utf-16le");
      csvText = decoder.decode(rawBytes);
    } else if (rawBytes[0] === 0xFE && rawBytes[1] === 0xFF) {
      // UTF-16 BE BOM
      const decoder = new TextDecoder("utf-16be");
      csvText = decoder.decode(rawBytes);
    } else {
      // UTF-8 (with or without BOM)
      csvText = new TextDecoder("utf-8").decode(rawBytes);
    }
    // Strip any remaining BOM character
    csvText = csvText.replace(/^\uFEFF/, "");

    const parsed = Papa.parse<CsvRow>(csvText, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      transformHeader: (header: string) => header.trim(),
    });

    // Only fail if no data was parsed; ignore non-fatal PapaParse warnings
    // (e.g. TooFewFields on trailing empty lines, FieldMismatch, etc.)
    if (parsed.data.length === 0) {
      return apiError("api.csvNoData", 400, undefined, { details: parsed.errors.slice(0, 5) });
    }

    const allColumns = (parsed.meta.fields || []).filter((c) => c.length > 0);
    const rows: NormalizedRow[] = [];
    let skipped = 0;
    let pending = 0;
    let feesApplied = 0;
    const feeColumn = bankHasSeparateFeeColumn(ownedAccount.bank)
      ? mapping.fee
      : undefined;
    for (let rowIndex = 0; rowIndex < parsed.data.length; rowIndex++) {
      const row = parsed.data[rowIndex];
      const dateRaw = row[mapping.date]?.trim();
      const nameRaw = mapping.name ? row[mapping.name]?.trim() : undefined;
      const descRaw = row[mapping.description]?.trim();
      const amountRaw = row[mapping.amount]?.trim();
      const balanceRaw = mapping.balance ? row[mapping.balance]?.trim() : undefined;

      const split = splitNameAndDescription(nameRaw, descRaw);
      const name: string | null = split.name;
      let description = split.description;

      // Fallback: scan other columns if both mapped fields were empty
      if (!description) {
        const fallbackKeys = ["omschrijving", "description", "memo", "naam", "name"];
        const skipCols = [mapping.description, mapping.name].filter(Boolean);
        for (const key of fallbackKeys) {
          const col = allColumns.find(
            (c) => c.toLowerCase().includes(key) && !skipCols.includes(c)
          );
          if (col && row[col]?.trim()) {
            description = row[col].trim();
            break;
          }
        }
      }

      if (!description) {
        description =
          Object.values(row)
            .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
            .join(" | ")
            .substring(0, 200) || "Unknown transaction";
      }

      if (!dateRaw || !amountRaw) {
        skipped++;
        continue;
      }

      let amount = parseAmount(amountRaw);
      if (isNaN(amount)) {
        skipped++;
        continue;
      }
      // Gated on the account's bank server-side, not just in the picker: only
      // Revolut bills fees as a separate column.
      if (feeColumn) {
        const withFee = applyFee(amount, row[feeColumn]);
        if (withFee !== amount) feesApplied++;
        amount = withFee;
      }

      const date = parseDate(dateRaw);
      if (!date) {
        skipped++;
        continue;
      }

      // Pending/reverted authorisations, not settled money — see isUnsettledRow.
      if (isUnsettledRow(Boolean(mapping.balance), balanceRaw)) {
        pending++;
        continue;
      }

      const balance = balanceRaw ? parseAmount(balanceRaw) : null;

      rows.push({
        date,
        name,
        description,
        amount,
        balance,
        counterpartyIban: mapping.counterpartyIban
          ? row[mapping.counterpartyIban]?.trim()
          : undefined,
      });
    }

    const classified = await classifyRows(ownedAccount, rows);

    // Drop rows already in this account so the user doesn't waste time
    // categorizing transactions that the commit would skip anyway.
    const { unique, duplicates } = await dropExistingRows(ownedAccount, classified);

    return NextResponse.json({
      transactions: unique,
      skipped,
      pending,
      feesApplied,
      duplicates: duplicates.length,
    });
  }, "Failed to preview CSV");
}
