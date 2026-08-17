import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, importBatches, categoryRules } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import { requireAccountAccess } from "@/lib/account-access";
import Papa from "papaparse";

// Backstop against unbounded uploads — a real bank CSV is far smaller.
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 5000;
import {
  parseAmount,
  parseDate,
  matchesRule,
  ruleMatchTarget,
  splitNameAndDescription,
  type ColumnMapping,
} from "@/lib/csv-utils";

interface CsvRow {
  [key: string]: string;
}

// POST /api/transactions/upload — parse and import CSV data
export async function POST(request: NextRequest) {
  return withUser(async (userId) => {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const accountId = formData.get("accountId") as string | null;
    const mappingJson = formData.get("mapping") as string | null;

    if (!file || !accountId || !mappingJson) {
      return NextResponse.json(
        { error: "File, accountId, and column mapping are required" },
        { status: 400 }
      );
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "File too large (max 10 MB)" }, { status: 400 });
    }

    const access = await requireAccountAccess(userId, accountId, "write");
    const ownerId = access.account.userId;

    const mapping: ColumnMapping = JSON.parse(mappingJson);
    // Strip UTF-8 BOM that bank exports often include
    const csvText = (await file.text()).replace(/^\uFEFF/, "");

    // Parse CSV
    const parsed = Papa.parse<CsvRow>(csvText, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      transformHeader: (header: string) => header.trim(),
    });

    if (parsed.data.length > MAX_ROWS) {
      return NextResponse.json(
        { error: `Too many rows (max ${MAX_ROWS} per import)` },
        { status: 400 }
      );
    }

    // Only fail if no data was parsed; ignore non-fatal PapaParse warnings
    if (parsed.data.length === 0) {
      return NextResponse.json(
        {
          error: "CSV parsing errors — no data found",
          details: parsed.errors.slice(0, 5),
        },
        { status: 400 }
      );
    }

    // Fetch active category rules for auto-categorization
    const rules = await db
      .select()
      .from(categoryRules)
      .where(and(eq(categoryRules.isActive, true), eq(categoryRules.userId, ownerId)));

    // Create import batch
    const batchId = crypto.randomUUID();
    await db.insert(importBatches).values({
      id: batchId,
      userId: ownerId,
      accountId,
      fileName: file.name,
      transactionCount: parsed.data.length,
      importedAt: new Date().toISOString(),
    });

    // Process each row
    const importedTransactions = [];
    let skipped = 0;

    // Collect all column names for fallback description lookup
    const allColumns = parsed.meta.fields || [];

    for (const row of parsed.data) {
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

      // Last resort: concatenate all non-empty text fields for a description
      if (!description) {
        description = Object.values(row)
          .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
          .join(" | ")
          .substring(0, 200) || "Unknown transaction";
      }

      if (!dateRaw || !amountRaw) {
        skipped++;
        continue;
      }

      const amount = parseAmount(amountRaw);
      if (isNaN(amount)) {
        skipped++;
        continue;
      }

      const date = parseDate(dateRaw);
      if (!date) {
        skipped++;
        continue;
      }

      const balance = balanceRaw ? parseAmount(balanceRaw) : null;
      const type: "income" | "expense" = amount >= 0 ? "income" : "expense";

      // Auto-categorize using rules, each against the text its matchField names.
      let categoryId: string | null = null;
      for (const rule of rules) {
        const matchTarget = ruleMatchTarget(name, description, rule.matchField);
        const matches = matchesRule(matchTarget, rule.pattern, rule.matchType);
        if (matches) {
          categoryId = rule.categoryId;
          break;
        }
      }

      const txId = crypto.randomUUID();
      importedTransactions.push({
        id: txId,
        userId: ownerId,
        accountId,
        date,
        name,
        description,
        amount,
        balance: isNaN(balance as number) ? null : balance,
        categoryId,
        categorySource: categoryId ? ("rule" as const) : null,
        type,
        linkedTransactionId: null,
        notes: null,
        createdBy: userId,
        isManual: false,
        importBatchId: batchId,
        createdAt: new Date().toISOString(),
      });
    }

    // Batch insert transactions (SQLite has a limit, so chunk them)
    const chunkSize = 50;
    for (let i = 0; i < importedTransactions.length; i += chunkSize) {
      const chunk = importedTransactions.slice(i, i + chunkSize);
      await db.insert(transactions).values(chunk);
    }

    return NextResponse.json({
      success: true,
      imported: importedTransactions.length,
      skipped,
      batchId,
    });
  }, "Failed to process CSV upload");
}
