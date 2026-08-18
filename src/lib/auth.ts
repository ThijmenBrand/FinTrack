import * as Sentry from "@sentry/nextjs";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, twoFactor } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { db } from "@/db/index";
import * as schema from "@/db/schema";
import { userPin } from "@/db/schema";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import crypto from "crypto";
import { logAuthEvent } from "@/lib/audit";
import { sendVerificationEmail, sendPasswordResetEmail } from "@/lib/email";
import { MIN_PASSWORD_LENGTH } from "@/lib/validation";
import { seedCategoriesForUser } from "@/db/migrate";
import { apiError } from "@/lib/api-errors";
import { getRequestLocale } from "@/lib/i18n/request";
import { isLocale, type Locale } from "@/lib/i18n";

/**
 * Language for a mail sent to `userId`: their stored preference, or — for
 * brand-new signups that have no preferences row yet — the language of the
 * request that triggered the mail.
 */
async function emailLocale(userId: string): Promise<Locale> {
  const [row] = await db
    .select({ locale: schema.userPreferences.locale })
    .from(schema.userPreferences)
    .where(eq(schema.userPreferences.userId, userId))
    .limit(1);
  const stored = row?.locale;
  return isLocale(stored) ? stored : getRequestLocale();
}

// ─── Password Hashing (scrypt — compatible with existing hashes) ────────────

function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

function verifyPassword(password: string, hash: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const [salt, key] = hash.split(":");
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
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

export function getBaseURL(): string {
  if (process.env.BETTER_AUTH_URL) return process.env.BETTER_AUTH_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL)
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "sqlite", schema }),
  secret: getSecret(),
  baseURL: getBaseURL(),
  appName: "FinTrack",
  trustedOrigins: [getBaseURL()],
  plugins: [
    admin(),
    passkey({ rpName: "FinTrack" }),
    twoFactor({ issuer: "FinTrack" }),
  ],
  rateLimit: {
    enabled: true,
    // In-memory limits reset on every serverless cold start; the database
    // store makes them real on Vercel.
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60, max: 5 },
      "/forget-password": { window: 60, max: 3 },
      "/request-password-reset": { window: 60, max: 3 },
      "/reset-password": { window: 60, max: 5 },
      // A TOTP code is 6 digits and stays valid for ~30s. Without a rule of
      // its own the verify endpoints fall back to the global 100/min, which
      // is enough attempts to be worth trying — these are the second factor,
      // so the password is already assumed known.
      "/two-factor/verify-totp": { window: 60, max: 5 },
      "/two-factor/verify-otp": { window: 60, max: 5 },
      "/two-factor/verify-backup-code": { window: 60, max: 5 },
    },
  },
  session: {
    // Idle timeout: the session dies an hour after the last request that
    // reached the database. `updateAge: 0` slides that hour forward on every
    // such request, so an active user is never logged out mid-use.
    expiresIn: 60 * 60,
    updateAge: 0,
    cookieCache: {
      enabled: true,
      // Requests served from this cache don't slide the window, so the
      // effective idle timeout is 1h minus (at most) this cache's age.
      maxAge: 60,
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          // Only self-signup goes through the adapter — the admin create route
          // and the migrate seed insert with raw SQL and seed explicitly.
          await seedCategoriesForUser(user.id, await getRequestLocale());
          logAuthEvent({ userId: user.id, action: "user_signup" });
        },
      },
    },
    session: {
      create: {
        after: async (session) => {
          await db
            .update(userPin)
            .set({ failedAttempts: 0, lockoutCount: 0, lockedUntil: null, updatedAt: new Date().toISOString() })
            .where(eq(userPin.userId, session.userId));

          // Log successful login
          logAuthEvent({
            userId: session.userId,
            action: "login_success",
            ipAddress: (session as Record<string, unknown>).ipAddress as string || null,
            userAgent: (session as Record<string, unknown>).userAgent as string || null,
          });
        },
      },
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      await sendVerificationEmail(user.email, url, await emailLocale(user.id));
    },
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 3600,
  },
  emailAndPassword: {
    enabled: true,
    // Signup availability is enforced at runtime in the /api/auth/[...all]
    // route (backoffice-controlled toggle) — better-auth's own signup stays on.
    requireEmailVerification: true,
    minPasswordLength: MIN_PASSWORD_LENGTH,
    sendResetPassword: async ({ user, url }) => {
      await sendPasswordResetEmail(user.email, url, await emailLocale(user.id));
    },
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
  displayName: string;
  isAdmin: boolean;
  twoFactorEnabled: boolean;
}

// ─── Session Helpers (identical signatures to old API) ──────────────────────

/**
 * Get the current user's ID from the session.
 * Use in API routes — returns userId or throws a Response.
 */
export async function getUserId(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    throw await apiError("api.unauthorized", 401);
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
    displayName: session.user.name || "",
    isAdmin: (session.user as Record<string, unknown>).role === "admin",
    twoFactorEnabled: (session.user as Record<string, unknown>).twoFactorEnabled === true,
  };
}

/**
 * Require admin privileges for backoffice server components.
 * Redirects to /backoffice/login if unauthenticated, / for non-admins.
 */
export async function requireBackofficeAdmin(): Promise<SessionData> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    redirect("/backoffice/login");
  }
  if ((session.user as Record<string, unknown>).role !== "admin") {
    redirect("/");
  }
  if ((session.user as Record<string, unknown>).twoFactorEnabled !== true) {
    redirect("/backoffice/security");
  }
  return {
    userId: session.user.id,
    displayName: session.user.name || "",
    isAdmin: true,
    twoFactorEnabled: (session.user as Record<string, unknown>).twoFactorEnabled === true,
  };
}

/**
 * Require admin privileges. For use in API routes.
 * Throws 401 if not authenticated, 403 for non-admin users.
 */
export async function requireAdmin(): Promise<SessionData> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    throw await apiError("api.unauthorized", 401);
  }
  const data: SessionData = {
    userId: session.user.id,
    displayName: session.user.name || "",
    isAdmin: (session.user as Record<string, unknown>).role === "admin",
    twoFactorEnabled: (session.user as Record<string, unknown>).twoFactorEnabled === true,
  };
  if (!data.isAdmin) {
    throw await apiError("api.forbidden", 403);
  }
  if (!data.twoFactorEnabled) {
    throw await apiError("api.adminTwoFactorRequired", 403);
  }
  return data;
}

// ─── Route Handler Wrappers ─────────────────────────────────────────────────

/**
 * Resolve auth, run the handler, and normalize errors. A thrown `Response`
 * (the 401/403 that `getUserId`/`requireAdmin` throw) is returned as-is so the
 * real status reaches the client; anything else is logged and mapped to a 500.
 *
 * `errorMessage` labels the log and the Sentry breadcrumb only. The client is
 * told the same translated "something went wrong" either way — which of our
 * queries fell over is not the user's problem, and it is not translatable.
 */
async function runWithAuth<T>(
  resolve: () => Promise<T>,
  handler: (auth: T) => Promise<Response> | Response,
  errorMessage: string,
): Promise<Response> {
  try {
    const auth = await resolve();
    return await handler(auth);
  } catch (error) {
    if (error instanceof Response) return error;
    Sentry.captureException(error);
    console.error(`${errorMessage}:`, error);
    return apiError("api.serverError", 500);
  }
}

/** Wrap an API handler that needs the current user's id. */
export function withUser(
  handler: (userId: string) => Promise<Response> | Response,
  errorMessage: string,
): Promise<Response> {
  return runWithAuth(getUserId, handler, errorMessage);
}

/** Wrap an API handler that requires admin privileges. */
export function withAdmin(
  handler: (session: SessionData) => Promise<Response> | Response,
  errorMessage: string,
): Promise<Response> {
  return runWithAuth(requireAdmin, handler, errorMessage);
}
