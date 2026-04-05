import type { Config } from "drizzle-kit";

const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();

const config: Config = tursoUrl
  ? {
      schema: "./src/db/schema.ts",
      out: "./drizzle",
      dialect: "turso",
      dbCredentials: {
        url: tursoUrl,
        authToken: process.env.TURSO_AUTH_TOKEN,
      },
    }
  : {
      schema: "./src/db/schema.ts",
      out: "./drizzle",
      dialect: "sqlite",
      dbCredentials: {
        url: "file:./data/finance.db",
      },
    };

export default config;
