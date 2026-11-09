import { NextResponse } from "next/server";

export const SYMBOL_RE = /^[A-Z0-9.\-^=]{1,15}$/;

export function cleanSymbol(raw: string | null | undefined) {
  const s = decodeURIComponent(raw ?? "").trim().toUpperCase();
  return SYMBOL_RE.test(s) ? s : undefined;
}

/**
 * JSON for signed-in users only, so it must never sit in a shared (CDN) cache:
 * `private` keeps it in the viewer's browser. Repeat work is still avoided by
 * the server-side cache in lib/data/cache.ts.
 */
export function json(body: unknown, maxAge: number) {
  return NextResponse.json(body, {
    headers: { "Cache-Control": `private, max-age=${Math.min(maxAge, 300)}` },
  });
}

export function fail(err: unknown, status = 502) {
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}
