import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const getSession = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: { api: { get getSession() { return getSession; } } } }));

// The lock's decisions are tested in session-lock.test.ts; here only its
// database half is stubbed, so the real exemption rules still apply.
const readLockState = vi.fn();
const touchSession = vi.fn();
vi.mock("@/lib/session-lock", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/session-lock")>()),
  readLockState: (...args: unknown[]) => readLockState(...args),
  touchSession: (...args: unknown[]) => touchSession(...args),
}));

import { proxy } from "./proxy";

function sessionResponse(setCookie: string | null, role = "user") {
  const headers = new Headers({ "content-type": "application/json" });
  if (setCookie) headers.append("set-cookie", setCookie);
  return new Response(
    JSON.stringify({ session: { id: "s1" }, user: { id: "u1", role } }),
    { headers },
  );
}

beforeEach(() => {
  readLockState.mockReset().mockResolvedValue({ locked: false, touch: false });
  touchSession.mockReset().mockResolvedValue(undefined);
});

function get(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: { cookie: "better-auth.session_token=abc" },
  });
}

describe("proxy session refresh", () => {
  beforeEach(() => getSession.mockReset());

  // The sliding expiry only slides if the browser receives the re-issued
  // cookie — dropping it here logs active users out an hour after login.
  it("forwards better-auth's refreshed session cookie", async () => {
    const cookie = "better-auth.session_token=fresh; Path=/; Max-Age=3600";
    getSession.mockResolvedValue(sessionResponse(cookie));

    const response = await proxy(get("/transactions"));

    expect(response.headers.getSetCookie()).toContain(cookie);
  });

  it("passes through untouched when the session was served from cache", async () => {
    getSession.mockResolvedValue(sessionResponse(null));

    const response = await proxy(get("/transactions"));

    expect(response.headers.getSetCookie()).toEqual([]);
  });
});

describe("proxy CSRF origin check", () => {
  beforeEach(() => getSession.mockReset());

  function post(path: string): NextRequest {
    return new NextRequest(`http://localhost:3000${path}`, {
      method: "POST",
      headers: {
        cookie: "better-auth.session_token=abc",
        origin: "https://evil.com",
      },
    });
  }

  // /api/auth/profile* are ours, not better-auth's, so nothing downstream
  // checks the Origin for them — the exemption must not swallow them.
  it("rejects a cross-origin write to our own route under /api/auth", async () => {
    getSession.mockResolvedValue(sessionResponse(null));
    expect((await proxy(post("/api/auth/profile"))).status).toBe(403);
    expect((await proxy(post("/api/auth/profile/avatar"))).status).toBe(403);
  });

  it("leaves better-auth's own handler to its trustedOrigins", async () => {
    getSession.mockResolvedValue(sessionResponse(null));
    expect((await proxy(post("/api/auth/sign-in/email"))).status).not.toBe(403);
  });

  it("still guards every other API route", async () => {
    getSession.mockResolvedValue(sessionResponse(null));
    expect((await proxy(post("/api/transactions"))).status).toBe(403);
  });
});

describe("proxy idle lock", () => {
  beforeEach(() => getSession.mockReset());

  function request(path: string, method = "GET"): NextRequest {
    return new NextRequest(`http://localhost:3000${path}`, {
      method,
      headers: {
        cookie: "better-auth.session_token=abc",
        origin: "http://localhost:3000",
      },
    });
  }

  // A Response body reads once; tests that make several requests need one each.
  function signedIn(role = "user") {
    getSession.mockImplementation(async () => sessionResponse(null, role));
  }

  function locked() {
    readLockState.mockResolvedValue({ locked: true, touch: false });
  }

  it("sends a locked page request to the lock screen and back", async () => {
    signedIn();
    locked();

    const response = await proxy(request("/transactions?account=a1&_rsc=xyz"));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/unlock");
    // The router's cache-buster is not part of where the user was.
    expect(location.searchParams.get("redirect")).toBe("/transactions?account=a1");
  });

  it("answers a locked API request with a recognisable 401", async () => {
    signedIn();
    locked();

    const response = await proxy(request("/api/transactions"));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "session_locked" });
  });

  // /api/auth/ is public for signing in — but with a locked session behind
  // the cookie, better-auth's account endpoints must stay shut, or a locked
  // phone could register the finder's own passkey and unlock with it.
  it("keeps better-auth's account endpoints shut while locked", async () => {
    signedIn();
    locked();

    for (const path of [
      "/api/auth/passkey/generate-register-options",
      "/api/auth/list-sessions",
      "/api/auth/get-session",
      "/api/auth/profile",
    ]) {
      const response = await proxy(request(path, path.endsWith("profile") ? "POST" : "GET"));
      expect(response.status, path).toBe(401);
    }
  });

  it("lets a locked session sign out and reach the lock screen", async () => {
    signedIn();
    locked();

    expect((await proxy(request("/api/auth/sign-out", "POST"))).status).toBe(200);
    expect((await proxy(request("/api/unlock/password", "POST"))).status).toBe(200);
    expect((await proxy(request("/unlock"))).status).toBe(200);
  });

  // Role routing would send an admin from /unlock to /backoffice, which is
  // locked, which sends them to /unlock…
  it("leaves the lock screen out of the role routing", async () => {
    signedIn("admin");
    locked();

    const response = await proxy(request("/unlock"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("records activity on an unlocked request once it is due", async () => {
    signedIn();
    readLockState.mockResolvedValue({ locked: false, touch: true });

    const response = await proxy(request("/transactions"));

    expect(response.status).toBe(200);
    expect(touchSession).toHaveBeenCalledWith("s1", "u1");
  });

  it("doesn't count the lock check itself as activity", async () => {
    signedIn();
    readLockState.mockResolvedValue({ locked: false, touch: true });

    await proxy(request("/api/unlock"));

    expect(readLockState).not.toHaveBeenCalled();
    expect(touchSession).not.toHaveBeenCalled();
  });

  it("treats a failed lock lookup as locked", async () => {
    signedIn();
    readLockState.mockRejectedValue(new Error("db down"));

    expect((await proxy(request("/api/transactions"))).status).toBe(401);
  });
});
