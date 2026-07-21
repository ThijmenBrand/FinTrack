import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, importBatches, categoryRules, categories, accounts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { withUser } from "@/lib/auth";
import Papa from "papaparse";

// Backstop against unbounded uploads — a real bank CSV is far smaller.
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 5000;
import {
  parseAmount,
  parseDate,
  matchesRule,
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

    const [ownedAccount] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
      .limit(1);
    if (!ownedAccount) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

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
      .where(and(eq(categoryRules.isActive, true), eq(categoryRules.userId, userId)));

    // Get "Internal Transfer" category id
    const [transferCategory] = await db
      .select()
      .from(categories)
      .where(and(eq(categories.name, "Internal Transfer"), eq(categories.userId, userId)));

    // Map of categoryId → kind so we can derive type='reserved' when a rule
    // points at a kind='reserved' category.
    const categoryKindRows = await db
      .select({ id: categories.id, kind: categories.kind })
      .from(categories)
      .where(eq(categories.userId, userId));
    const reservedCategoryIds = new Set(
      categoryKindRows.filter((c) => c.kind === "reserved").map((c) => c.id)
    );

    // Create import batch
    const batchId = crypto.randomUUID();
    await db.insert(importBatches).values({
      id: batchId,
      userId,
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
      let type: "income" | "expense" | "reserved" = amount >= 0 ? "income" : "expense";

      // Auto-categorize using rules. Match against combined "name — description"
      // so legacy rules continue to match after the split.
      const matchTarget = name ? `${name} — ${description}` : description;
      let categoryId: string | null = null;
      for (const rule of rules) {
        const matches = matchesRule(matchTarget, rule.pattern, rule.matchType);
        if (matches) {
          categoryId = rule.categoryId;
          break;
        }
      }

      // If the matched rule points at a reserved category, type follows.
      if (categoryId && reservedCategoryIds.has(categoryId)) {
        type = "reserved";
      }

      const txId = crypto.randomUUID();
      importedTransactions.push({
        id: txId,
        userId,
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
