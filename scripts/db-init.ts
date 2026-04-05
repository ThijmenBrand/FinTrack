import { initializeDatabase } from "../src/db/migrate";

async function main() {
  console.log("Initializing database...");
  await initializeDatabase();
  console.log("Database initialized successfully.");
  process.exit(0);
}

main().catch((error) => {
  console.error("Database initialization failed:", error);
  process.exit(1);
});
