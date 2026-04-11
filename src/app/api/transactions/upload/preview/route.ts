import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { categoryRules, accounts, categories } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getUserId } from "@/lib/auth";
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
    console.log("[CSV DEBUG] === Starting CSV preview ===");
    console.log("[CSV DEBUG] Mapping:", JSON.stringify(mapping));

    // Handle various encodings: UTF-16 LE/BE (common in Austrian/German bank exports)
    // and UTF-8 with BOM. file.text() assumes UTF-8, which garbles UTF-16 files.
    const rawBytes = new Uint8Array(await file.arrayBuffer());
    let csvText: string;
    if (rawBytes[0] === 0xFF && rawBytes[1] === 0xFE) {
      // UTF-16 LE BOM
      console.log("[CSV DEBUG] Detected UTF-16 LE encoding");
      const decoder = new TextDecoder("utf-16le");
      csvText = decoder.decode(rawBytes);
    } else if (rawBytes[0] === 0xFE && rawBytes[1] === 0xFF) {
      // UTF-16 BE BOM
      console.log("[CSV DEBUG] Detected UTF-16 BE encoding");
      const decoder = new TextDecoder("utf-16be");
      csvText = decoder.decode(rawBytes);
    } else {
      // UTF-8 (with or without BOM)
      csvText = new TextDecoder("utf-8").decode(rawBytes);
    }
    // Strip any remaining BOM character
    csvText = csvText.replace(/^\uFEFF/, "");

    console.log("[CSV DEBUG] CSV text length:", csvText.length);
    console.log("[CSV DEBUG] First 500 chars:", csvText.substring(0, 500));

    const parsed = Papa.parse<CsvRow>(csvText, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      transformHeader: (header: string) => header.trim(),
    });

    console.log("[CSV DEBUG] PapaParse results: rows=%d, errors=%d, fields=%s",
      parsed.data.length,
      parsed.errors.length,
      JSON.stringify(parsed.meta.fields),
    );
    if (parsed.errors.length > 0) {
      console.log("[CSV DEBUG] PapaParse errors:", JSON.stringify(parsed.errors.slice(0, 5)));
    }
    if (parsed.data.length > 0) {
      console.log("[CSV DEBUG] First row:", JSON.stringify(parsed.data[0]));
      console.log("[CSV DEBUG] Row keys:", Object.keys(parsed.data[0]));
    }

    // Only fail if no data was parsed; ignore non-fatal PapaParse warnings
    // (e.g. TooFewFields on trailing empty lines, FieldMismatch, etc.)
    if (parsed.data.length === 0) {
      return NextResponse.json(
        { error: "CSV parsing errors — no data found", details: parsed.errors.slice(0, 5) },
        { status: 400 }
      );
    }

    // Fetch active category rules for auto-categorization
    const rules = await db
      .select()
      .from(categoryRules)
      .where(and(eq(categoryRules.isActive, true), eq(categoryRules.userId, userId)));

    // Build IBAN → account lookup for internal transfer detection
    const allAccounts = await db.select().from(accounts).where(eq(accounts.userId, userId));
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
      .where(and(eq(categories.name, "Internal Transfer"), eq(categories.userId, userId)));

    const allColumns = (parsed.meta.fields || []).filter((c) => c.length > 0);
    const transactions: PreviewTransaction[] = [];
    let skipped = 0;
    const skipReasons: { row: number; reason: string; rawValues: Record<string, string | undefined> }[] = [];

    for (let rowIndex = 0; rowIndex < parsed.data.length; rowIndex++) {
      const row = parsed.data[rowIndex];
      const dateRaw = row[mapping.date]?.trim();
      let description = row[mapping.description]?.trim();
      const amountRaw = row[mapping.amount]?.trim();

      if (rowIndex < 5) {
        console.log(`[CSV DEBUG] Row ${rowIndex + 1}: date="${dateRaw}" (col "${mapping.date}"), amount="${amountRaw}" (col "${mapping.amount}"), desc="${description?.substring(0, 50)}" (col "${mapping.description}")`);
        console.log(`[CSV DEBUG] Row ${rowIndex + 1} raw:`, JSON.stringify(row));
      }
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

      const rawValues = {
        date: dateRaw,
        amount: amountRaw,
        description: description?.substring(0, 80),
        mappedDateCol: mapping.date,
        mappedAmountCol: mapping.amount,
      };

      if (!dateRaw || !amountRaw) {
        const reason = !dateRaw && !amountRaw ? "Missing date and amount" : !dateRaw ? "Missing date" : "Missing amount";
        if (skipped < 10) console.log(`[CSV DEBUG] SKIP row ${rowIndex + 1}: ${reason} | dateRaw="${dateRaw}" amountRaw="${amountRaw}"`);
        skipped++;
        skipReasons.push({ row: rowIndex + 1, reason, rawValues });
        continue;
      }

      const amount = parseAmount(amountRaw);
      if (isNaN(amount)) {
        if (skipped < 10) console.log(`[CSV DEBUG] SKIP row ${rowIndex + 1}: Amount parse failed: "${amountRaw}" → NaN`);
        skipped++;
        skipReasons.push({ row: rowIndex + 1, reason: `Amount parse failed: "${amountRaw}" → NaN`, rawValues });
        continue;
      }

      const date = parseDate(dateRaw);
      if (!date) {
        if (skipped < 10) console.log(`[CSV DEBUG] SKIP row ${rowIndex + 1}: Date parse failed: "${dateRaw}" → null`);
        skipped++;
        skipReasons.push({ row: rowIndex + 1, reason: `Date parse failed: "${dateRaw}" → null`, rawValues });
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

    console.log(`[CSV DEBUG] === Result: ${transactions.length} imported, ${skipped} skipped out of ${parsed.data.length} rows ===`);
    if (skipped > 0) {
      const reasonCounts: Record<string, number> = {};
      for (const sr of skipReasons) {
        const key = sr.reason.split(":")[0];
        reasonCounts[key] = (reasonCounts[key] || 0) + 1;
      }
      console.log("[CSV DEBUG] Skip reason summary:", JSON.stringify(reasonCounts));
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
