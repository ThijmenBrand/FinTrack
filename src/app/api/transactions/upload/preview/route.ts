import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { categoryRules, accounts, categories } from "@/db/schema";
import { eq } from "drizzle-orm";
import Papa from "papaparse";
import {
  parseAmount,
  parseDate,
  matchesRule,
  extractPattern,
  type ColumnMapping,
  type PreviewTransaction,
} from "@/lib/csv-utils";

interface CsvRow {
  [key: string]: string;
}

/**
 * POST /api/transactions/upload/preview
 * Parse CSV and apply categorization rules without writing to the database.
 * Returns a preview of transactions for user review.
 */
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

    const parsed = Papa.parse<CsvRow>(csvText, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      transformHeader: (header: string) => header.trim(),
    });

    if (parsed.errors.length > 0) {
      return NextResponse.json(
        { error: "CSV parsing errors", details: parsed.errors.slice(0, 5) },
        { status: 400 }
      );
    }

    // Fetch active category rules for auto-categorization
    const rules = await db
      .select()
      .from(categoryRules)
      .where(eq(categoryRules.isActive, true));

    // Build IBAN → account lookup for internal transfer detection
    const allAccounts = await db.select().from(accounts);
    const ibanToAccount = new Map<string, { id: string; name: string }>();
    for (const acc of allAccounts) {
      if (acc.iban) {
        ibanToAccount.set(acc.iban.replace(/\s/g, "").toUpperCase(), { id: acc.id, name: acc.name });
      }
    }

    // Get the "Internal Transfer" category
    const [transferCategory] = await db
      .select()
      .from(categories)
      .where(eq(categories.name, "Internal Transfer"));

    const allColumns = parsed.meta.fields || [];
    const transactions: PreviewTransaction[] = [];
    let skipped = 0;

    for (const row of parsed.data) {
      const dateRaw = row[mapping.date]?.trim();
      let description = row[mapping.description]?.trim();
      const amountRaw = row[mapping.amount]?.trim();
      const balanceRaw = mapping.balance ? row[mapping.balance]?.trim() : undefined;

      // Description fallback logic
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
      let type: "income" | "expense" | "internal_transfer" = amount >= 0 ? "income" : "expense";

      // Check for internal transfer via counterparty IBAN
      let targetAccountId: string | undefined;
      let targetAccountName: string | undefined;
      let counterpartyIban: string | undefined;
      if (mapping.counterpartyIban) {
        const rawIban = row[mapping.counterpartyIban]?.trim();
        if (rawIban) {
          counterpartyIban = rawIban;
          const normalizedIban = rawIban.replace(/\s/g, "").toUpperCase();
          const matchedAccount = ibanToAccount.get(normalizedIban);
          if (matchedAccount && matchedAccount.id !== accountId) {
            type = "internal_transfer";
            targetAccountId = matchedAccount.id;
            targetAccountName = matchedAccount.name;
          }
        }
      }

      // Auto-categorize using rules (skip if already detected as transfer)
      let categoryId: string | null = null;
      if (type === "internal_transfer" && transferCategory) {
        categoryId = transferCategory.id;
      } else {
        for (const rule of rules) {
          if (matchesRule(description, rule.pattern, rule.matchType)) {
            categoryId = rule.categoryId;
            break;
          }
        }
      }

      transactions.push({
        tempId: crypto.randomUUID(),
        date,
        description,
        amount,
        balance: balance !== null && isNaN(balance) ? null : balance,
        type,
        categoryId,
        suggestedPattern: extractPattern(description),
        counterpartyIban,
        targetAccountId,
        targetAccountName,
      });
    }

    return NextResponse.json({
      transactions,
      skipped,
    });
  } catch (error) {
    console.error("CSV preview failed:", error);
    return NextResponse.json(
      { error: "Failed to preview CSV: " + String(error) },
      { status: 500 }
    );
  }
}
