import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const getSession = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: { api: { get getSession() { return getSession; } } } }));

import { proxy } from "./proxy";

function sessionResponse(setCookie: string | null) {
  const headers = new Headers({ "content-type": "application/json" });
  if (setCookie) headers.append("set-cookie", setCookie);
  return new Response(
    JSON.stringify({ session: { id: "s1" }, user: { id: "u1", role: "user" } }),
    { headers },
  );
}

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
