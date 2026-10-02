import { createPrivateKey, sign, type KeyObject } from "node:crypto";

/**
 * The bearer token for Enable Banking's API: an RS256 JWT signed with the
 * user's own application key, `kid` = their application id.
 *
 * Five minutes of validity (Enable Banking allows up to 24 h): every request
 * mints a fresh one, so a token caught in transit or in a log is worth little.
 */

export const JWT_TTL_SECONDS = 300;

const b64url = (v: object) => Buffer.from(JSON.stringify(v), "utf8").toString("base64url");

export function signEnableBankingJwt(opts: {
  appId: string;
  privateKey: KeyObject | string;
  now?: number;
}): string {
  const iat = Math.floor((opts.now ?? Date.now()) / 1000);
  const header = { typ: "JWT", alg: "RS256", kid: opts.appId };
  const payload = {
    iss: "enablebanking.com",
    aud: "api.enablebanking.com",
    iat,
    exp: iat + JWT_TTL_SECONDS,
  };
  const signingInput = `${b64url(header)}.${b64url(payload)}`;
  const key =
    typeof opts.privateKey === "string" ? createPrivateKey(opts.privateKey) : opts.privateKey;
  const signature = sign("sha256", Buffer.from(signingInput), key).toString("base64url");
  return `${signingInput}.${signature}`;
}
