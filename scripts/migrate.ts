import { runMigrations } from "../src/db/run-migrations";

runMigrations()
  .then(() => {
    console.log("Migrations applied and database initialized.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Migration failed:", error);
    process.exit(1);
  });
