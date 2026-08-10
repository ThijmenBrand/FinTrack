/**
 * Reset password for a user in the deployed Turso database.
 *
 * Usage:
 *   npx tsx scripts/reset-password.ts
 *
 * Requires TURSO_DATABASE_URL and TURSO_AUTH_TOKEN env vars
 * (reads from .env automatically via dotenv).
 */

import crypto from "crypto";
import readline from "readline";
import fs from "fs";
import path from "path";
import { createClient } from "@libsql/client";

// Load .env manually
const envPath = path.resolve(import.meta.dirname ?? __dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

// ── Helpers ──────────────────────────────────────────────────

function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

function prompt(question: string, hidden = false): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    if (hidden) {
      process.stdout.write(question);
      const stdin = process.stdin;
      const wasRaw = stdin.isRaw;
      if (stdin.isTTY) stdin.setRawMode(true);

      let input = "";
      const onData = (char: Buffer) => {
        const c = char.toString();
        if (c === "\n" || c === "\r") {
          stdin.removeListener("data", onData);
          if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
          process.stdout.write("\n");
          rl.close();
          resolve(input);
        } else if (c === "\u0003") {
          process.exit(1);
        } else if (c === "\u007F" || c === "\b") {
          input = input.slice(0, -1);
        } else {
          input += c;
        }
      };
      stdin.on("data", onData);
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  const url = process.env.TURSO_DATABASE_URL?.trim();
  const authToken = process.env.TURSO_AUTH_TOKEN?.trim();

  if (!url || !authToken) {
    console.error(
      "Error: TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set in .env",
    );
    process.exit(1);
  }

  const client = createClient({ url, authToken });

  // List users
  const users = await client.execute(
    "SELECT id, name FROM user",
  );

  if (users.rows.length === 0) {
    console.error("No users found in database.");
    process.exit(1);
  }

  console.log("\nUsers:");
  users.rows.forEach((row, i) => {
    console.log(`  ${i + 1}. ${row.name}`);
  });

  const choice = await prompt("\nSelect user number: ");
  const idx = parseInt(choice, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= users.rows.length) {
    console.error("Invalid selection.");
    process.exit(1);
  }

  const userId = users.rows[idx].id as string;
  const name = users.rows[idx].name as string;

  const password = await prompt("New password (min 10 chars): ", true);
  if (password.length < 10) {
    console.error("Password must be at least 10 characters.");
    process.exit(1);
  }

  const confirm = await prompt("Confirm password: ", true);
  if (password !== confirm) {
    console.error("Passwords do not match.");
    process.exit(1);
  }

  const hash = await hashPassword(password);

  await client.execute({
    sql: "UPDATE account SET password = ? WHERE user_id = ? AND provider_id = 'credential'",
    args: [hash, userId],
  });

  console.log(`\nPassword reset successfully for user "${name}".`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
