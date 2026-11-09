import { NextResponse, type NextRequest } from "next/server";
import { authMode, parseAllowlist, parseUsers, SESSION_COOKIE, verifySession } from "@/lib/auth/session";

/**
 * Login gate in front of every page and API route. Runs before routing (and
 * before anything is served from cache), so strangers can't reach the app or
 * trigger Yahoo/FMP calls. Static build assets are excluded by the matcher.
 */
const PUBLIC = new Set(["/login", "/api/auth/login", "/api/auth/github", "/api/auth/github/callback"]);

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const mode = authMode();
  if (mode === "off" || PUBLIC.has(pathname)) return NextResponse.next();

  const isApi = pathname.startsWith("/api/");
  if (mode === "misconfigured") {
    const msg = "Login isn't configured: set AUTH_SECRET plus GitHub SSO (GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, AUTH_ALLOWED_EMAILS) and/or AUTH_USERS in the Vercel project settings.";
    return isApi
      ? NextResponse.json({ error: msg }, { status: 503 })
      : new NextResponse(msg, { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value, process.env.AUTH_SECRET ?? "", parseUsers(), parseAllowlist());
  if (session) return NextResponse.next();

  if (isApi) return NextResponse.json({ error: "Not signed in" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icon.svg|favicon.ico|robots.txt).*)"],
};
