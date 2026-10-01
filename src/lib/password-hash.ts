import crypto from "crypto";

// scrypt, stored as "<hex salt>:<hex key>" — the format every existing hash in
// the database already has. Kept free of app imports so the migration and
// maintenance scripts can hash without pulling in better-auth or Next.

const KEY_LENGTH = 64;

export function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");
    crypto.scrypt(password, salt, KEY_LENGTH, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

/**
 * False for a wrong password — and for a stored value that isn't a hash this
 * function could have written (no separator, empty or non-hex key), rather
 * than throwing out of the scrypt callback where nothing can catch it.
 */
export function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [salt, key] = hash.split(":");
  if (!salt || !key || !/^[0-9a-f]+$/i.test(key) || key.length !== KEY_LENGTH * 2) {
    return Promise.resolve(false);
  }
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LENGTH, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(crypto.timingSafeEqual(Buffer.from(key, "hex"), derivedKey));
    });
  });
}
