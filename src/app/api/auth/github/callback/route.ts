import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode, OAUTH_COOKIE, verifiedEmails } from "@/lib/auth/github";
import { GITHUB_SESSION, parseAllowlist, safeNext, SESSION_COOKIE, SESSION_DAYS, signSession } from "@/lib/auth/session";

function fail(req: NextRequest, error: string) {
  const res = NextResponse.redirect(new URL(`/login?error=${error}`, req.url), 303);
  res.cookies.set(OAUTH_COOKIE, "", { path: "/api/auth/github", maxAge: 0 });
  return res;
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const [savedState = "", savedNext] = (req.cookies.get(OAUTH_COOKIE)?.value ?? "").split("|");
  const state = params.get("state") ?? "";
  const code = params.get("code");
  if (params.get("error")) return fail(req, "github"); // user pressed Cancel on GitHub
  if (!code || !savedState || state.length !== savedState.length || !timingSafeEqual(Buffer.from(state), Buffer.from(savedState))) {
    return fail(req, "state");
  }

  let emails: string[];
  try {
    emails = await verifiedEmails(await exchangeCode(req, code));
  } catch (e) {
    console.error("GitHub sign-in failed:", (e as Error).message);
    return fail(req, "github");
  }

  // The allowlist lives in a Vercel env var and is evaluated here, on the server.
  const allow = parseAllowlist();
  const email = emails.find((e) => allow.has(e));
  if (!email) {
    console.warn(`GitHub sign-in refused: no allowlisted verified email (${emails.length} checked).`);
    return fail(req, "notallowed");
  }

  const token = await signSession({ u: email, v: GITHUB_SESSION, exp: Date.now() + SESSION_DAYS * 86400000 }, process.env.AUTH_SECRET as string);
  const res = NextResponse.redirect(new URL(safeNext(savedNext), req.url), 303);
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
  res.cookies.set(OAUTH_COOKIE, "", { path: "/api/auth/github", maxAge: 0 });
  return res;
}
