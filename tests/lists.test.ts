import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GITHUB_SESSION, ownerId, signSession } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import {
  applyOp, blankDoc, DEFAULT_WATCHLIST, defaultDoc, exportFile, type ListOp, type ListsDoc, MAX_NAMED_LISTS, MAX_SYMBOLS,
  normalizeDoc, parseExportFile, parseOp, PORTFOLIO, WATCHLIST,
} from "@/lib/lists/model";
import { ConflictError, loadLists, updateLists } from "@/lib/lists/service";
import { CAS_SCRIPT, configuredStore, type ListStore, memoryStore, storeKey, StoreError, upstashStore } from "@/lib/lists/store";

vi.mock("server-only", () => ({}));
const session = vi.hoisted(() => ({ cookie: undefined as string | undefined }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (session.cookie ? { value: session.cookie } : undefined) }) }));

let n = 0;
const ctx = () => ({ now: "2026-11-24T12:00:00.000Z", newId: () => `l_${++n}` });
function run(doc: ListsDoc, op: ListOp) {
  const r = applyOp(doc, op, ctx());
  if (!r.ok) throw new Error(r.error);
  return r;
}
const symbols = (doc: ListsDoc, id: string) => doc.lists.find((l) => l.id === id)?.symbols;
const named = (doc: ListsDoc) => doc.lists.filter((l) => l.kind === "custom");

describe("list rules", () => {
  it("adds and removes once, and rejects bad tickers and unknown lists without changing anything", () => {
    const a = run(blankDoc(), { op: "add", list: WATCHLIST, symbol: " brk-b " });
    expect(symbols(a.doc, WATCHLIST)).toEqual(["BRK-B"]);
    expect(run(a.doc, { op: "add", list: WATCHLIST, symbol: "BRK-B" }).changed).toBe(false);
    expect(run(a.doc, { op: "remove", list: WATCHLIST, symbol: "AAPL" }).changed).toBe(false);
    expect(symbols(run(a.doc, { op: "remove", list: WATCHLIST, symbol: "brk-b" }).doc, WATCHLIST)).toEqual([]);
    expect(applyOp(a.doc, { op: "add", list: WATCHLIST, symbol: "<b>" }, ctx())).toMatchObject({ ok: false, status: 400 });
    expect(applyOp(a.doc, { op: "add", list: "l_gone", symbol: "AAPL" }, ctx())).toMatchObject({ ok: false, status: 404 });
  });

  it("keeps names unique, protects built-in lists, and treats a repeated delete as done", () => {
    const c = run(blankDoc(), { op: "create", name: "  Quality   at a fair price ", symbols: ["aapl", "AAPL", "msft"] });
    const list = named(c.doc)[0]!;
    expect(list).toMatchObject({ id: c.listId, name: "Quality at a fair price", symbols: ["AAPL", "MSFT"] });
    expect(applyOp(c.doc, { op: "create", name: "quality AT a fair price" }, ctx())).toMatchObject({ ok: false, status: 400 });
    expect(applyOp(c.doc, { op: "create", name: "watchlist" }, ctx())).toMatchObject({ ok: false });
    expect(applyOp(c.doc, { op: "create", name: "x".repeat(61) }, ctx())).toMatchObject({ ok: false });
    expect(applyOp(c.doc, { op: "rename", list: WATCHLIST, name: "Mine" }, ctx())).toMatchObject({ ok: false, status: 400 });
    expect(applyOp(c.doc, { op: "delete", list: PORTFOLIO }, ctx())).toMatchObject({ ok: false, status: 400 });
    const renamed = run(c.doc, { op: "rename", list: list.id, name: "Compounders" });
    expect(named(renamed.doc)[0]!.name).toBe("Compounders");
    const deleted = run(renamed.doc, { op: "delete", list: list.id });
    expect(named(deleted.doc)).toEqual([]);
    expect(run(deleted.doc, { op: "delete", list: list.id }).changed).toBe(false);
  });

  it("refuses to grow past the limits instead of truncating", () => {
    const full = normalizeDoc({ lists: [{ kind: "watchlist", symbols: Array.from({ length: MAX_SYMBOLS }, (_, i) => `S${i}`) }] });
    expect(applyOp(full, { op: "add", list: WATCHLIST, symbol: "AAPL" }, ctx())).toMatchObject({ ok: false, status: 400 });
    let doc = blankDoc();
    for (let i = 0; i < MAX_NAMED_LISTS; i++) doc = run(doc, { op: "create", name: `List ${i}` }).doc;
    expect(applyOp(doc, { op: "create", name: "One more" }, ctx())).toMatchObject({ ok: false });
    // Reading never drops stocks, even past the limit.
    expect(symbols(normalizeDoc({ lists: [{ kind: "portfolio", symbols: Array.from({ length: 600 }, (_, i) => `P${i}`) }] }), PORTFOLIO)).toHaveLength(600);
  });

  it("imports by merging: built-in lists by kind, named lists by name, and a second import changes nothing", () => {
    const start = run(run(defaultDoc(), { op: "create", name: "Dividends", symbols: ["KO"] }).doc, { op: "add", list: PORTFOLIO, symbol: "V" }).doc;
    const op: ListOp = {
      op: "import",
      lists: [
        { kind: "watchlist", name: "Watchlist", symbols: ["AAPL", "ASML"] },
        { kind: "portfolio", name: "My portfolio", symbols: ["V", "MA"] },
        { kind: "custom", name: "dividends", symbols: ["PEP", "KO"] },
        { kind: "custom", name: "Turnarounds", symbols: ["INTC"] },
      ],
    };
    const once = run(start, op);
    expect(symbols(once.doc, WATCHLIST)).toEqual([...DEFAULT_WATCHLIST, "ASML"]);
    expect(symbols(once.doc, PORTFOLIO)).toEqual(["V", "MA"]);
    expect(named(once.doc).map((l) => [l.name, l.symbols])).toEqual([["Dividends", ["KO", "PEP"]], ["Turnarounds", ["INTC"]]]);
    expect(run(once.doc, op).changed).toBe(false);
  });

  it("rejects a whole import when one part is invalid or too large", () => {
    const tooBig = { kind: "portfolio" as const, name: "x", symbols: Array.from({ length: MAX_SYMBOLS + 1 }, (_, i) => `T${i}`) };
    const bad = { kind: "custom" as const, name: "Bad", symbols: ["AAPL", "not a ticker"] };
    for (const lists of [[tooBig], [{ kind: "watchlist" as const, name: "w", symbols: ["MSFT"] }, bad]]) {
      const r = applyOp(blankDoc(), { op: "import", lists }, ctx());
      expect(r).toMatchObject({ ok: false, status: 400 });
      expect((r as { error: string }).error).toContain("Nothing was imported");
    }
  });

  it("checks request shapes and round-trips the export file", () => {
    expect(parseOp({ op: "add", list: WATCHLIST, symbol: "AAPL" })).toEqual({ op: "add", list: WATCHLIST, symbol: "AAPL" });
    for (const bad of [null, "add", { op: "add", list: WATCHLIST }, { op: "drop", list: WATCHLIST }, { op: "import", lists: [{ kind: "x", symbols: [] }] }, { op: "rename", list: 5, name: "x" }]) {
      expect(parseOp(bad)).toBeUndefined();
    }
    const doc = run(defaultDoc(), { op: "create", name: "Ideas", symbols: ["SHOP"] }).doc;
    const file = JSON.parse(JSON.stringify(exportFile(doc, "2026-11-24T12:00:00Z")));
    expect(parseExportFile(file)).toEqual({ lists: [
      { kind: "watchlist", name: "Watchlist", symbols: DEFAULT_WATCHLIST },
      { kind: "portfolio", name: "My portfolio", symbols: [] },
      { kind: "custom", name: "Ideas", symbols: ["SHOP"] },
    ] });
    expect(parseExportFile({ lists: [] })).toEqual({ error: "This file isn't a Stock Scout list export." });
  });

  it("repairs a stored document: built-in lists always exist, duplicates and unusable entries go", () => {
    const doc = normalizeDoc({ lists: [
      { kind: "watchlist", symbols: ["AAPL", "aapl", 7, "bad ticker"] },
      { id: "l_1", name: "Ideas", kind: "custom", symbols: ["SHOP"] },
      { id: "l_1", name: "Duplicate id", kind: "custom", symbols: [] },
      { id: "l_2", name: "", kind: "custom", symbols: [] },
    ] }, 7);
    expect(doc.version).toBe(7);
    expect(doc.lists.map((l) => [l.id, l.symbols])).toEqual([[WATCHLIST, ["AAPL"]], [PORTFOLIO, []], ["l_1", ["SHOP"]]]);
  });
});

describe("account storage", () => {
  const owner = "gh:paul@example.com";

  it("starts a new account like a new browser, but an import or 'start empty' starts from empty lists", async () => {
    const store = memoryStore();
    expect(await loadLists(store, owner)).toEqual({ doc: defaultDoc(), stored: false });
    const added = await updateLists(store, owner, { op: "add", list: PORTFOLIO, symbol: "V" });
    expect(added).toMatchObject({ ok: true, stored: true, doc: { version: 1 } });
    expect(symbols((added as { doc: ListsDoc }).doc, WATCHLIST)).toEqual(DEFAULT_WATCHLIST);

    const other = memoryStore();
    const imported = await updateLists(other, owner, { op: "import", lists: [{ kind: "watchlist", name: "Watchlist", symbols: ["SAP"] }] });
    expect(symbols((imported as { doc: ListsDoc }).doc, WATCHLIST)).toEqual(["SAP"]);
    const empty = memoryStore();
    expect(await updateLists(empty, owner, { op: "import", lists: [] })).toMatchObject({ ok: true, stored: true });
    expect((await loadLists(empty, owner)).doc.lists.every((l) => l.symbols.length === 0)).toBe(true);
  });

  it("keeps both changes when two tabs save at the same moment", async () => {
    const inner = memoryStore();
    await updateLists(inner, owner, { op: "import", lists: [] });
    // Both requests read version 1 before either writes, so one compare-and-set fails and is retried.
    let reads = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const store: ListStore = {
      ...inner,
      async read(o) {
        const hit = await inner.read(o);
        if (++reads === 2) release();
        if (reads <= 2) await gate;
        return hit;
      },
    };
    const write = vi.spyOn(store, "write");
    await Promise.all([
      updateLists(store, owner, { op: "add", list: WATCHLIST, symbol: "AAPL" }),
      updateLists(store, owner, { op: "add", list: WATCHLIST, symbol: "MSFT" }),
    ]);
    const { doc } = await loadLists(inner, owner);
    expect(symbols(doc, WATCHLIST)?.sort()).toEqual(["AAPL", "MSFT"]);
    expect(doc.version).toBe(3);
    expect(write).toHaveBeenCalledTimes(3);
  });

  it("gives up with a conflict after repeated collisions, and skips the write when nothing changes", async () => {
    const store = memoryStore();
    const stuck: ListStore = { ...store, write: async () => false };
    const wait = vi.fn(async () => {});
    await expect(updateLists(stuck, owner, { op: "add", list: WATCHLIST, symbol: "X" }, { wait })).rejects.toBeInstanceOf(ConflictError);
    expect(wait).toHaveBeenCalledTimes(7);
    await updateLists(store, owner, { op: "add", list: WATCHLIST, symbol: "X" });
    const write = vi.spyOn(store, "write");
    expect(await updateLists(store, owner, { op: "add", list: WATCHLIST, symbol: "X" })).toMatchObject({ ok: true, stored: true });
    expect(write).not.toHaveBeenCalled();
  });

  it("keeps accounts apart, and never puts an email address in a key", async () => {
    const store = memoryStore();
    await updateLists(store, ownerId({ u: "anna", v: "fp", exp: 0 }), { op: "add", list: PORTFOLIO, symbol: "V" });
    expect((await loadLists(store, ownerId({ u: "anna", v: GITHUB_SESSION, exp: 0 }))).stored).toBe(false);
    expect(ownerId({ u: "anna", v: GITHUB_SESSION, exp: 0 })).not.toBe(ownerId({ u: "anna", v: "fp", exp: 0 }));
    expect(storeKey(owner)).toMatch(/^scout:lists:v1:[0-9a-f]{64}$/);
  });
});

/** Answers HMGET, EVAL (running the compare-and-set the way the Lua script does) and DEL like Upstash's REST API. */
function fakeUpstash(token = "t0ken") {
  const hashes = new Map<string, Record<string, string>>();
  const calls: unknown[][] = [];
  const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    if ((init?.headers as Record<string, string>)?.Authorization !== `Bearer ${token}`) {
      return new Response(JSON.stringify({ error: "WRONGPASS invalid password" }), { status: 401 });
    }
    const [cmd, ...args] = JSON.parse(String(init?.body)) as string[];
    calls.push([cmd, ...args]);
    const result = (() => {
      if (cmd === "HMGET") return args.slice(1).map((f) => hashes.get(args[0]!)?.[f] ?? null);
      if (cmd === "DEL") return Number(hashes.delete(args[0]!));
      if (cmd === "EVAL") {
        expect(args[0]).toBe(CAS_SCRIPT);
        const [, , key, expected, next, doc] = args.map(String);
        if ((hashes.get(key!)?.v ?? "0") !== expected) return 0;
        hashes.set(key!, { v: next!, doc: doc! });
        return 1;
      }
      throw new Error(`unexpected ${cmd}`);
    })();
    return new Response(JSON.stringify({ result }));
  });
  return { hashes, calls, fetchImpl };
}

describe("Upstash adapter", () => {
  it("speaks the REST API: bearer token, command arrays, compare-and-set through EVAL", async () => {
    const fake = fakeUpstash();
    const store = upstashStore("https://eu1-fake.upstash.io/", "t0ken", fake.fetchImpl as unknown as typeof fetch);
    expect(await store.read("pw:anna")).toBeNull();
    expect(await store.write("pw:anna", 0, { lists: [] })).toBe(true);
    expect(await store.write("pw:anna", 0, { lists: [] })).toBe(false);
    expect(await store.read("pw:anna")).toEqual({ version: 1, doc: { lists: [] } });
    await store.remove("pw:anna");
    expect(await store.read("pw:anna")).toBeNull();
    expect(fake.fetchImpl.mock.calls[0]?.[0]).toBe("https://eu1-fake.upstash.io");
    expect(fake.calls[1]).toEqual(["EVAL", CAS_SCRIPT, 1, storeKey("pw:anna"), "0", "1", '{"lists":[]}']);
  });

  it("reports failures as store errors and never treats unreadable data as empty", async () => {
    const fake = fakeUpstash();
    const wrong = upstashStore("https://x.upstash.io", "nope", fake.fetchImpl as unknown as typeof fetch);
    await expect(wrong.read("pw:anna")).rejects.toThrow(/rejected the credentials/);
    const down = upstashStore("https://x.upstash.io", "t", (async () => { throw new TypeError("fetch failed"); }) as typeof fetch);
    await expect(down.read("pw:anna")).rejects.toBeInstanceOf(StoreError);
    fake.hashes.set(storeKey("pw:anna"), { v: "2", doc: "{not json" });
    await expect(upstashStore("https://x.upstash.io", "t0ken", fake.fetchImpl as unknown as typeof fetch).read("pw:anna")).rejects.toThrow(/unreadable/);
  });

  it("is configured by either the Vercel or the Upstash variable names, over https or on this machine", () => {
    expect(configuredStore({})).toBeUndefined();
    expect(configuredStore({ KV_REST_API_URL: "https://x.upstash.io", KV_REST_API_TOKEN: "t" })).toBeDefined();
    expect(configuredStore({ UPSTASH_REDIS_REST_URL: "https://x.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t" })).toBeDefined();
    expect(configuredStore({ UPSTASH_REDIS_REST_URL: "http://x.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t" })).toBeUndefined();
    expect(configuredStore({ UPSTASH_REDIS_REST_URL: "http://127.0.0.1:8079", UPSTASH_REDIS_REST_TOKEN: "t" })).toBeDefined();
  });
});

describe("/api/lists", () => {
  const SECRET = "s".repeat(40);
  let fake: ReturnType<typeof fakeUpstash>;

  async function signIn(user: string) {
    const { fingerprint, parseUsers } = await import("@/lib/auth/session");
    session.cookie = await signSession({ u: user, v: fingerprint(parseUsers(process.env.AUTH_USERS).get(user)!), exp: Date.now() + 60_000 }, SECRET);
  }
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    new Request("http://127.0.0.1:3107/api/lists", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1:3107", origin: "http://127.0.0.1:3107", "sec-fetch-site": "same-origin", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  beforeEach(async () => {
    vi.resetModules();
    fake = fakeUpstash();
    vi.stubGlobal("fetch", fake.fetchImpl);
    vi.stubEnv("AUTH_SECRET", SECRET);
    vi.stubEnv("AUTH_USERS", `anna:${await hashPassword("anna-password-1")},ben:${await hashPassword("ben-password-12")}`);
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://fake.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "t0ken");
    vi.stubEnv("DEMO_MODE", "0");
    session.cookie = undefined;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("serves each account its own lists and refuses requests without a session", async () => {
    const route = await import("@/app/api/lists/route");
    expect((await route.GET()).status).toBe(401);
    await signIn("anna");
    expect(await (await route.GET()).json()).toMatchObject({ status: "ok", stored: false, account: "anna" });
    const saved = await route.POST(post({ op: "add", list: PORTFOLIO, symbol: "V" }));
    expect(saved.status).toBe(200);
    expect(saved.headers.get("cache-control")).toBe("no-store");
    expect(await saved.json()).toMatchObject({ stored: true, doc: { version: 1 } });
    await signIn("ben");
    const ben = await (await route.GET()).json();
    expect(ben).toMatchObject({ stored: false, account: "ben" });
    expect(symbols(ben.doc, PORTFOLIO)).toEqual([]);
  });

  it("refuses cross-site and non-JSON writes, and explains invalid changes", async () => {
    const route = await import("@/app/api/lists/route");
    await signIn("anna");
    expect((await route.POST(post({ op: "add", list: WATCHLIST, symbol: "AAPL" }, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect((await route.POST(post({ op: "add", list: WATCHLIST, symbol: "AAPL" }, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await route.POST(post("op=add", { "content-type": "application/x-www-form-urlencoded" }))).status).toBe(415);
    expect((await route.POST(post({ op: "explode" }))).status).toBe(400);
    const bad = await route.POST(post({ op: "add", list: WATCHLIST, symbol: "not a ticker" }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toContain("is not a valid ticker");
    expect(fake.calls.filter(([c]) => c === "EVAL")).toHaveLength(0);
  });

  it("deletes the account's lists, and reports a database outage without claiming a save", async () => {
    const route = await import("@/app/api/lists/route");
    await signIn("anna");
    await route.POST(post({ op: "add", list: PORTFOLIO, symbol: "V" }));
    const del = await route.DELETE(new Request("http://127.0.0.1:3107/api/lists", { method: "DELETE", headers: { "sec-fetch-site": "same-origin" } }));
    expect(await del.json()).toMatchObject({ status: "ok", stored: false });
    expect((await (await route.GET()).json()).stored).toBe(false);
    vi.stubGlobal("fetch", async () => new Response("upstream down", { status: 502 }));
    const failed = await route.POST(post({ op: "add", list: PORTFOLIO, symbol: "MA" }));
    expect(failed.status).toBe(503);
    expect((await failed.json()).error).toContain("Your change was not saved.");
  });

  it("tells the browser to keep lists locally when there is no database, and refuses writes", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    const route = await import("@/app/api/lists/route");
    await signIn("anna");
    expect(await (await route.GET()).json()).toEqual({ status: "disabled", reason: "not-configured" });
    expect((await route.POST(post({ op: "add", list: WATCHLIST, symbol: "AAPL" }))).status).toBe(403);
  });
});

describe("lists saved in this browser", () => {
  const storage = new Map<string, string>();
  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reads the existing keys, and offers to import only what this browser actually saved", async () => {
    const { readLocalDoc, savedInBrowser } = await import("@/components/lists");
    expect(symbols(readLocalDoc(), WATCHLIST)).toEqual(DEFAULT_WATCHLIST);
    expect(savedInBrowser()).toEqual([]);
    storage.set("scout:portfolio", JSON.stringify(["V", "ma"]));
    storage.set("scout:named-lists", JSON.stringify([{ id: "l_1", name: "Ideas", symbols: [] }]));
    expect(savedInBrowser()).toEqual([
      { kind: "portfolio", name: "My portfolio", symbols: ["V", "MA"] },
      { kind: "custom", name: "Ideas", symbols: [] },
    ]);
  });
});
