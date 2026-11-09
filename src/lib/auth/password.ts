import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/** scrypt password hashes: `scrypt.<salt>.<hash>`, base64url, no `$` (dotenv would expand it). */
const KEYLEN = 64;
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const derive = (password: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) => scrypt(password.normalize("NFKC"), salt, KEYLEN, PARAMS, (e, k) => (e ? reject(e) : resolve(k))));

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt.${salt.toString("base64url")}.${key.toString("base64url")}`;
}

// Used when the username doesn't exist, so failures take the same time either way.
const DUMMY = "scrypt.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export async function verifyPassword(password: string, stored: string | undefined) {
  const [scheme, saltB64, hashB64] = (stored ?? DUMMY).split(".");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64url");
  const key = await derive(password, Buffer.from(saltB64, "base64url"));
  return stored !== undefined && expected.length === key.length && timingSafeEqual(expected, key);
}
