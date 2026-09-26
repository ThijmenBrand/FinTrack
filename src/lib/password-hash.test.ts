import crypto from "crypto";
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password-hash";

/** A hash written the way every row in the database was, before this module existed. */
function legacyHash(password: string, salt: string): string {
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString("hex")}`;
}

describe("hashPassword", () => {
  it("writes a hex salt and a 64-byte hex key, separated by a colon", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
  });

  it("salts every hash, so the same password never hashes the same twice", async () => {
    const a = await hashPassword("same password");
    const b = await hashPassword("same password");
    expect(a).not.toBe(b);
    expect(a.split(":")[0]).not.toBe(b.split(":")[0]);
  });
});

describe("verifyPassword", () => {
  it("accepts the password a hash was made from", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects a different password, including near misses", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery stapl", hash)).toBe(false);
    expect(await verifyPassword("Correct horse battery staple", hash)).toBe(false);
    expect(await verifyPassword("correct horse battery staple ", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("handles passwords outside ASCII", async () => {
    const hash = await hashPassword("wachtwoord-€-ü-🔑");
    expect(await verifyPassword("wachtwoord-€-ü-🔑", hash)).toBe(true);
    expect(await verifyPassword("wachtwoord-e-u-🔑", hash)).toBe(false);
  });

  it("still verifies hashes stored before the helpers were shared", async () => {
    const stored = legacyHash("oldpassword1", "00112233445566778899aabbccddeeff");
    expect(await verifyPassword("oldpassword1", stored)).toBe(true);
    expect(await verifyPassword("oldpassword2", stored)).toBe(false);
  });

  it("rejects a hash whose salt was swapped, even with the right key", async () => {
    const hash = await hashPassword("correct horse battery staple");
    const [, key] = hash.split(":");
    expect(await verifyPassword("correct horse battery staple", `ffffffffffffffffffffffffffffffff:${key}`)).toBe(false);
  });

  it.each([
    ["an empty string", ""],
    ["no separator", "0011223344556677"],
    ["an empty key", "00112233445566778899aabbccddeeff:"],
    ["an empty salt", `:${"ab".repeat(64)}`],
    ["a truncated key", `00112233445566778899aabbccddeeff:${"ab".repeat(32)}`],
    ["an over-long key", `00112233445566778899aabbccddeeff:${"ab".repeat(65)}`],
    ["a non-hex key", `00112233445566778899aabbccddeeff:${"zz".repeat(64)}`],
  ])("returns false (never throws or hangs) for %s", async (_label, stored) => {
    await expect(verifyPassword("anything at all", stored)).resolves.toBe(false);
  });
});
