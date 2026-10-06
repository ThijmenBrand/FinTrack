import { describe, expect, it } from "vitest";
import { firstName, parseRememberedAccount } from "./remembered-account";

describe("parseRememberedAccount", () => {
  it("reads a stored account", () => {
    expect(
      parseRememberedAccount(
        JSON.stringify({ email: "a@b.nl", name: " Thijmen Brand ", method: "passkey" }),
      ),
    ).toEqual({ email: "a@b.nl", name: "Thijmen Brand", method: "passkey" });
  });

  it("defaults a missing or unknown method to password and a blank name to null", () => {
    expect(
      parseRememberedAccount(JSON.stringify({ email: "a@b.nl", name: "  ", method: "x" })),
    ).toEqual({ email: "a@b.nl", name: null, method: "password" });
  });

  it("rejects anything that isn't a stored account", () => {
    expect(parseRememberedAccount(null)).toBeNull();
    expect(parseRememberedAccount("")).toBeNull();
    expect(parseRememberedAccount("{not json")).toBeNull();
    expect(parseRememberedAccount("null")).toBeNull();
    expect(parseRememberedAccount('"a@b.nl"')).toBeNull();
    expect(parseRememberedAccount(JSON.stringify({ email: 42 }))).toBeNull();
    expect(parseRememberedAccount(JSON.stringify({ email: "no-at-sign" }))).toBeNull();
  });
});

describe("firstName", () => {
  it("takes the first word", () => {
    expect(firstName("Thijmen Brand")).toBe("Thijmen");
    expect(firstName("  Thijmen  ")).toBe("Thijmen");
  });

  it("is null without a name", () => {
    expect(firstName(null)).toBeNull();
    expect(firstName("   ")).toBeNull();
  });
});
