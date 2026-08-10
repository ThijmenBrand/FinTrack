import { db } from "@/db";
import { sql } from "drizzle-orm";
import { hashPassword } from "@/lib/auth";
import { seedCategoriesForUser } from "@/db/migrate";
import type { Locale } from "@/lib/i18n";

export interface CreateUserInput {
  email: string;
  displayName: string;
  password: string;
  isAdmin?: boolean;
  emailVerified?: boolean;
  /** Language the starter categories are seeded in. Defaults to English. */
  locale?: Locale;
}

/**
 * Create a user, their credential account and default categories.
 * Returns the new id, or null when the email is already taken —
 * INSERT ... WHERE NOT EXISTS keeps that check atomic against concurrent creates.
 */
export async function createUserAccount(
  input: CreateUserInput,
): Promise<string | null> {
  const id = crypto.randomUUID();
  const hashedPassword = await hashPassword(input.password);
  const now = Date.now();

  const inserted = await db.run(sql`
    INSERT INTO "user" (id, name, email, email_verified, role, created_at, updated_at)
    SELECT ${id}, ${input.displayName}, ${input.email}, ${input.emailVerified ? 1 : 0},
           ${input.isAdmin ? "admin" : "user"}, ${now}, ${now}
    WHERE NOT EXISTS (
      SELECT 1 FROM "user" WHERE email = ${input.email}
    )
  `);
  if (Number(inserted.rowsAffected) === 0) return null;

  await db.run(sql`
    INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
    VALUES (${crypto.randomUUID()}, ${id}, 'credential', ${id}, ${hashedPassword}, ${now}, ${now})
  `);

  await seedCategoriesForUser(id, input.locale);

  return id;
}
