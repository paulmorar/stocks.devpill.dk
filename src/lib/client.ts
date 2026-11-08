"use client";

import { useEffect, useRef, useState } from "react";
import type { LongTermReport } from "./analyze";
import type { ShortTermResult } from "./shortterm";

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

export const getReport = (s: string) => fetchJson<LongTermReport>(`/api/score/${encodeURIComponent(s)}`);
export const getShort = (s: string) => fetchJson<ShortTermResult>(`/api/short/${encodeURIComponent(s)}`);

/** Load many symbols with limited concurrency, streaming results in as they arrive. */
export function useMany<T>(symbols: string[], load: (s: string) => Promise<T>, concurrency = 3, refreshKey = 0) {
  const [data, setData] = useState<Record<string, T>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(0);
  const key = symbols.join(",");
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let cancelled = false;
    const queue = [...new Set(symbols)];
    setPending(queue.length);
    const worker = async () => {
      while (queue.length && !cancelled) {
        const s = queue.shift() as string;
        try {
          const v = await loadRef.current(s);
          if (!cancelled) setData((d) => ({ ...d, [s]: v }));
        } catch (e) {
          if (!cancelled) setErrors((er) => ({ ...er, [s]: (e as Error).message }));
        } finally {
          if (!cancelled) setPending((p) => p - 1);
        }
      }
    };
    Array.from({ length: Math.min(concurrency, queue.length) }, worker);
    return () => {
      cancelled = true;
    };
  }, [key, concurrency, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, errors, pending };
}

/* ── Local storage: watchlist and "last seen" scores (for the weekly-change arrow) ── */

const DEFAULT_WATCHLIST = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "V", "JPM", "COST", "NOVO-B.CO"];

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

export function useWatchlist() {
  const [list, setList] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setList(readLS("scout:watchlist", DEFAULT_WATCHLIST));
    setReady(true);
  }, []);
  const save = (l: string[]) => {
    setList(l);
    writeLS("scout:watchlist", l);
  };
  return {
    list,
    ready,
    has: (s: string) => list.includes(s),
    add: (s: string) => !list.includes(s) && save([...list, s]),
    remove: (s: string) => save(list.filter((x) => x !== s)),
  };
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
