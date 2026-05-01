import { db } from "@/db";
import { userPreferences, type UserPreferences } from "@/db/schema";
import { eq } from "drizzle-orm";

export interface AutoBudgetPreferences {
  autoBudgetEnabled: boolean;
  autoBudgetIntervalMonths: number;
  autoBudgetLookbackMonths: number;
  lastAutoBudgetCheckAt: string | null;
  financialMonthStartDay: number;
}

const DEFAULTS: AutoBudgetPreferences = {
  autoBudgetEnabled: true,
  autoBudgetIntervalMonths: 1,
  autoBudgetLookbackMonths: 3,
  lastAutoBudgetCheckAt: null,
  financialMonthStartDay: 1,
};

function toAutoBudget(row: UserPreferences): AutoBudgetPreferences {
  return {
    autoBudgetEnabled: row.autoBudgetEnabled,
    autoBudgetIntervalMonths: row.autoBudgetIntervalMonths,
    autoBudgetLookbackMonths: row.autoBudgetLookbackMonths,
    lastAutoBudgetCheckAt: row.lastAutoBudgetCheckAt,
    financialMonthStartDay: row.financialMonthStartDay,
  };
}

export async function getUserPreferences(userId: string): Promise<AutoBudgetPreferences> {
  const rows = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  if (rows.length === 0) return { ...DEFAULTS };
  return toAutoBudget(rows[0]);
}

async function ensureRow(userId: string): Promise<void> {
  const existing = await db
    .select({ id: userPreferences.id })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  if (existing.length > 0) return;
  const now = new Date().toISOString();
  await db.insert(userPreferences).values({
    id: crypto.randomUUID(),
    userId,
    autoBudgetEnabled: DEFAULTS.autoBudgetEnabled,
    autoBudgetIntervalMonths: DEFAULTS.autoBudgetIntervalMonths,
    autoBudgetLookbackMonths: DEFAULTS.autoBudgetLookbackMonths,
    lastAutoBudgetCheckAt: null,
    financialMonthStartDay: DEFAULTS.financialMonthStartDay,
    createdAt: now,
    updatedAt: now,
  });
}

export async function updateUserPreferences(
  userId: string,
  patch: Partial<AutoBudgetPreferences>,
): Promise<AutoBudgetPreferences> {
  await ensureRow(userId);
  const now = new Date().toISOString();
  const updates: Partial<UserPreferences> & { updatedAt: string } = { updatedAt: now };
  if (patch.autoBudgetEnabled !== undefined) updates.autoBudgetEnabled = patch.autoBudgetEnabled;
  if (patch.autoBudgetIntervalMonths !== undefined) {
    updates.autoBudgetIntervalMonths = Math.max(1, Math.min(12, Math.round(patch.autoBudgetIntervalMonths)));
  }
  if (patch.autoBudgetLookbackMonths !== undefined) {
    updates.autoBudgetLookbackMonths = Math.max(1, Math.min(12, Math.round(patch.autoBudgetLookbackMonths)));
  }
  if (patch.lastAutoBudgetCheckAt !== undefined) updates.lastAutoBudgetCheckAt = patch.lastAutoBudgetCheckAt;
  if (patch.financialMonthStartDay !== undefined) {
    updates.financialMonthStartDay = Math.max(1, Math.min(28, Math.round(patch.financialMonthStartDay)));
  }
  await db.update(userPreferences).set(updates).where(eq(userPreferences.userId, userId));
  return getUserPreferences(userId);
}

export async function markAutoBudgetChecked(userId: string): Promise<void> {
  await updateUserPreferences(userId, { lastAutoBudgetCheckAt: new Date().toISOString() });
}
