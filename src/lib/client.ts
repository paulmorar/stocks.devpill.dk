"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Snapshot } from "./snapshot";

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (res.status === 401 && typeof window !== "undefined") {
    // Session expired or revoked: back to the login page, then return here.
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    throw new Error("Signed out");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

export const reportUrl = (s: string) => `/api/score/${encodeURIComponent(s)}`;
export const shortUrl = (s: string) => `/api/short/${encodeURIComponent(s)}`;

/* ── Data cache ──
   Answers stay in memory while the app is open, and in the browser's Cache Storage between visits. Not in
   localStorage: a score is about 45 KB, and a full localStorage would stop the saved lists from saving. Pages show
   the last answer at once and ask the server again in the background when it is older than its rule allows. */

const MIN = 60_000;
export interface CacheRule {
  /** Up to this age an answer is used as it is. */
  fresh: number;
  /** Up to this age an answer is shown while a newer one loads. Older answers are not shown. */
  keep: number;
}
/** Scores, the weekly ranking, screens, filings and news. The server keeps company data for up to 12 hours anyway. */
export const LONG_TERM: CacheRule = { fresh: 15 * MIN, keep: 7 * 24 * 60 * MIN };
/** Day-trading quotes and lists move by the minute; an old quote would mislead. */
export const DAY_TRADING: CacheRule = { fresh: MIN, keep: 30 * MIN };

type Entry = { value: unknown; at: number; restored?: boolean };
const memory = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();
const MEMORY_MAX = 300;
const PREFIX = "scout-data-";
// One store per build, so code never reads an answer in an older shape. next.config.ts sets the build ID.
const STORE = `${PREFIX}${process.env.NEXT_PUBLIC_BUILD_ID ?? "dev"}`;
const SAVED_AT = "x-scout-saved-at";

function remember(url: string, e: Entry) {
  memory.delete(url);
  memory.set(url, e);
  if (memory.size > MEMORY_MAX) memory.delete(memory.keys().next().value as string);
}

function fromMemory<T>(url: string | undefined, rule: CacheRule) {
  const e = url ? memory.get(url) : undefined;
  return e && Date.now() - e.at <= rule.keep ? (e.value as T) : undefined;
}

async function openStore() {
  try {
    return typeof caches === "undefined" ? undefined : await caches.open(STORE);
  } catch {
    return undefined; // Private browsing or an insecure origin: memory only.
  }
}

let pruned = false;
/** Once per visit: drop answers older than any rule keeps them, and the stores of earlier builds. */
async function prune(store: Cache) {
  if (pruned) return;
  pruned = true;
  try {
    for (const name of await caches.keys()) if (name.startsWith(PREFIX) && name !== STORE) await caches.delete(name);
    const cutoff = Date.now() - LONG_TERM.keep;
    for (const req of await store.keys()) {
      if (!(Number((await store.match(req))?.headers.get(SAVED_AT)) >= cutoff)) await store.delete(req);
    }
  } catch {}
}

/**
 * The last answer for a URL, from memory or else from an earlier visit. `stale` means it should be checked with the
 * server: it is older than the rule's `fresh`, or it comes from an earlier visit. Undefined when there is none or it
 * is older than the rule's `keep`.
 */
export async function readCache<T>(url: string, rule: CacheRule): Promise<{ value: T; stale: boolean } | undefined> {
  let e = memory.get(url);
  if (!e) {
    let saved: Entry | undefined;
    try {
      const res = await (await openStore())?.match(url);
      if (res) saved = { value: await res.json(), at: Number(res.headers.get(SAVED_AT)), restored: true };
    } catch {}
    // An answer that arrived from the server meanwhile is newer.
    e = memory.get(url) ?? saved;
    if (e && e === saved) remember(url, e);
  }
  const age = e ? Date.now() - e.at : NaN;
  return e && age <= rule.keep ? { value: e.value as T, stale: !!e.restored || age > rule.fresh } : undefined;
}

let signedOut = false;
async function save(url: string, value: unknown, at: number) {
  const store = await openStore();
  if (!store || signedOut) return;
  try {
    await store.put(url, new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json", [SAVED_AT]: String(at) } }));
  } catch {} // Quota or a closed store: memory still has it.
  void prune(store);
}

/** Asks the server, with one request per URL at a time, and caches the answer. */
export function fetchCached<T>(url: string): Promise<T> {
  let p = inflight.get(url) as Promise<T> | undefined;
  if (!p) {
    p = fetchJson<T>(url)
      .then((value) => {
        const at = Date.now();
        remember(url, { value, at });
        void save(url, value, at);
        return value;
      })
      .finally(() => inflight.delete(url));
    inflight.set(url, p);
  }
  return p;
}

/** Forgets every cached answer in this browser, and stops saving new ones (on sign-out). */
export async function clearClientCache() {
  signedOut = true;
  memory.clear();
  try {
    if (typeof caches !== "undefined") for (const name of await caches.keys()) if (name.startsWith(PREFIX)) await caches.delete(name);
  } catch {}
}

type Loaded<T> = { url?: string; data?: T; error?: string; updating?: boolean };

/**
 * One URL: the cached answer at once, then the server's when the cached one is stale or missing. `updating` is true
 * while a shown answer is being refreshed. A changed `refreshKey` asks the server again. Without a URL, nothing loads.
 */
export function useCached<T>(url: string | undefined, rule: CacheRule, refreshKey = 0) {
  const [s, setS] = useState<Loaded<T>>({});
  const seen = useRef(refreshKey);
  useEffect(() => {
    if (!url) return;
    let current = true;
    const force = seen.current !== refreshKey;
    seen.current = refreshKey;
    void (async () => {
      const hit = await readCache<T>(url, rule);
      if (!current) return;
      if (hit) setS({ url, data: hit.value, updating: hit.stale || force });
      if (hit && !hit.stale && !force) return;
      try {
        const data = await fetchCached<T>(url);
        if (current) setS({ url, data });
      } catch (e) {
        // A failed refresh keeps the cached answer on screen.
        if (current) setS({ url, data: hit?.value, error: (e as Error).message });
      }
    })();
    // A slower answer for a URL shown earlier must not replace this one.
    return () => {
      current = false;
    };
  }, [url, rule, refreshKey]);
  // Data already in memory renders in the first frame, for example when going back to a page.
  if (s.url !== url) return { data: fromMemory<T>(url, rule), error: undefined, updating: false };
  return { data: s.data, error: s.error, updating: !!s.updating };
}

/**
 * Many symbols: cached answers at once, then the missing and stale ones from the server, `concurrency` at a time.
 * `pending` counts symbols with nothing to show yet, `updating` the shown ones being refreshed.
 */
export function useMany<T>(symbols: string[], urlOf: (s: string) => string, rule: CacheRule, concurrency = 3, refreshKey = 0) {
  const [data, setData] = useState<Record<string, T>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(0);
  const [updating, setUpdating] = useState(0);
  const key = symbols.join(",");
  const urlRef = useRef(urlOf);
  urlRef.current = urlOf;
  const seen = useRef(refreshKey);

  useEffect(() => {
    let cancelled = false;
    const force = seen.current !== refreshKey;
    seen.current = refreshKey;
    const list = [...new Set(symbols)];
    const started = Date.now();
    void (async () => {
      const hits = await Promise.all(list.map((s) => readCache<T>(urlRef.current(s), rule)));
      if (cancelled) return;
      const shown = new Set(list.filter((_, i) => hits[i]));
      setData((d) => ({ ...d, ...Object.fromEntries(list.flatMap((s, i) => (hits[i] ? [[s, hits[i]!.value]] : []))) }));
      const queue = list.filter((_, i) => force || !hits[i] || hits[i]!.stale);
      setPending(queue.filter((s) => !shown.has(s)).length);
      setUpdating(queue.filter((s) => shown.has(s)).length);
      const worker = async () => {
        while (queue.length && !cancelled) {
          const s = queue.shift() as string;
          const url = urlRef.current(s);
          const count = shown.has(s) ? setUpdating : setPending;
          try {
            // Another part of the page may have fetched it since this run started, such as an open detail panel.
            const recent = memory.get(url);
            const v = recent && recent.at >= started ? (recent.value as T) : await fetchCached<T>(url);
            if (cancelled) return;
            setData((d) => ({ ...d, [s]: v }));
            setErrors((er) => (s in er ? Object.fromEntries(Object.entries(er).filter(([k]) => k !== s)) : er));
          } catch (e) {
            // A failed refresh keeps the cached answer on screen.
            if (!cancelled && !shown.has(s)) setErrors((er) => ({ ...er, [s]: (e as Error).message }));
          } finally {
            if (!cancelled) count((n) => n - 1);
          }
        }
      };
      for (let i = 0; i < Math.min(concurrency, queue.length); i++) void worker();
    })();
    return () => {
      cancelled = true;
    };
  }, [key, concurrency, refreshKey, rule]); // eslint-disable-line react-hooks/exhaustive-deps

  // Symbols already in memory render in the first frame, for example after switching back to a tab.
  const view = useMemo(() => {
    const out = { ...data };
    for (const s of symbols) if (!(s in out)) {
      const v = fromMemory<T>(urlRef.current(s), rule);
      if (v !== undefined) out[s] = v;
    }
    return out;
  }, [data, key, rule]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data: view, errors, pending, updating };
}

/* ── Local storage: recently viewed stocks and "last seen" scores (for the weekly-change arrow) ──
   Watchlist, portfolio and named lists live in components/lists.tsx. */

function readLS<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeLS(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {}
}

const LIST_EVENT = "scout:lists";

function useSymbolList(key: string, defaults: string[]) {
  const [list, setList] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const latest = useRef<string[]>([]);
  useEffect(() => {
    const load = () => {
      latest.current = readLS(key, defaults);
      setList(latest.current);
    };
    load();
    setReady(true);
    // The header search, the stock page and other tabs edit the same lists.
    const onChange = (e: Event) => {
      if ((e instanceof StorageEvent ? e.key : (e as CustomEvent<string>).detail) === key) load();
    };
    window.addEventListener(LIST_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(LIST_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  // Read-modify-write against storage (or the last known list if storage is unavailable), never a stale render.
  const update = (fn: (current: string[]) => string[]) => {
    const next = [...new Set(fn(readLS(key, latest.current)).map((x) => x.toUpperCase()))];
    latest.current = next;
    setList(next);
    writeLS(key, next);
    window.dispatchEvent(new CustomEvent(LIST_EVENT, { detail: key }));
  };
  return {
    list,
    ready,
    has: (s: string) => list.includes(s),
    add: (s: string) => update((l) => (l.includes(s) ? l : [...l, s])),
    remove: (s: string) => update((l) => l.filter((x) => x !== s)),
    replace: (l: string[]) => update(() => l),
    update,
  };
}

/** Stock pages opened recently in this browser, newest first. Never sent to the server. */
export const useRecent = () => useSymbolList("scout:recent", []);

/* ── Weekly snapshot ── */

export function useSnapshot() {
  const { data: snap, error, updating } = useCached<Snapshot>("/api/radar", LONG_TERM);
  return { snap, error, updating };
}

/**
 * Remembers each score the first time it's seen in a given week, so cards can
 * show "change since last week" like the TTT weekly post.
 */
export function scoreDelta(symbol: string, score: number): number | undefined {
  const all = readLS<Record<string, { week: string; score: number; prev?: number }>>("scout:seen", {});
  const now = new Date();
  const week = `${now.getUTCFullYear()}-${Math.floor((now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 1)) / (7 * 86400000))}`;
  const e = all[symbol];
  if (!e) {
    all[symbol] = { week, score };
    writeLS("scout:seen", all);
    return undefined;
  }
  if (e.week !== week) {
    all[symbol] = { week, score, prev: e.score };
    writeLS("scout:seen", all);
    return score - e.score;
  }
  return e.prev !== undefined ? score - e.prev : undefined;
}
