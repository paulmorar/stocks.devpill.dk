/**
 * Tiny in-memory TTL cache with in-flight de-duplication.
 * On Vercel each warm function instance keeps its own copy; the API routes also
 * send CDN cache headers, so most repeat requests never reach this code at all.
 */
type Entry = { value: unknown; expires: number };

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();
const MAX_ENTRIES = 2000;

export async function cached<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;

  const running = inflight.get(key);
  if (running) return running as Promise<T>;

  const p = load()
    .then((value) => {
      if (store.size >= MAX_ENTRIES) {
        const oldest = store.keys().next().value;
        if (oldest !== undefined) store.delete(oldest);
      }
      store.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export const TTL = {
  fundamentals: 60 * 60 * 12, // statements change after earnings only
  prices: 60 * 15,
  intraday: 60,
  screener: 60 * 5,
} as const;
