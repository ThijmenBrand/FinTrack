import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";
import path from "path";

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

export const db = drizzle(client, { schema });
export { schema };
