import "server-only";
import { createHash } from "node:crypto";

/**
 * Where account lists are kept: an Upstash Redis database over its REST API
 * (Vercel Marketplace, "Upstash for Redis"). One hash per account holds the
 * document and its version. Writes are compare-and-set in a Lua script, so two
 * tabs or devices saving at once can't overwrite each other's changes.
 */

export interface StoredDoc {
  version: number;
  doc: unknown;
}

export interface ListStore {
  read(owner: string): Promise<StoredDoc | null>;
  /** Saves only if the stored version still equals `expected`; the new version is expected + 1. */
  write(owner: string, expected: number, doc: unknown): Promise<boolean>;
  remove(owner: string): Promise<void>;
}

export class StoreError extends Error {}

/** Account ids contain email addresses; keys hold only a hash of them. */
export const storeKey = (owner: string) => `scout:lists:v1:${createHash("sha256").update(owner).digest("hex")}`;

export const CAS_SCRIPT = `local v = redis.call('HGET', KEYS[1], 'v')
if (v or '0') ~= ARGV[1] then return 0 end
redis.call('HSET', KEYS[1], 'v', ARGV[2], 'doc', ARGV[3])
return 1`;

const TIMEOUT_MS = 5000;

export function upstashStore(baseUrl: string, token: string, fetchImpl: typeof fetch = fetch): ListStore {
  const url = baseUrl.replace(/\/+$/, "");
  async function command(args: (string | number)[]): Promise<unknown> {
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (e) {
      const timedOut = (e as { name?: string })?.name === "TimeoutError";
      throw new StoreError(timedOut ? "The list database did not respond in time." : "The list database could not be reached.");
    }
    const body = (await res.json().catch(() => ({}))) as { result?: unknown; error?: string };
    if (res.status === 401) throw new StoreError("The list database rejected the credentials. Check the Upstash token.");
    if (!res.ok || body.error) throw new StoreError(`The list database returned an error (HTTP ${res.status}).`);
    return body.result;
  }

  return {
    async read(owner) {
      const result = await command(["HMGET", storeKey(owner), "v", "doc"]);
      const [v, doc] = Array.isArray(result) ? result : [];
      if (v == null && doc == null) return null;
      const version = Number(v);
      if (!Number.isInteger(version) || version < 1 || typeof doc !== "string") throw new StoreError("Your saved lists are unreadable.");
      try {
        return { version, doc: JSON.parse(doc) };
      } catch {
        throw new StoreError("Your saved lists are unreadable.");
      }
    },
    async write(owner, expected, doc) {
      const result = await command(["EVAL", CAS_SCRIPT, 1, storeKey(owner), String(expected), String(expected + 1), JSON.stringify(doc)]);
      return Number(result) === 1;
    },
    async remove(owner) {
      await command(["DEL", storeKey(owner)]);
    },
  };
}

/** In-process store with the same semantics, for tests. */
export function memoryStore(): ListStore & { data: Map<string, { v: number; doc: string }> } {
  const data = new Map<string, { v: number; doc: string }>();
  return {
    data,
    async read(owner) {
      const hit = data.get(storeKey(owner));
      return hit ? { version: hit.v, doc: JSON.parse(hit.doc) } : null;
    },
    async write(owner, expected, doc) {
      const key = storeKey(owner);
      if ((data.get(key)?.v ?? 0) !== expected) return false;
      data.set(key, { v: expected + 1, doc: JSON.stringify(doc) });
      return true;
    },
    async remove(owner) {
      data.delete(storeKey(owner));
    },
  };
}

/**
 * The configured store, or undefined when account lists are off. Accepts the variable names the Vercel
 * Marketplace integration sets (KV_REST_API_*) and Upstash's own (UPSTASH_REDIS_REST_*). Plain http is
 * allowed only for a database on this machine.
 */
export function configuredStore(env: Record<string, string | undefined> = process.env): ListStore | undefined {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (!url || !token) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const local = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) return undefined;
  return upstashStore(url, token);
}
