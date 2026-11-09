import "server-only";

/**
 * Minimal GitHub OAuth (authorization-code flow) — no auth library needed.
 * We only ask for the user's email addresses, check them against
 * AUTH_ALLOWED_EMAILS on the server, then discard the GitHub token.
 */
export const OAUTH_COOKIE = "scout_oauth";

export const callbackUrl = (req: Request) => new URL("/api/auth/github/callback", process.env.APP_URL || req.url).toString();

export function authorizeUrl(req: Request, state: string) {
  const u = new URL("https://github.com/login/oauth/authorize");
  u.searchParams.set("client_id", process.env.GITHUB_CLIENT_ID ?? "");
  u.searchParams.set("redirect_uri", callbackUrl(req));
  u.searchParams.set("scope", "user:email");
  u.searchParams.set("state", state);
  u.searchParams.set("allow_signup", "true"); // lets someone without a GitHub account create one mid-flow
  return u.toString();
}

export async function exchangeCode(req: Request, code: string): Promise<string> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: callbackUrl(req),
    }),
    signal: AbortSignal.timeout(10000),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!res.ok || !body.access_token) throw new Error(`GitHub token exchange failed: ${body.error ?? res.status}`);
  return body.access_token;
}

/** Verified email addresses on the GitHub account, lower-cased. */
export async function verifiedEmails(token: string): Promise<string[]> {
  const res = await fetch("https://api.github.com/user/emails", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "stock-scout",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`GitHub emails ${res.status}`);
  const list = (await res.json()) as { email: string; verified: boolean; primary: boolean }[];
  return list
    .filter((e) => e.verified)
    .sort((a, b) => Number(b.primary) - Number(a.primary))
    .map((e) => e.email.toLowerCase());
}
