import { NextResponse } from "next/server";
import { verifyPassword } from "@/lib/auth/password";
import { authMode, fingerprint, parseUsers, safeNext, SESSION_COOKIE, SESSION_DAYS, signSession } from "@/lib/auth/session";

/**
 * Plain form POST (works without JavaScript). Failed attempts are slowed by
 * scrypt itself and capped per IP; the cap is per server instance, so also
 * add a Vercel WAF rate-limit rule on this path (see README).
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 8;
const fails = new Map<string, { n: number; first: number }>();

function back(req: Request, params: Record<string, string>) {
  const url = new URL("/login", req.url);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  return NextResponse.redirect(url, 303);
}

export async function POST(req: Request) {
  if (authMode() !== "on") return NextResponse.redirect(new URL("/", req.url), 303);
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "unknown";
  const now = Date.now();
  const rec = fails.get(ip);
  if (rec && now - rec.first < WINDOW_MS && rec.n >= MAX_FAILS) return back(req, { error: "locked" });

  const form = await req.formData().catch(() => undefined);
  const username = String(form?.get("username") ?? "").trim().toLowerCase().slice(0, 64);
  const password = String(form?.get("password") ?? "").slice(0, 256);
  const next = safeNext(String(form?.get("next") ?? "/"));

  const stored = parseUsers().get(username);
  const ok = !!password && (await verifyPassword(password, stored));
  if (!ok || !stored) {
    const r = rec && now - rec.first < WINDOW_MS ? rec : { n: 0, first: now };
    r.n++;
    fails.set(ip, r);
    if (fails.size > 5000) fails.clear();
    return back(req, { error: "invalid", next: next === "/" ? "" : next });
  }
  fails.delete(ip);

  const token = await signSession({ u: username, v: fingerprint(stored), exp: now + SESSION_DAYS * 86400000 }, process.env.AUTH_SECRET as string);
  const res = NextResponse.redirect(new URL(next, req.url), 303);
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
  return res;
}
