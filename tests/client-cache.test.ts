import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MIN = 60_000;
const START = new Date("2026-11-25T09:00:00Z").getTime();
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

/** The browser's Cache Storage, kept outside the module so it survives a "new visit" (a fresh module). */
function fakeCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const url = (req: string | { url: string }) => (typeof req === "string" ? req : req.url);
  const open = async (name: string) => {
    const m = stores.get(name) ?? new Map<string, Response>();
    stores.set(name, m);
    return {
      match: async (req: string | { url: string }) => m.get(url(req))?.clone(),
      put: async (req: string, res: Response) => void m.set(req, res),
      delete: async (req: string | { url: string }) => m.delete(url(req)),
      keys: async () => [...m.keys()].map((k) => ({ url: k })),
    };
  };
  return { stores, api: { open, keys: async () => [...stores.keys()], delete: async (name: string) => stores.delete(name) } };
}

describe("browser data cache", () => {
  let store: ReturnType<typeof fakeCaches>;
  const fetchMock = vi.fn<(url: string) => Promise<Response>>();
  /** A page load: the module starts with an empty memory, Cache Storage keeps what earlier visits saved. */
  const visit = async () => {
    vi.resetModules();
    return import("@/lib/client");
  };

  beforeEach(() => {
    store = fakeCaches();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("caches", store.api);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(START);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("uses an answer as it is while fresh, shows it as stale after that, and drops it when too old", async () => {
    const c = await visit();
    fetchMock.mockResolvedValueOnce(json({ n: 1 }));
    expect(await c.fetchCached("/api/score/AAPL")).toEqual({ n: 1 });
    expect(await c.readCache("/api/score/AAPL", c.LONG_TERM)).toEqual({ value: { n: 1 }, stale: false });

    vi.setSystemTime(START + 16 * MIN);
    expect(await c.readCache("/api/score/AAPL", c.LONG_TERM)).toEqual({ value: { n: 1 }, stale: true });
    vi.setSystemTime(START + 31 * MIN);
    expect(await c.readCache("/api/score/AAPL", c.DAY_TRADING)).toBeUndefined();
    vi.setSystemTime(START + 8 * 24 * 60 * MIN);
    expect(await c.readCache("/api/score/AAPL", c.LONG_TERM)).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends one request for callers that ask at the same time, and keeps the answer when a refresh fails", async () => {
    const c = await visit();
    let release!: (r: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise((r) => (release = r)));
    const a = c.fetchCached("/api/radar");
    const b = c.fetchCached("/api/radar");
    release(json({ n: 2 }));
    expect([await a, await b]).toEqual([{ n: 2 }, { n: 2 }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(json({ error: "Yahoo did not answer" }, 502));
    await expect(c.fetchCached("/api/radar")).rejects.toThrow("Yahoo did not answer");
    expect((await c.readCache("/api/radar", c.LONG_TERM))?.value).toEqual({ n: 2 });
  });

  it("shows an earlier visit's answer as stale, starts empty after a deployment, and forgets everything on sign-out", async () => {
    const first = await visit();
    fetchMock.mockResolvedValueOnce(json({ n: 3 }));
    await first.fetchCached("/api/score/MSFT");
    await vi.waitFor(() => expect(store.stores.get("scout-data-dev")?.has("/api/score/MSFT")).toBe(true));

    const second = await visit();
    expect(await second.readCache("/api/score/MSFT", second.LONG_TERM)).toEqual({ value: { n: 3 }, stale: true });

    vi.stubEnv("NEXT_PUBLIC_BUILD_ID", "next");
    const third = await visit();
    expect(await third.readCache("/api/score/MSFT", third.LONG_TERM)).toBeUndefined();
    fetchMock.mockResolvedValueOnce(json({ n: 4 }));
    await third.fetchCached("/api/score/MSFT");
    await vi.waitFor(() => expect([...store.stores.keys()]).toEqual(["scout-data-next"]));

    await third.clearClientCache();
    expect(store.stores.size).toBe(0);
    fetchMock.mockResolvedValueOnce(json({ n: 5 }));
    await third.fetchCached("/api/score/MSFT");
    await new Promise((r) => setTimeout(r, 10));
    expect(store.stores.get("scout-data-next")?.size ?? 0).toBe(0);
  });
});
