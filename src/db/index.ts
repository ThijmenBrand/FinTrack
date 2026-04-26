import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";
import path from "path";

type Db = ReturnType<typeof drizzle<typeof schema>>;

let _db: Db | null = null;

function init(): Db {
  const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();
  const isProduction = Boolean(tursoUrl);

  console.log(
    `Using database: ${isProduction ? "Turso" : "SQLite (local file)"}`,
    isProduction
      ? `URL: ${process.env.TURSO_DATABASE_URL}`
      : `File: ${path.join(process.cwd(), "data", "finance.db")}`,
  );

  const client = createClient(
    isProduction
      ? {
          url: tursoUrl!,
          authToken: process.env.TURSO_AUTH_TOKEN,
        }
      : {
          url: `file:${path.join(process.cwd(), "data", "finance.db")}`,
        },
  );

  return drizzle(client, { schema });
}

// Defer client construction until the first property access so that simply
// importing this module — e.g. for a pure helper that lives next to a query
// function — doesn't try to open the database.
export const db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    if (!_db) _db = init();
    return Reflect.get(_db, prop, receiver);
  },
});

export { schema };
