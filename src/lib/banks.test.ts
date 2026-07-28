import { describe, it, expect } from "vitest";
import { BANKS, bankBrand } from "./banks";

describe("bankBrand", () => {
  it("returns a drawable mark for every real bank", () => {
    for (const b of BANKS.filter((b) => b.value !== "other")) {
      const brand = bankBrand(b.value);
      expect(brand, `${b.value} is missing short/color`).toBeDefined();
      expect(brand!.short).toBeTruthy();
      expect(brand!.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("has nothing to draw for 'other', unknown slugs or no bank", () => {
    expect(bankBrand("other")).toBeUndefined();
    expect(bankBrand("not-a-bank")).toBeUndefined();
    expect(bankBrand(null)).toBeUndefined();
    expect(bankBrand(undefined)).toBeUndefined();
  });
});
