"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { fetchJson } from "@/lib/client";
import {
  applyOp, countSymbols, DEFAULT_WATCHLIST, defaultDoc, exportFile, type ListOp, type ListsDoc, MAX_NAME, normalizeDoc,
  parseExportFile, PORTFOLIO, type PortableList, type SavedList, toPortable, WATCHLIST,
} from "@/lib/lists/model";

/**
 * Watchlist, My portfolio and named lists, shared by every page. Lists are saved to the signed-in account when
 * the server has a list database. Otherwise they stay in this browser, under the same keys as before.
 */

type Disabled = "not-configured" | "no-login" | "demo";
export type ListsStatus =
  | { mode: "loading" }
  | { mode: "local"; reason: Disabled }
  | { mode: "account"; account: string; stored: boolean }
  | { mode: "error"; message: string };

type Reply = { status: "disabled"; reason: Disabled } | { status: "ok"; doc: ListsDoc; stored: boolean; account: string; listId?: string };

const KEY = { watchlist: "scout:watchlist", portfolio: "scout:portfolio", named: "scout:named-lists" } as const;
const EMPTY: string[] = [];

function readJSON(key: string): unknown {
  try {
    const v = localStorage.getItem(key);
    return v === null ? undefined : JSON.parse(v);
  } catch {
    return undefined;
  }
}

/** Lists saved in this browser. A browser that never saved a watchlist gets the default one, as before. */
export function readLocalDoc(): ListsDoc {
  const wl = readJSON(KEY.watchlist);
  const pf = readJSON(KEY.portfolio);
  const named = readJSON(KEY.named);
  return normalizeDoc({
    lists: [
      { kind: "watchlist", symbols: Array.isArray(wl) ? wl : DEFAULT_WATCHLIST },
      { kind: "portfolio", symbols: Array.isArray(pf) ? pf : [] },
      ...(Array.isArray(named) ? named.map((l) => ({ ...(l as object), kind: "custom" })) : []),
    ],
  });
}

const symbolsOf = (doc: ListsDoc, kind: "watchlist" | "portfolio") => doc.lists.find((l) => l.kind === kind)?.symbols ?? EMPTY;
const namedOf = (doc: ListsDoc) => doc.lists.filter((l) => l.kind === "custom").map(({ id, name, symbols }) => ({ id, name, symbols }));

/** Writes only what changed, so an untouched default watchlist is never stored as if someone had saved it. */
function writeLocalDoc(before: ListsDoc, after: ListsDoc): boolean {
  const writes: [string, unknown][] = [];
  for (const kind of ["watchlist", "portfolio"] as const) {
    if (JSON.stringify(symbolsOf(before, kind)) !== JSON.stringify(symbolsOf(after, kind))) writes.push([KEY[kind], symbolsOf(after, kind)]);
  }
  if (JSON.stringify(namedOf(before)) !== JSON.stringify(namedOf(after))) writes.push([KEY.named, namedOf(after)]);
  try {
    for (const [key, value] of writes) localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** What this browser has actually saved: named lists, and built-in lists only when they were saved and aren't empty. */
export function savedInBrowser(): PortableList[] {
  const saved = { watchlist: Array.isArray(readJSON(KEY.watchlist)), portfolio: Array.isArray(readJSON(KEY.portfolio)) };
  return toPortable(readLocalDoc()).filter((l) => l.kind === "custom" || (saved[l.kind] && l.symbols.length > 0));
}

const randomId = () =>
  `l_${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "").slice(0, 12) : Math.random().toString(36).slice(2, 14)}`;

const opKey = (op: ListOp) => `${op.op}:${"list" in op ? op.list : ""}:${"symbol" in op ? op.symbol : ""}`;

export const describeLists = (lists: readonly PortableList[]) =>
  `${lists.map((l) => `${l.name} (${l.symbols.length})`).join(", ")}: ${countSymbols(lists)} stocks in ${lists.length} list${lists.length === 1 ? "" : "s"}`;

interface ListsApi {
  ready: boolean;
  status: ListsStatus;
  doc: ListsDoc;
  error?: string;
  dismissError(): void;
  isSaving(key: string): boolean;
  apply(op: ListOp): Promise<{ ok: boolean; listId?: string }>;
  reload(): Promise<void>;
  /** Deletes the account's saved lists, or this browser's lists when there is no account storage. */
  removeAll(): Promise<boolean>;
}

const Ctx = createContext<ListsApi>({
  ready: false,
  status: { mode: "loading" },
  doc: defaultDoc(),
  dismissError: () => {},
  isSaving: () => false,
  apply: async () => ({ ok: false }),
  reload: async () => {},
  removeAll: async () => false,
});

export const useLists = () => useContext(Ctx);

export function ListsProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ListsStatus>({ mode: "loading" });
  const [doc, setDoc] = useState<ListsDoc>(defaultDoc);
  const [saving, setSaving] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const statusRef = useRef(status);
  statusRef.current = status;
  // One request at a time from this tab: quick clicks queue up instead of racing each other on the server.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  // Replies can arrive out of order; never replace a document with an older version.
  const version = useRef(0);
  const accept = useCallback((r: Extract<Reply, { status: "ok" }>, force = false) => {
    if (!force && r.doc.version < version.current) return;
    version.current = r.doc.version;
    setDoc(r.doc);
    setStatus({ mode: "account", account: r.account, stored: r.stored });
  }, []);

  const reload = useCallback(async () => {
    try {
      // Plain fetch: a 401 here must not redirect, or the login page would loop.
      const res = await fetch("/api/lists", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as Reply & { error?: string };
      if (!res.ok) throw new Error(res.status === 401 ? "You're signed out." : (body.error ?? `HTTP ${res.status}`));
      if (body.status === "disabled") {
        setDoc(readLocalDoc());
        setStatus({ mode: "local", reason: body.reason });
      } else accept(body, true);
    } catch (e) {
      setStatus({ mode: "error", message: (e as Error).message });
    }
  }, [accept]);

  useEffect(() => {
    reload();
    const onStorage = (e: StorageEvent) => {
      if (statusRef.current.mode === "local" && Object.values(KEY).includes(e.key as never)) setDoc(readLocalDoc());
    };
    // Another tab or device may have changed the account's lists while this one was in the background.
    const onVisible = () => document.visibilityState === "visible" && statusRef.current.mode === "account" && reload();
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reload]);

  const apply = useCallback(
    async (op: ListOp) => {
      const s = statusRef.current;
      if (s.mode === "loading") return { ok: false };
      if (s.mode === "error") {
        setError("Your saved lists didn't load, so this change wasn't saved. Reload the page and try again.");
        return { ok: false };
      }
      const key = opKey(op);
      setSaving((k) => [...k, key]);
      try {
        if (s.mode === "local") {
          const before = readLocalDoc();
          const r = applyOp(before, op, { now: new Date().toISOString(), newId: randomId });
          if (!r.ok) throw new Error(r.error);
          if (r.changed && !writeLocalDoc(before, r.doc)) throw new Error("This browser didn't save the change. Its storage may be full or turned off.");
          setDoc(r.changed ? r.doc : before);
          return { ok: true, listId: r.listId };
        }
        const send = () =>
          fetchJson<Extract<Reply, { status: "ok" }>>("/api/lists", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(op),
          });
        const pending = queue.current.then(send, send);
        queue.current = pending.catch(() => {});
        const r = await pending;
        accept(r);
        return { ok: true, listId: r.listId };
      } catch (e) {
        setError((e as Error).message);
        return { ok: false };
      } finally {
        setSaving((k) => {
          const i = k.indexOf(key);
          return i < 0 ? k : [...k.slice(0, i), ...k.slice(i + 1)];
        });
      }
    },
    [accept],
  );

  const removeAll = useCallback(async () => {
    const s = statusRef.current;
    try {
      if (s.mode === "account") {
        accept(await fetchJson<Extract<Reply, { status: "ok" }>>("/api/lists", { method: "DELETE" }), true);
        return true;
      }
      if (s.mode === "local") {
        for (const key of Object.values(KEY)) localStorage.removeItem(key);
        setDoc(readLocalDoc());
        return true;
      }
      return false;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }, [accept]);

  const value = useMemo<ListsApi>(
    () => ({
      ready: status.mode !== "loading",
      status,
      doc,
      error,
      dismissError: () => setError(undefined),
      isSaving: (key) => saving.includes(key),
      apply,
      reload,
      removeAll,
    }),
    [status, doc, error, saving, apply, reload, removeAll],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {error && (
        <div className="toast" role="alert">
          <span>{error}</span>
          <button className="linkish" onClick={() => setError(undefined)}>Dismiss</button>
        </div>
      )}
    </Ctx.Provider>
  );
}

function useBuiltIn(id: string) {
  const l = useLists();
  const list = l.doc.lists.find((x) => x.id === id)?.symbols ?? EMPTY;
  return {
    list,
    ready: l.ready,
    has: (s: string) => list.includes(s),
    add: (s: string) => l.apply({ op: "add", list: id, symbol: s }),
    remove: (s: string) => l.apply({ op: "remove", list: id, symbol: s }),
    addMany: (symbols: string[]) => l.apply({ op: "addMany", list: id, symbols }),
    saving: (s: string) => l.isSaving(`add:${id}:${s}`) || l.isSaving(`remove:${id}:${s}`),
  };
}

export const useWatchlist = () => useBuiltIn(WATCHLIST);
/** Stocks you actually own, ranked like TTT's "Portfolio Holdings Scores". */
export const usePortfolio = () => useBuiltIn(PORTFOLIO);

/** Adds or removes one stock in named lists, or creates a new list with it. */
export function AddToLists({ symbol }: { symbol: string }) {
  const l = useLists();
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [fromLeft, setFromLeft] = useState(false);
  const [name, setName] = useState("");
  const named = l.doc.lists.filter((x) => x.kind === "custom");
  const count = named.filter((x) => x.symbols.includes(symbol)).length;
  return (
    <div
      className="menu-wrap"
      ref={box}
      onBlur={(e) => !box.current?.contains(e.relatedTarget as Node | null) && setOpen(false)}
      onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
    >
      <button
        className="btn"
        aria-expanded={open}
        aria-controls={id}
        disabled={!l.ready}
        onClick={(e) => {
          // Open toward the wider side, so the menu stays on screen when the button wraps to the start of a line on a phone.
          const r = e.currentTarget.getBoundingClientRect();
          setFromLeft(r.left + r.right < window.innerWidth);
          setOpen((o) => !o);
        }}
      >
        Lists{count ? ` · ${count}` : ""} ▾
      </button>
      {open && (
        <div className={fromLeft ? "menu from-left" : "menu"} id={id} role="group" aria-label={`Named lists for ${symbol}`}>
          {named.length === 0 && <p className="tiny muted" style={{ margin: "2px 4px 8px" }}>No named lists yet. Create one below.</p>}
          {named.map((x) => {
            const on = x.symbols.includes(symbol);
            const busy = l.isSaving(`add:${x.id}:${symbol}`) || l.isSaving(`remove:${x.id}:${symbol}`);
            return (
              <label key={x.id} className="menu-item">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={busy}
                  onChange={() => l.apply({ op: on ? "remove" : "add", list: x.id, symbol })}
                />
                <span className="ellipsis" style={{ flex: 1 }}>{x.name}</span>
                <span className="tiny faint num">{busy ? "Saving…" : x.symbols.length}</span>
              </label>
            );
          })}
          <form
            className="row"
            style={{ gap: 6, marginTop: 8, flexWrap: "nowrap" }}
            onSubmit={async (e) => {
              e.preventDefault();
              if ((await l.apply({ op: "create", name, symbols: [symbol] })).ok) setName("");
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New list" maxLength={MAX_NAME} aria-label="New list name" style={{ flex: 1, minWidth: 0 }} />
            <button className="btn" disabled={!name.trim() || l.isSaving("create::")}>Create</button>
          </form>
        </div>
      )}
    </div>
  );
}

/** Chips for named lists, plus create, rename and delete for the selected one. */
export function NamedLists({ selected, onSelect }: { selected?: SavedList; onSelect: (id?: string) => void }) {
  const l = useLists();
  const named = l.doc.lists.filter((x) => x.kind === "custom");
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<string>();
  return (
    <div style={{ marginBottom: 10 }}>
      <div className="row" style={{ marginBottom: 8 }}>
        {named.length > 0 && (
          <div className="tabs" role="group" aria-label="Named lists">
            {named.map((x) => (
              <button key={x.id} className={selected?.id === x.id ? "on" : ""} aria-pressed={selected?.id === x.id} onClick={() => onSelect(x.id)}>
                {x.name} · {x.symbols.length}
              </button>
            ))}
          </div>
        )}
        <form
          className="row"
          style={{ gap: 6 }}
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await l.apply({ op: "create", name });
            if (r.ok) {
              setName("");
              onSelect(r.listId);
            }
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New list name" maxLength={MAX_NAME} aria-label="New list name" />
          <button className="btn" disabled={!name.trim() || !l.ready}>Create list</button>
        </form>
      </div>
      {selected && (
        <div className="row small">
          {renaming !== undefined ? (
            <form
              className="row"
              style={{ gap: 6 }}
              onSubmit={async (e) => {
                e.preventDefault();
                if ((await l.apply({ op: "rename", list: selected.id, name: renaming })).ok) setRenaming(undefined);
              }}
            >
              <input value={renaming} onChange={(e) => setRenaming(e.target.value)} maxLength={MAX_NAME} aria-label="List name" autoFocus />
              <button className="btn">Save name</button>
              <button type="button" className="linkish" onClick={() => setRenaming(undefined)}>Cancel</button>
            </form>
          ) : (
            <>
              <button className="linkish" onClick={() => setRenaming(selected.name)}>Rename</button>
              <button
                className="linkish"
                onClick={async () => {
                  if (!window.confirm(`Delete the list "${selected.name}"? The ${selected.symbols.length} stocks in it stay in your other lists.`)) return;
                  if ((await l.apply({ op: "delete", list: selected.id })).ok) onSelect(undefined);
                }}
              >
                Delete list
              </button>
            </>
          )}
          <span className="tiny faint">Add stocks with the Lists button on any stock page.</span>
        </div>
      )}
    </div>
  );
}

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Where lists are saved, the one-time import offer, and export, import and delete. */
export function ListsSync() {
  const l = useLists();
  const s = l.status;
  const file = useRef<HTMLInputElement>(null);
  const [local, setLocal] = useState<PortableList[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  useEffect(() => setLocal(savedInBrowser()), [s.mode]);

  const run = async (op: ListOp, done: string) => {
    setBusy(true);
    setMessage(undefined);
    const r = await l.apply(op);
    setBusy(false);
    if (r.ok) setMessage(done);
  };
  const importLists = (lists: PortableList[], from: string) => {
    if (!lists.length) return setMessage(`There is nothing to import from ${from}.`);
    if (window.confirm(`Import ${describeLists(lists)}? Stocks are added to lists with the same name; nothing is removed.`)) {
      run({ op: "import", lists }, `Imported ${countSymbols(lists)} stocks from ${from}.`);
    }
  };

  if (s.mode === "loading") return null;
  if (s.mode === "error") {
    return (
      <div className="banner warn small" style={{ marginBottom: 10 }}>
        Your saved lists couldn&apos;t load: {s.message}{" "}
        <button className="linkish" onClick={() => l.reload()}>Try again</button>
      </div>
    );
  }

  const offerImport = s.mode === "account" && !s.stored && local.length > 0;
  return (
    <div style={{ marginBottom: 10 }}>
      {offerImport && (
        <div className="banner info small" style={{ marginBottom: 8 }}>
          <b>Save your lists to your account?</b> Then they are the same on every device you sign in on. This browser has{" "}
          {describeLists(local)}.
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn primary" disabled={busy} onClick={() => run({ op: "import", lists: local }, `Imported ${countSymbols(local)} stocks.`)}>
              Import these lists
            </button>
            <button className="btn" disabled={busy} onClick={() => run({ op: "import", lists: [] }, "Your account starts with empty lists.")}>
              Start with empty lists
            </button>
            <span className="tiny muted">The lists in this browser stay as they are either way.</span>
          </div>
        </div>
      )}
      <div className="row tiny muted">
        <span>
          {s.mode === "account"
            ? `Lists are saved to your account (${s.account}) and shared by every device you sign in on.`
            : s.reason === "demo"
              ? "Demo mode: lists are saved in this browser only."
              : s.reason === "not-configured"
                ? "Lists are saved in this browser only. To share them between devices, connect an Upstash Redis database (see the README)."
                : "Lists are saved in this browser only."}
        </span>
        <button className="linkish" onClick={() => download(`stock-scout-lists-${new Date().toISOString().slice(0, 10)}.json`, exportFile(l.doc, new Date().toISOString()))}>
          Export
        </button>
        <button className="linkish" onClick={() => file.current?.click()} disabled={busy}>Import a file</button>
        {s.mode === "account" && s.stored && local.length > 0 && (
          <button className="linkish" disabled={busy} onClick={() => importLists(local, "this browser")}>Import from this browser</button>
        )}
        <button
          className="linkish"
          disabled={busy}
          onClick={async () => {
            const where = s.mode === "account" ? "your account" : "this browser";
            if (!window.confirm(`Delete every list saved in ${where}? Export them first if you may want them back.`)) return;
            setBusy(true);
            if (await l.removeAll()) setMessage(`Deleted the lists saved in ${where}.`);
            setBusy(false);
          }}
        >
          Delete saved lists
        </button>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            let parsed: ReturnType<typeof parseExportFile>;
            try {
              parsed = parseExportFile(JSON.parse(await f.text()));
            } catch {
              parsed = { error: "That file isn't valid JSON." };
            }
            if ("error" in parsed) setMessage(parsed.error);
            else importLists(parsed.lists, f.name);
          }}
        />
      </div>
      {message && <div className="tiny" role="status" style={{ marginTop: 4 }}>{message}</div>}
    </div>
  );
}
