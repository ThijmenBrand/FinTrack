import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";
import path from "path";

const isProduction = process.env.TURSO_DATABASE_URL != null;

const client = createClient(
  isProduction
    ? {
        url: process.env.TURSO_DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN,
      }
    : {
        url: `file:${path.join(process.cwd(), "data", "finance.db")}`,
      }
);

export const db = drizzle(client, { schema });
export { schema };
