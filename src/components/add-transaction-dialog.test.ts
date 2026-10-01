import { describe, it, expect } from "vitest";
import { parseManualAmount } from "./add-transaction-dialog";

describe("parseManualAmount", () => {
  it("reads Dutch and plain decimals", () => {
    expect(parseManualAmount("12,50")).toBe(12.5);
    expect(parseManualAmount("1.234,56")).toBe(1234.56);
    expect(parseManualAmount("12.5")).toBe(12.5);
    expect(parseManualAmount("€ 50")).toBe(50);
  });

  it("drops a typed minus — the direction toggle carries the sign", () => {
    expect(parseManualAmount("-50")).toBe(50);
  });

  it("rounds to cents", () => {
    expect(parseManualAmount("0,005")).toBe(0.01);
    expect(parseManualAmount("9,999")).toBe(10);
  });

  it("refuses empty, zero and non-numbers", () => {
    expect(parseManualAmount("")).toBeNull();
    expect(parseManualAmount("   ")).toBeNull();
    expect(parseManualAmount("0")).toBeNull();
    expect(parseManualAmount("0,001")).toBeNull();
    expect(parseManualAmount("abc")).toBeNull();
  });
});
