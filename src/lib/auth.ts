import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, username } from "better-auth/plugins";
import { db } from "@/db/index";
import * as schema from "@/db/schema";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import crypto from "crypto";

// ─── Password Hashing (scrypt — compatible with existing hashes) ────────────

function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

function verifyPassword(password: string, hash: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const [salt, key] = hash.split(":");
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      resolve(crypto.timingSafeEqual(Buffer.from(key, "hex"), derivedKey));
    });
  });
}

// Re-export for use in migrate.ts
export { hashPassword, verifyPassword };

// ─── Better Auth Instance ──────────────────────────────────────────────────

const DEV_FALLBACK_SECRET =
  "complex_password_at_least_32_characters_long_for_dev_only!!";

function getSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET || process.env.SESSION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "BETTER_AUTH_SECRET environment variable is required in production.",
      );
    }
    console.warn("BETTER_AUTH_SECRET not set — using insecure dev fallback.");
    return DEV_FALLBACK_SECRET;
  }
  return secret;
}

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "sqlite", schema }),
  secret: getSecret(),
  baseURL: process.env.BETTER_AUTH_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000"),
  trustedOrigins: [process.env.BETTER_AUTH_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")],
  plugins: [username(), admin()],
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/forget-password": { window: 60, max: 3 },
      "/reset-password": { window: 60, max: 5 },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 minutes
    },
  },
  emailAndPassword: {
    enabled: true,
    signUp: { enabled: false },
    password: {
      hash: async (password: string) => hashPassword(password),
      verify: async (data: { hash: string; password: string }) =>
        verifyPassword(data.password, data.hash),
    },
  },
});

// ─── Session Types ──────────────────────────────────────────────────────────

export interface SessionData {
  userId: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
}

// ─── Session Helpers (identical signatures to old API) ──────────────────────

/**
 * Get the current user's ID from the session.
 * Use in API routes — returns userId or throws a Response.
 */
export async function getUserId(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return session.user.id;
}

/**
 * Require authentication for server components.
 * Redirects to /login if not authenticated.
 */
export async function requireAuth(): Promise<SessionData> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    redirect("/login");
  }
  return {
    userId: session.user.id,
    username:
      ((session.user as Record<string, unknown>).username as string) ||
      session.user.name ||
      "",
    displayName: session.user.name || "",
    isAdmin: (session.user as Record<string, unknown>).role === "admin",
  };
}

/**
 * Require admin privileges. For use in API routes.
 * Throws 401 if not authenticated, 403 for non-admin users.
 */
export async function requireAdmin(): Promise<SessionData> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const data: SessionData = {
    userId: session.user.id,
    username:
      ((session.user as Record<string, unknown>).username as string) ||
      session.user.name ||
      "",
    displayName: session.user.name || "",
    isAdmin: (session.user as Record<string, unknown>).role === "admin",
  };
  if (!data.isAdmin) {
    throw new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  return data;
}
