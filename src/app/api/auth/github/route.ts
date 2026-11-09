import { NextResponse } from "next/server";
import { authorizeUrl, OAUTH_COOKIE } from "@/lib/auth/github";
import { githubConfigured, safeNext } from "@/lib/auth/session";

/** Start GitHub sign-in: remember a random state (CSRF protection) and where to go afterwards. */
export async function GET(req: Request) {
  if (!githubConfigured()) return NextResponse.redirect(new URL("/login?error=github", req.url), 303);
  const state = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  const next = safeNext(new URL(req.url).searchParams.get("next"));
  const res = NextResponse.redirect(authorizeUrl(req, state), 303);
  res.cookies.set(OAUTH_COOKIE, `${state}|${next}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/github",
    maxAge: 600,
  });
  return res;
}
