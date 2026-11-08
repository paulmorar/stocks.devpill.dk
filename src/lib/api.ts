import { NextResponse } from "next/server";

export const SYMBOL_RE = /^[A-Z0-9.\-^=]{1,15}$/;

export function cleanSymbol(raw: string | null | undefined) {
  const s = decodeURIComponent(raw ?? "").trim().toUpperCase();
  return SYMBOL_RE.test(s) ? s : undefined;
}

/** JSON with CDN caching: browsers revalidate, Vercel's edge serves stale while refreshing. */
export function json(body: unknown, sMaxAge: number) {
  return NextResponse.json(body, {
    headers: { "Cache-Control": `public, max-age=0, s-maxage=${sMaxAge}, stale-while-revalidate=${sMaxAge * 4}` },
  });
}

export function fail(err: unknown, status = 502) {
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}
