import { drizzle } from "drizzle-orm/libsql";
import { createClient, type Client, type InStatement } from "@libsql/client";
import * as schema from "./schema";
import path from "path";

type Db = ReturnType<typeof drizzle<typeof schema>>;

// Every table that carries a user_id column. reimbursement_links is absent —
// it has no user_id and is scoped through the transactions it references.
const TENANT_TABLES = [
  "accounts",
  "transactions",
  "categories",
  "category_rules",
  "budgets",
  "budget_plans",
  "budget_month_targets",
  "budget_sub_lines",
  "user_preferences",
  "recurring_transactions",
  "import_batches",
  "transaction_groups",
  "stat_resets",
  "user_pin",
  "audit_log",
];

const TENANT_RE = new RegExp(`\\b(${TENANT_TABLES.join("|")})\\b`, "i");
const DML_RE = /^\s*(select|insert|update|delete|with)\b/i;
const USER_ID_RE = /\buser_id\b/i;

/**
 * Tripwire for the single-database tenant model: any DML that touches a
 * user-owned table must name user_id somewhere in the statement, or it is
 * refused before it reaches SQLite. Textual, not semantic — it cannot tell a
 * right user_id from a wrong one — but it turns the "forgot to scope at all"
 * class of bug from a silent cross-user leak into a thrown error the first
 * time the query runs, in dev, tests, and prod alike. Cross-user access that
 * is meant to exist (backoffice, bootstrap/migrations) uses `adminDb`.
 */
export function assertTenantScoped(stmt: InStatement): void {
  const text = typeof stmt === "string" ? stmt : stmt.sql;
  if (!DML_RE.test(text) || !TENANT_RE.test(text) || USER_ID_RE.test(text)) return;
  throw new Error(
    "Refusing unscoped query on a tenant table (no user_id in statement). " +
      "Scope it to the session user, or use adminDb for legitimate cross-user access. " +
      `SQL: ${text}`,
  );
}

/**
 * Wrap a libsql Client (or the Transaction it hands out) so every statement
 * passes the tripwire. Drizzle reaches the database exclusively through
 * execute/batch/transaction, so guarding these three covers every query.
 */
function guarded<T extends object>(target: T): T {
  return new Proxy(target, {
    get(obj, prop) {
      if (prop === "execute") {
        return (stmt: InStatement) => {
          assertTenantScoped(stmt);
          return (obj as Client).execute(stmt);
        };
      }
      if (prop === "batch") {
        return (stmts: InStatement[], mode?: unknown) => {
          for (const s of stmts) assertTenantScoped(s);
          return (obj as Client).batch(stmts, mode as never);
        };
      }
      if (prop === "transaction" && "transaction" in obj) {
        return async (mode?: unknown) =>
          guarded(await (obj as unknown as Client).transaction(mode as never));
      }
      const value = Reflect.get(obj, prop);
      return typeof value === "function" ? value.bind(obj) : value;
    },
  });
}

let _client: Client | null = null;

function getClient(): Client {
  if (_client) return _client;

  const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();
  const isProduction = Boolean(tursoUrl);

  // Don't log the Turso URL: logs ship to Sentry and the URL is effectively a secret.
  console.log(
    `Using database: ${isProduction ? "Turso" : "SQLite (local file)"}`,
    isProduction ? "" : `File: ${path.join(process.cwd(), "data", "finance.db")}`,
  );

  _client = createClient(
    isProduction
      ? {
          url: tursoUrl!,
          authToken: process.env.TURSO_AUTH_TOKEN,
        }
      : {
          url: `file:${path.join(process.cwd(), "data", "finance.db")}`,
        },
  );
  return _client;
}

// Defer client construction until the first property access so that simply
// importing this module — e.g. for a pure helper that lives next to a query
// function — doesn't try to open the database.
function lazy(make: () => Db): Db {
  let real: Db | null = null;
  return new Proxy({} as Db, {
    get(_target, prop, receiver) {
      if (!real) real = make();
      return Reflect.get(real, prop, receiver);
    },
  });
}

/** Tenant-guarded handle: refuses DML on user-owned tables without user_id. */
export const db = lazy(() => drizzle(guarded(getClient()), { schema }));

/**
 * Unguarded handle for code that legitimately crosses users: backoffice
 * routes and bootstrap/migrations. ESLint refuses this import outside
 * src/app/api/admin and src/db.
 */
export const adminDb = lazy(() => drizzle(getClient(), { schema }));

export { schema };
