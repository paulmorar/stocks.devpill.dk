/**
 * Signed session cookies (HMAC-SHA256 via Web Crypto), no database.
 *
 * Two ways in, both checked server-side against Vercel env vars:
 *  - GitHub SSO: the account's verified emails must appear in AUTH_ALLOWED_EMAILS.
 *  - Password (optional fallback): AUTH_USERS holds `name:scrypt.<salt>.<hash>`
 *    pairs, created with `npm run user -- <name>`.
 * Every request re-checks the session against the current env, so removing an
 * email from the allowlist (or a user, or changing a password) locks that
 * person out on the next deploy, and rotating AUTH_SECRET logs out everyone.
 */

export const SESSION_COOKIE = "scout_session";
export const SESSION_DAYS = 30;

export interface Session {
  /** Lower-cased email (GitHub) or username (password). */
  u: string;
  /** "gh" for GitHub sessions, or a fingerprint of the password hash at login. */
  v: string;
  exp: number;
}

export const GITHUB_SESSION = "gh";

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s: string) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Parse AUTH_USERS into name → stored hash. Names are case-insensitive. */
export function parseUsers(raw = process.env.AUTH_USERS ?? ""): Map<string, string> {
  const m = new Map<string, string>();
  for (const part of raw.split(",")) {
    const i = part.indexOf(":");
    if (i < 1) continue;
    const name = part.slice(0, i).trim().toLowerCase();
    const hash = part.slice(i + 1).trim();
    if (name && hash.startsWith("scrypt.")) m.set(name, hash);
  }
  return m;
}

/** Short, non-reversible fingerprint of a stored hash (last 12 chars of its digest part). */
export const fingerprint = (storedHash: string) => storedHash.slice(-12);

export async function signSession(s: Session, secret: string) {
  const body = b64url(enc.encode(JSON.stringify(s)));
  return `${body}.${await hmac(secret, body)}`;
}

/** AUTH_ALLOWED_EMAILS: comma- or whitespace-separated, case-insensitive. */
export function parseAllowlist(raw = process.env.AUTH_ALLOWED_EMAILS ?? ""): Set<string> {
  return new Set(raw.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@")));
}

export const githubConfigured = (env = process.env) =>
  !!env.GITHUB_CLIENT_ID && !!env.GITHUB_CLIENT_SECRET && parseAllowlist(env.AUTH_ALLOWED_EMAILS).size > 0;

export async function verifySession(
  token: string | undefined,
  secret: string,
  users: Map<string, string>,
  allowlist: Set<string> = new Set(),
  now = Date.now(),
): Promise<Session | undefined> {
  if (!token || !secret) return undefined;
  const [body, sig] = token.split(".");
  if (!body || !sig) return undefined;
  if (!safeEqual(sig, await hmac(secret, body))) return undefined;
  let s: Session;
  try {
    s = JSON.parse(new TextDecoder().decode(fromB64url(body))) as Session;
  } catch {
    return undefined;
  }
  if (typeof s.exp !== "number" || s.exp < now) return undefined;
  if (s.v === GITHUB_SESSION) return allowlist.has(s.u) ? s : undefined;
  const stored = users.get(s.u);
  if (!stored || !safeEqual(s.v, fingerprint(stored))) return undefined;
  return s;
}

export type AuthMode = "on" | "off" | "misconfigured";

/**
 * Auth is on when AUTH_SECRET and AUTH_USERS are set. Without them, local dev
 * stays open; a production deploy fails closed rather than going public by accident.
 * AUTH_DISABLED=1 turns it off explicitly.
 */
export function authMode(env = process.env): AuthMode {
  if (env.AUTH_DISABLED === "1") return "off";
  const configured = (env.AUTH_SECRET ?? "").length >= 32 && (githubConfigured(env) || parseUsers(env.AUTH_USERS).size > 0);
  if (configured) return "on";
  return env.NODE_ENV === "production" ? "misconfigured" : "off";
}

/** Only allow same-site relative redirects after login (no `//evil.com`, no `/\evil.com`). */
export function safeNext(next: string | null | undefined) {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || next.startsWith("/login") || next.startsWith("/api/auth")) return "/";
  return next;
}
