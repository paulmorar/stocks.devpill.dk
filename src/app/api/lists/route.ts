import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { authMode, ownerId, parseAllowlist, parseUsers, SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { demoMode } from "@/lib/data";
import { defaultDoc, parseOp } from "@/lib/lists/model";
import { ConflictError, deleteLists, loadLists, updateLists } from "@/lib/lists/service";
import { configuredStore, type ListStore, StoreError } from "@/lib/lists/store";

/**
 * Lists saved to the signed-in account. When there is no list database, no login, or demo data,
 * GET says so and the browser keeps lists locally, as before.
 */
export const dynamic = "force-dynamic";

const MAX_BODY = 200_000;

const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

type Context = { ok: true; store: ListStore; owner: string; account: string } | { ok: false; disabled?: string; res: Response };

async function context(): Promise<Context> {
  const off = (reason: string): Context => ({ ok: false, disabled: reason, res: reply({ status: "disabled", reason }) });
  if (demoMode()) return off("demo");
  if (authMode() !== "on") return off("no-login");
  const store = configuredStore();
  if (!store) return off("not-configured");
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value, process.env.AUTH_SECRET ?? "", parseUsers(), parseAllowlist());
  if (!session) return { ok: false, res: reply({ error: "Not signed in" }, 401) };
  return { ok: true, store, owner: ownerId(session), account: session.u };
}

/** Changes must come from this site's own pages. The session cookie is SameSite=Lax; this is a second check. */
function sameSite(req: Request) {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
  } catch {
    return false;
  }
}

function failure(e: unknown, action: string) {
  if (e instanceof ConflictError) return reply({ error: e.message }, 409);
  const message = e instanceof StoreError ? e.message : "Something went wrong.";
  console.error(`Lists: ${action} failed:`, (e as Error)?.message ?? e);
  return reply({ error: `${message} ${action === "load" ? "Your saved lists couldn't load." : "Your change was not saved."}` }, 503);
}

async function writable(req: Request): Promise<Context> {
  if (!sameSite(req)) return { ok: false, res: reply({ error: "Refused: the request didn't come from this site." }, 403) };
  const ctx = await context();
  if (!ctx.ok && ctx.disabled) return { ok: false, res: reply({ error: "Saving lists to an account isn't set up here." }, 403) };
  return ctx;
}

export async function GET() {
  const ctx = await context();
  if (!ctx.ok) return ctx.res;
  try {
    const { doc, stored } = await loadLists(ctx.store, ctx.owner);
    return reply({ status: "ok", doc, stored, account: ctx.account });
  } catch (e) {
    return failure(e, "load");
  }
}

export async function POST(req: Request) {
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) return reply({ error: "Send JSON." }, 415);
  const ctx = await writable(req);
  if (!ctx.ok) return ctx.res;
  const text = await req.text();
  if (text.length > MAX_BODY) return reply({ error: "That change is too large." }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return reply({ error: "Malformed request." }, 400);
  }
  const op = parseOp(body);
  if (!op) return reply({ error: "Malformed request." }, 400);
  try {
    const r = await updateLists(ctx.store, ctx.owner, op);
    if (!r.ok) return reply({ error: r.error }, r.status);
    return reply({ status: "ok", doc: r.doc, stored: r.stored, account: ctx.account, listId: r.listId });
  } catch (e) {
    return failure(e, "save");
  }
}

/** Deletes everything saved for this account. Lists in the browser are not touched. */
export async function DELETE(req: Request) {
  const ctx = await writable(req);
  if (!ctx.ok) return ctx.res;
  try {
    await deleteLists(ctx.store, ctx.owner);
    return reply({ status: "ok", doc: defaultDoc(), stored: false, account: ctx.account });
  } catch (e) {
    return failure(e, "delete");
  }
}
