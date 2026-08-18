import { describe, it, expect, vi, beforeEach } from "vitest";

// The locale comes off the request cookie — that lookup is the whole point of
// `apiError`, so it is what this mocks and asserts on.
let cookie: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "locale" && cookie ? { value: cookie } : undefined) }),
  headers: async () => new Headers(),
}));

import { apiError } from "./api-errors";

beforeEach(() => {
  cookie = undefined;
});

describe("apiError", () => {
  it("translates the message into the cookie's locale", async () => {
    cookie = "nl";
    const res = await apiError("api.accountNotFound", 404);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Rekening niet gevonden" });
  });

  it("falls back to English without a locale cookie", async () => {
    const res = await apiError("api.accountNotFound", 404);
    expect(await res.json()).toEqual({ error: "Account not found" });
  });

  it("interpolates vars and passes extra fields through", async () => {
    cookie = "nl";
    const res = await apiError("api.tooManyRows", 400, { max: 500 }, { code: "TOO_MANY" });
    expect(await res.json()).toEqual({
      error: "Te veel rijen (max 500 per import)",
      code: "TOO_MANY",
    });
  });
});
