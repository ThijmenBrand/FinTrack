import { describe, it, expect } from "vitest";
import { routePath, twoFactorEscapeHatch } from "./auth-route-guards";

const p = (path: string) => routePath(`https://fintrack.test${path}`);

describe("twoFactorEscapeHatch", () => {
  it("catches the disable endpoint, with or without a trailing slash", () => {
    expect(twoFactorEscapeHatch(p("/api/auth/two-factor/disable"), {})).toBe("disable");
    expect(twoFactorEscapeHatch(p("/api/auth/two-factor/disable/"), {})).toBe("disable");
  });

  it("catches update-user writing twoFactorEnabled in either direction", () => {
    const body = (value: boolean) => ({ userId: "u1", data: { twoFactorEnabled: value } });
    expect(twoFactorEscapeHatch(p("/api/auth/admin/update-user"), body(false))).toBe("update-user");
    expect(twoFactorEscapeHatch(p("/api/auth/admin/update-user"), body(true))).toBe("update-user");
    expect(twoFactorEscapeHatch(p("/api/auth/admin/update-user/"), body(false))).toBe("update-user");
  });

  it("lets unrelated traffic through", () => {
    expect(twoFactorEscapeHatch(p("/api/auth/two-factor/enable"), {})).toBeNull();
    expect(twoFactorEscapeHatch(p("/api/auth/sign-in/email"), {})).toBeNull();
    expect(twoFactorEscapeHatch(p("/api/auth/admin/update-user"), { userId: "u1", data: { name: "Ada" } })).toBeNull();
    expect(twoFactorEscapeHatch(p("/api/auth/admin/update-user"), null)).toBeNull();
  });

  it("ignores a query string", () => {
    expect(twoFactorEscapeHatch(p("/api/auth/two-factor/disable?x=1"), {})).toBe("disable");
  });
});
