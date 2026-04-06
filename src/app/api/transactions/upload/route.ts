import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, importBatches, categoryRules, categories } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getUserId } from "@/lib/auth";
import Papa from "papaparse";
import {
  parseAmount,
  parseDate,
  matchesRule,
  type ColumnMapping,
} from "@/lib/csv-utils";

interface CsvRow {
  [key: string]: string;
}

// POST /api/transactions/upload — parse and import CSV data
export async function POST(request: NextRequest) {
  try {
    const userId = await getUserId();
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

    const mapping: ColumnMapping = JSON.parse(mappingJson);
    const csvText = await file.text();

    // Parse CSV
    const parsed = Papa.parse<CsvRow>(csvText, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      transformHeader: (header: string) => header.trim(),
    });

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
      let description = row[mapping.description]?.trim();
      const amountRaw = row[mapping.amount]?.trim();
      const balanceRaw = mapping.balance ? row[mapping.balance]?.trim() : undefined;

      // If mapped description is empty, try fallback columns
      if (!description) {
        const fallbackKeys = ["omschrijving", "description", "memo", "naam", "name"];
        for (const key of fallbackKeys) {
          const col = allColumns.find(
            (c) => c.toLowerCase().includes(key) && c !== mapping.description
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
      const type = amount >= 0 ? "income" : "expense";

      // Auto-categorize using rules
      let categoryId: string | null = null;
      for (const rule of rules) {
        const matches = matchesRule(description, rule.pattern, rule.matchType);
        if (matches) {
          categoryId = rule.categoryId;
          break;
        }
      }

      const txId = crypto.randomUUID();
      importedTransactions.push({
        id: txId,
        userId,
        accountId,
        date,
        description,
        amount,
        balance: isNaN(balance as number) ? null : balance,
        categoryId,
        type: type as "income" | "expense" | "internal_transfer",
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
  } catch (error) {
    console.error("CSV upload failed:", error);
    return NextResponse.json(
      { error: "Failed to process CSV upload: " + String(error) },
      { status: 500 }
    );
  }
}
