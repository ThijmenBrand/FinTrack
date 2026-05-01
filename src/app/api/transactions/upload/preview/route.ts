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
  splitNameAndDescription,
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

    // Reserved category IDs — when a rule maps a transaction into one of these,
    // the resulting type is 'reserved' rather than 'expense' / 'income'.
    const categoryKindRows = await db
      .select({ id: categories.id, kind: categories.kind })
      .from(categories)
      .where(eq(categories.userId, userId));
    const reservedCategoryIds = new Set(
      categoryKindRows.filter((c) => c.kind === "reserved").map((c) => c.id)
    );

    const allColumns = (parsed.meta.fields || []).filter((c) => c.length > 0);
    const transactions: PreviewTransaction[] = [];
    let skipped = 0;
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
      let type: "income" | "expense" | "internal_transfer" | "reserved" =
        amount >= 0 ? "income" : "expense";

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

      // Auto-categorize using rules (skip if already detected as transfer).
      // Match against the combined "name — description" so existing rules built
      // against the previously-concatenated label keep working after the split.
      const matchTarget = name ? `${name} — ${description}` : description;
      let categoryId: string | null = null;
      if (type === "internal_transfer" && transferCategory) {
        categoryId = transferCategory.id;
      } else {
        for (const rule of rules) {
          if (matchesRule(matchTarget, rule.pattern, rule.matchType)) {
            categoryId = rule.categoryId;
            break;
          }
        }
      }

      // If the matched rule points at a reserved category, type follows.
      if (categoryId && reservedCategoryIds.has(categoryId)) {
        type = "reserved";
      }

      transactions.push({
        tempId: crypto.randomUUID(),
        date,
        name,
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
      { error: "Failed to preview CSV" },
      { status: 500 }
    );
  }
}
