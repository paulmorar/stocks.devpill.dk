import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  authMode, fingerprint, GITHUB_SESSION, parseAllowlist, parseUsers, safeNext, signSession, verifySession,
} from "@/lib/auth/session";

const SECRET = "x".repeat(40);

describe("passwords", () => {
  it("hashes and verifies; rejects wrong password and unknown users", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h).toMatch(/^scrypt\.[\w-]+\.[\w-]+$/);
    expect(h).not.toContain("$"); // dotenv would expand it
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
    expect(await verifyPassword("anything", undefined)).toBe(false);
  });
});

describe("sessions", () => {
  it("round-trips a password session and rejects tampering, expiry and revoked users", async () => {
    const h = await hashPassword("pw-for-anna-123");
    const users = parseUsers(`anna:${h}`);
    const s = { u: "anna", v: fingerprint(h), exp: Date.now() + 60_000 };
    const tok = await signSession(s, SECRET);
    expect((await verifySession(tok, SECRET, users))?.u).toBe("anna");
    expect(await verifySession(tok.slice(0, -2) + "xx", SECRET, users)).toBeUndefined();
    expect(await verifySession(tok, "y".repeat(40), users)).toBeUndefined();
    expect(await verifySession(tok, SECRET, users, new Set(), Date.now() + 120_000)).toBeUndefined();
    expect(await verifySession(tok, SECRET, new Map())).toBeUndefined(); // user removed
    const newHash = await hashPassword("new password!!");
    expect(await verifySession(tok, SECRET, parseUsers(`anna:${newHash}`))).toBeUndefined(); // password changed
  });

  it("GitHub sessions stay valid only while the email is on the allowlist", async () => {
    const tok = await signSession({ u: "paul@example.com", v: GITHUB_SESSION, exp: Date.now() + 60_000 }, SECRET);
    expect((await verifySession(tok, SECRET, new Map(), parseAllowlist("Paul@Example.com, anna@example.com")))?.u).toBe("paul@example.com");
    expect(await verifySession(tok, SECRET, new Map(), parseAllowlist("anna@example.com"))).toBeUndefined();
  });

  it("a GitHub session can't impersonate a password user and vice versa", async () => {
    const h = await hashPassword("pw-for-anna-123");
    const tok = await signSession({ u: "anna", v: GITHUB_SESSION, exp: Date.now() + 60_000 }, SECRET);
    expect(await verifySession(tok, SECRET, parseUsers(`anna:${h}`), parseAllowlist("x@y.z"))).toBeUndefined();
  });
});

describe("config", () => {
  it("parses allowlists with commas, spaces and newlines", () => {
    expect([...parseAllowlist("a@x.com, B@x.com\nc@x.com;notanemail")]).toEqual(["a@x.com", "b@x.com", "c@x.com"]);
  });
  it("fails closed in production when unconfigured, stays open in dev", () => {
    expect(authMode({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe("misconfigured");
    expect(authMode({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe("off");
    expect(authMode({ NODE_ENV: "production", AUTH_DISABLED: "1" } as NodeJS.ProcessEnv)).toBe("off");
    expect(
      authMode({ NODE_ENV: "production", AUTH_SECRET: SECRET, GITHUB_CLIENT_ID: "i", GITHUB_CLIENT_SECRET: "s", AUTH_ALLOWED_EMAILS: "a@b.c" } as NodeJS.ProcessEnv),
    ).toBe("on");
    expect(authMode({ NODE_ENV: "production", AUTH_SECRET: "short", AUTH_ALLOWED_EMAILS: "a@b.c", GITHUB_CLIENT_ID: "i", GITHUB_CLIENT_SECRET: "s" } as NodeJS.ProcessEnv)).toBe("misconfigured");
  });
  it("only redirects to same-site paths after login", () => {
    expect(safeNext("/stock/AAPL")).toBe("/stock/AAPL");
    for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com", "/login", "/api/auth/logout", undefined]) expect(safeNext(bad)).toBe("/");
  });
});
