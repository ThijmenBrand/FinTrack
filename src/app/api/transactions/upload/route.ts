import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, importBatches, categoryRules, categories } from "@/db/schema";
import { eq } from "drizzle-orm";
import Papa from "papaparse";

interface CsvRow {
  [key: string]: string;
}

interface ColumnMapping {
  date: string;
  description: string;
  amount: string;
  balance?: string;
}

// POST /api/transactions/upload — parse and import CSV data
export async function POST(request: NextRequest) {
  try {
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

    if (parsed.errors.length > 0) {
      return NextResponse.json(
        {
          error: "CSV parsing errors",
          details: parsed.errors.slice(0, 5),
        },
        { status: 400 }
      );
    }

    // Fetch active category rules for auto-categorization
    const rules = await db
      .select()
      .from(categoryRules)
      .where(eq(categoryRules.isActive, true));

    // Get "Internal Transfer" category id
    const [transferCategory] = await db
      .select()
      .from(categories)
      .where(eq(categories.name, "Internal Transfer"));

    // Create import batch
    const batchId = crypto.randomUUID();
    await db.insert(importBatches).values({
      id: batchId,
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
      // (e.g., Dutch bank CSVs have "Naam" and "Omschrijving" — either may be empty)
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

      // Parse amount — handle European format (comma as decimal separator)
      const amount = parseAmount(amountRaw);
      if (isNaN(amount)) {
        skipped++;
        continue;
      }

      // Parse date — try common formats
      const date = parseDate(dateRaw);
      if (!date) {
        skipped++;
        continue;
      }

      // Parse balance if provided
      const balance = balanceRaw ? parseAmount(balanceRaw) : null;

      // Determine transaction type
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

/**
 * Parse amount string, handling various formats:
 * - "1,234.56" (US)
 * - "1.234,56" (EU)
 * - "-$1,234.56" (with currency symbol)
 * - "1234.56" (plain)
 */
function parseAmount(raw: string): number {
  // Remove currency symbols and whitespace
  let cleaned = raw.replace(/[€$£¥\s]/g, "");

  // Detect format: if last separator is comma and has 1-2 digits after, it's EU
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");

  if (lastComma > lastDot) {
    // European format: 1.234,56 → remove dots, replace comma with dot
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    // US format or plain: remove commas
    cleaned = cleaned.replace(/,/g, "");
  }

  return parseFloat(cleaned);
}

/**
 * Parse date string into ISO format (YYYY-MM-DD).
 * Handles: DD/MM/YYYY, DD-MM-YYYY, MM/DD/YYYY, YYYY-MM-DD, DD.MM.YYYY
 */
function parseDate(raw: string): string | null {
  // Already ISO format
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return raw.substring(0, 10);
  }

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const euMatch = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (euMatch) {
    const [, day, month, year] = euMatch;
    const d = day.padStart(2, "0");
    const m = month.padStart(2, "0");
    return `${year}-${m}-${d}`;
  }

  // Try native Date parsing as fallback
  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().substring(0, 10);
  }

  return null;
}

/**
 * Check if a description matches a categorization rule.
 */
function matchesRule(
  description: string,
  pattern: string,
  matchType: string
): boolean {
  const desc = description.toLowerCase();
  const pat = pattern.toLowerCase();

  switch (matchType) {
    case "exact":
      return desc === pat;
    case "starts_with":
      return desc.startsWith(pat);
    case "contains":
    default:
      return desc.includes(pat);
  }
}
