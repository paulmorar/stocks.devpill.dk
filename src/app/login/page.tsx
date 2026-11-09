import { redirect } from "next/navigation";
import { authMode, githubConfigured, parseUsers, safeNext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  invalid: "That username and password don't match.",
  locked: "Too many attempts. Wait 15 minutes and try again.",
  notallowed: "That GitHub account isn't on the list for this app. Ask Paul to add your email.",
  github: "GitHub sign-in didn't complete. Try again.",
  state: "The sign-in link expired. Try again.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  if (authMode() === "off") redirect("/");
  const next = safeNext(sp.next);
  const error = sp.error ? MESSAGES[sp.error] ?? "Couldn't sign you in." : undefined;
  const github = githubConfigured();
  const passwords = parseUsers().size > 0;

  return (
    <div style={{ maxWidth: 380, margin: "48px auto" }}>
      <div className="panel">
        <div style={{ fontSize: 34, textAlign: "center" }} aria-hidden>
          🚀
        </div>
        <h1 style={{ textAlign: "center" }}>Stock Scout</h1>
        <p className="muted small" style={{ textAlign: "center" }}>
          Private app. Sign in to continue.
        </p>
        {sp.out && !error && <div className="banner info small" style={{ marginBottom: 12 }}>You&apos;re signed out.</div>}
        {error && (
          <div className="banner risk small" role="alert" style={{ marginBottom: 12 }}>
            {error}
          </div>
        )}
        {github && (
          <a className="btn primary" href={`/api/auth/github${next === "/" ? "" : `?next=${encodeURIComponent(next)}`}`} style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, padding: "10px 12px", textDecoration: "none" }}>
            <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            Sign in with GitHub
          </a>
        )}
        {github && passwords && (
          <div className="tiny faint" style={{ textAlign: "center", margin: "12px 0 4px" }}>or use a password</div>
        )}
        {passwords && (
        <form method="post" action="/api/auth/login" style={{ display: "grid", gap: 10 }}>
          <input type="hidden" name="next" value={next} />
          <label className="small">
            Username
            <input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required autoFocus style={{ width: "100%", marginTop: 4 }} />
          </label>
          <label className="small">
            Password
            <input name="password" type="password" autoComplete="current-password" required style={{ width: "100%", marginTop: 4 }} />
          </label>
          <button className={`btn ${github ? "" : "primary"}`} type="submit" style={{ marginTop: 6, padding: "10px 12px" }}>
            Sign in
          </button>
        </form>
        )}
        <p className="tiny faint" style={{ marginTop: 12, marginBottom: 0, textAlign: "center" }}>
          You&apos;ll stay signed in on this device for 30 days.
        </p>
      </div>
    </div>
  );
}
