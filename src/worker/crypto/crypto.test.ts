import { describe, it, expect } from "vitest";
import { randomBytes, verify, X509Certificate } from "node:crypto";
import { execFileSync } from "node:child_process";
import { aadFor, needsReseal, open, seal, SecretBoxError, type KeyRing } from "./secret-box";
import { generateCredential, CERTIFICATE_VALIDITY_DAYS } from "./certificate";
import { signEnableBankingJwt, JWT_TTL_SECONDS } from "./jwt";

const ring = (version = 1, key = randomBytes(32)): KeyRing => ({
  current: { version, key },
  previous: new Map(),
});

describe("secret box", () => {
  it("round-trips with the right associated data", () => {
    const r = ring();
    const aad = aadFor("bank_private_key", "user-a", "cred-1");
    const sealed = seal(r, "secret", aad);
    expect(sealed).toMatch(/^v1:/);
    expect(sealed).not.toContain("secret");
    expect(open(r, sealed, aad)).toBe("secret");
  });

  it("uses a fresh IV every time", () => {
    const r = ring();
    const aad = aadFor("bank_private_key", "u", "c");
    expect(seal(r, "same", aad)).not.toBe(seal(r, "same", aad));
  });

  it("refuses a ciphertext moved to another user, row or column", () => {
    const r = ring();
    const sealed = seal(r, "secret", aadFor("bank_private_key", "user-a", "cred-1"));
    expect(() => open(r, sealed, aadFor("bank_private_key", "user-b", "cred-1"))).toThrow(SecretBoxError);
    expect(() => open(r, sealed, aadFor("bank_private_key", "user-a", "cred-2"))).toThrow(SecretBoxError);
    expect(() => open(r, sealed, aadFor("bank_session_id", "user-a", "cred-1"))).toThrow(SecretBoxError);
  });

  it("refuses tampered ciphertext and a wrong key", () => {
    const r = ring();
    const aad = aadFor("bank_session_id", "u", "c");
    const sealed = seal(r, "secret", aad);
    const raw = Buffer.from(sealed.slice(3), "base64url");
    raw[raw.length - 1] ^= 0x01;
    expect(() => open(r, `v1:${raw.toString("base64url")}`, aad)).toThrow(SecretBoxError);
    expect(() => open(ring(), sealed, aad)).toThrow(SecretBoxError);
    expect(() => open(r, "garbage", aad)).toThrow(SecretBoxError);
  });

  it("opens values sealed under the previous key during rotation", () => {
    const old = ring(1);
    const aad = aadFor("bank_session_id", "u", "c");
    const sealed = seal(old, "secret", aad);
    const rotated: KeyRing = { current: { version: 2, key: randomBytes(32) }, previous: new Map([[1, old.current.key]]) };
    expect(open(rotated, sealed, aad)).toBe("secret");
    expect(needsReseal(rotated, sealed)).toBe(true);
    expect(needsReseal(rotated, seal(rotated, "x", aad))).toBe(false);
  });
});

describe("credential generation", () => {
  it("produces a parseable self-signed certificate for the generated key", async () => {
    const now = new Date("2026-10-02T12:00:00Z");
    const cred = await generateCredential(now);
    const cert = new X509Certificate(cred.certificatePem);

    expect(cert.subject).toContain("CN=FinTrack bank sync");
    expect(cert.issuer).toBe(cert.subject);
    expect(cert.ca).toBe(false);
    expect(cert.fingerprint256).toBe(cred.fingerprint);
    expect(new Date(cert.validTo).getTime()).toBe(
      Math.floor((now.getTime() + CERTIFICATE_VALIDITY_DAYS * 86_400_000) / 1000) * 1000,
    );
    expect(new Date(cert.validFrom).getTime()).toBeLessThan(now.getTime());
    expect(cert.verify(cert.publicKey)).toBe(true);
    expect(cert.publicKey.asymmetricKeyDetails?.modulusLength).toBe(4096);
    expect(cred.privateKeyPem).toMatch(/^-----BEGIN PRIVATE KEY-----/);
    expect(cred.certificatePem).not.toContain("PRIVATE");
  }, 60_000);

  it("is accepted by the openssl CLI when it is available", async () => {
    let hasOpenssl = true;
    try {
      execFileSync("openssl", ["version"], { stdio: "ignore" });
    } catch {
      hasOpenssl = false;
    }
    if (!hasOpenssl) return;
    const cred = await generateCredential();
    const text = execFileSync("openssl", ["x509", "-noout", "-text"], { input: cred.certificatePem }).toString();
    expect(text).toContain("Signature Algorithm: sha256WithRSAEncryption");
    expect(text).toContain("CA:FALSE");
    expect(text).toContain("Digital Signature");
  }, 60_000);
});

describe("Enable Banking JWT", () => {
  it("is RS256 with kid, issuer, audience and a five-minute life", async () => {
    const cred = await generateCredential();
    const now = Date.UTC(2026, 9, 2, 12);
    const token = signEnableBankingJwt({ appId: "app-123", privateKey: cred.privateKeyPem, now });
    const [h, p, s] = token.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ typ: "JWT", alg: "RS256", kid: "app-123" });
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    expect(payload).toEqual({
      iss: "enablebanking.com",
      aud: "api.enablebanking.com",
      iat: now / 1000,
      exp: now / 1000 + JWT_TTL_SECONDS,
    });
    const publicKey = new X509Certificate(cred.certificatePem).publicKey;
    expect(verify("sha256", Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, "base64url"))).toBe(true);
  }, 60_000);
});
