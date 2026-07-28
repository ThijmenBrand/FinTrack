import { existsSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { BANKS, bankLogo } from "./banks";

describe("bankLogo", () => {
  it("resolves to a file that exists for every real bank", () => {
    for (const b of BANKS.filter((b) => b.value !== "other")) {
      const logo = bankLogo(b.value);
      expect(logo, `${b.value} has no logo`).toBeDefined();
      expect(existsSync(`public${logo!.src}`), `missing public${logo!.src}`).toBe(true);
    }
  });

  it("has nothing to draw for 'other', unknown slugs or no bank", () => {
    expect(bankLogo("other")).toBeUndefined();
    expect(bankLogo("not-a-bank")).toBeUndefined();
    expect(bankLogo("../../etc/passwd")).toBeUndefined();
    expect(bankLogo(null)).toBeUndefined();
    expect(bankLogo(undefined)).toBeUndefined();
  });
});
