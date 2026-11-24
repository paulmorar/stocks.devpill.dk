import { SYMBOL_RE } from "../util";

/**
 * Saved stock lists: the built-in Watchlist and My portfolio, plus named lists.
 * Pure, so lists kept in the browser and lists saved to an account follow the
 * same rules. The server keeps one document per account and saves it with
 * compare-and-set, re-applying the operation to the newer document on a conflict.
 */

export type ListKind = "watchlist" | "portfolio" | "custom";
export interface SavedList {
  id: string;
  name: string;
  kind: ListKind;
  symbols: string[];
}
export interface ListsDoc {
  /** Goes up by one with every saved change. 0 means the document has never been saved. */
  version: number;
  updatedAt?: string;
  lists: SavedList[];
}
/** A list without its id, as exported to a file or read from this browser. Matched by kind, then by name. */
export interface PortableList {
  name: string;
  kind: ListKind;
  symbols: string[];
}

export const WATCHLIST = "watchlist";
export const PORTFOLIO = "portfolio";
export const MAX_NAMED_LISTS = 20;
export const MAX_SYMBOLS = 500;
export const MAX_NAME = 60;
/** What a new browser, or an account that has never saved a list, starts with. */
export const DEFAULT_WATCHLIST = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "V", "JPM", "COST", "NOVO-B.CO"];

const BUILT_IN: Record<Exclude<ListKind, "custom">, { id: string; name: string }> = {
  watchlist: { id: WATCHLIST, name: "Watchlist" },
  portfolio: { id: PORTFOLIO, name: "My portfolio" },
};
const KINDS: ListKind[] = ["watchlist", "portfolio", "custom"];

/** Built-in lists, both empty. The starting point for an account that imports lists from a browser or a file. */
export const blankDoc = (): ListsDoc => ({
  version: 0,
  lists: [
    { ...BUILT_IN.watchlist, kind: "watchlist", symbols: [] },
    { ...BUILT_IN.portfolio, kind: "portfolio", symbols: [] },
  ],
});

export function defaultDoc(): ListsDoc {
  const doc = blankDoc();
  doc.lists[0]!.symbols = [...DEFAULT_WATCHLIST];
  return doc;
}

export function normalizeSymbol(raw: unknown): string | undefined {
  const s = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  return SYMBOL_RE.test(s) ? s : undefined;
}

/** Trimmed, single-spaced, no control characters, 1 to MAX_NAME characters. */
export function normalizeName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, " ").trim().replace(/\s+/g, " ");
  return name && name.length <= MAX_NAME ? name : undefined;
}

/** Valid, unique symbols in their original order, or the first invalid entry. */
function cleanSymbols(raw: readonly unknown[]): { symbols: string[]; invalid?: undefined } | { invalid: string } {
  const symbols: string[] = [];
  for (const r of raw) {
    const s = normalizeSymbol(r);
    if (!s) return { invalid: String(r).slice(0, 20) };
    if (!symbols.includes(s)) symbols.push(s);
  }
  return { symbols };
}

/** For data that was already checked when saved: drops entries that aren't tickers instead of failing. */
const keepValid = (raw: unknown): string[] => (Array.isArray(raw) ? [...new Set(raw.map(normalizeSymbol).filter((s): s is string => !!s))] : []);

/**
 * Reads a saved document defensively: both built-in lists always exist, named lists need an id and a valid name,
 * and symbols are de-duplicated. Nothing is truncated.
 */
export function normalizeDoc(raw: unknown, version = 0): ListsDoc {
  const doc = blankDoc();
  doc.version = version;
  const src = raw && typeof raw === "object" ? (raw as { lists?: unknown; updatedAt?: unknown }) : {};
  if (typeof src.updatedAt === "string") doc.updatedAt = src.updatedAt;
  const seen = new Set([WATCHLIST, PORTFOLIO]);
  for (const item of Array.isArray(src.lists) ? src.lists : []) {
    const l = (item ?? {}) as Partial<SavedList>;
    if (l.kind === "watchlist" || l.kind === "portfolio") {
      const target = doc.lists.find((x) => x.kind === l.kind)!;
      target.symbols = [...new Set([...target.symbols, ...keepValid(l.symbols)])];
      continue;
    }
    const name = normalizeName(l.name);
    if (typeof l.id !== "string" || !l.id || seen.has(l.id) || !name) continue;
    seen.add(l.id);
    doc.lists.push({ id: l.id, name, kind: "custom", symbols: keepValid(l.symbols) });
  }
  return doc;
}

export type ListOp =
  | { op: "add"; list: string; symbol: string }
  | { op: "addMany"; list: string; symbols: string[] }
  | { op: "remove"; list: string; symbol: string }
  | { op: "create"; name: string; symbols?: string[] }
  | { op: "rename"; list: string; name: string }
  | { op: "delete"; list: string }
  | { op: "import"; lists: PortableList[] };

export type OpResult =
  | { ok: true; doc: ListsDoc; changed: boolean; listId?: string }
  | { ok: false; status: 400 | 404; error: string };

export interface OpContext {
  now: string;
  newId: () => string;
}

const tooMany = (name: string) => `"${name}" can hold up to ${MAX_SYMBOLS} stocks.`;

/** Applies one change. Adding a symbol that is already there, or deleting a list that is already gone, changes nothing. */
export function applyOp(doc: ListsDoc, op: ListOp, ctx: OpContext): OpResult {
  const next: ListsDoc = structuredClone(doc);
  const find = (id: string) => next.lists.find((l) => l.id === id);
  const namedCount = () => next.lists.filter((l) => l.kind === "custom").length;
  const nameTaken = (name: string, except?: string) => next.lists.some((l) => l.id !== except && l.name.toLowerCase() === name.toLowerCase());
  const fail = (status: 400 | 404, error: string): OpResult => ({ ok: false, status, error });
  const done = (changed: boolean, listId?: string): OpResult =>
    changed ? { ok: true, doc: { ...next, updatedAt: ctx.now }, changed, listId } : { ok: true, doc, changed, listId };
  const missing = () => fail(404, "That list no longer exists. Reload the page to see your current lists.");
  const badName = () => fail(400, `Give the list a name of 1 to ${MAX_NAME} characters.`);
  const newId = () => {
    let id = ctx.newId();
    while (find(id)) id = ctx.newId();
    return id;
  };

  switch (op.op) {
    case "add":
    case "addMany": {
      const list = find(op.list);
      if (!list) return missing();
      const cleaned = cleanSymbols(op.op === "add" ? [op.symbol] : op.symbols);
      if (cleaned.invalid !== undefined) return fail(400, `"${cleaned.invalid}" is not a valid ticker.`);
      const fresh = cleaned.symbols.filter((s) => !list.symbols.includes(s));
      if (!fresh.length) return done(false, list.id);
      if (list.symbols.length + fresh.length > MAX_SYMBOLS) return fail(400, tooMany(list.name));
      list.symbols.push(...fresh);
      return done(true, list.id);
    }
    case "remove": {
      const list = find(op.list);
      if (!list) return missing();
      const symbol = normalizeSymbol(op.symbol);
      if (!symbol) return fail(400, `"${String(op.symbol).slice(0, 20)}" is not a valid ticker.`);
      if (!list.symbols.includes(symbol)) return done(false, list.id);
      list.symbols = list.symbols.filter((s) => s !== symbol);
      return done(true, list.id);
    }
    case "create": {
      const name = normalizeName(op.name);
      if (!name) return badName();
      if (nameTaken(name)) return fail(400, `You already have a list called "${name}".`);
      if (namedCount() >= MAX_NAMED_LISTS) return fail(400, `You can have up to ${MAX_NAMED_LISTS} named lists.`);
      const cleaned = cleanSymbols(op.symbols ?? []);
      if (cleaned.invalid !== undefined) return fail(400, `"${cleaned.invalid}" is not a valid ticker.`);
      if (cleaned.symbols.length > MAX_SYMBOLS) return fail(400, tooMany(name));
      const list: SavedList = { id: newId(), name, kind: "custom", symbols: cleaned.symbols };
      next.lists.push(list);
      return done(true, list.id);
    }
    case "rename": {
      const list = find(op.list);
      if (!list) return missing();
      if (list.kind !== "custom") return fail(400, `"${list.name}" is built in and can't be renamed.`);
      const name = normalizeName(op.name);
      if (!name) return badName();
      if (name === list.name) return done(false, list.id);
      if (nameTaken(name, list.id)) return fail(400, `You already have a list called "${name}".`);
      list.name = name;
      return done(true, list.id);
    }
    case "delete": {
      const list = find(op.list);
      if (!list) return done(false);
      if (list.kind !== "custom") return fail(400, `"${list.name}" is built in and can't be deleted.`);
      next.lists = next.lists.filter((l) => l.id !== list.id);
      return done(true);
    }
    case "import": {
      let changed = false;
      for (const item of op.lists) {
        const cleaned = cleanSymbols(item.symbols);
        if (cleaned.invalid !== undefined) return fail(400, `"${cleaned.invalid}" in "${String(item.name).slice(0, MAX_NAME)}" is not a valid ticker. Nothing was imported.`);
        let target: SavedList | undefined;
        if (item.kind === "custom") {
          const name = normalizeName(item.name);
          if (!name) return fail(400, `A list in the import has no valid name. Nothing was imported.`);
          target = next.lists.find((l) => l.kind === "custom" && l.name.toLowerCase() === name.toLowerCase());
          if (!target) {
            target = { id: newId(), name, kind: "custom", symbols: [] };
            next.lists.push(target);
            changed = true;
          }
        } else {
          target = next.lists.find((l) => l.kind === item.kind)!;
        }
        const fresh = cleaned.symbols.filter((s) => !target.symbols.includes(s));
        if (fresh.length) {
          target.symbols.push(...fresh);
          changed = true;
        }
      }
      const full = next.lists.find((l) => l.symbols.length > MAX_SYMBOLS);
      if (full) return fail(400, `${tooMany(full.name)} Nothing was imported.`);
      if (namedCount() > MAX_NAMED_LISTS) return fail(400, `You can have up to ${MAX_NAMED_LISTS} named lists. Nothing was imported.`);
      return done(changed);
    }
  }
}

const str = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const strArray = (v: unknown, max: number): v is string[] => Array.isArray(v) && v.length <= max && v.every((x) => str(x, 40));

function parsePortable(raw: unknown): PortableList | undefined {
  const l = (raw ?? {}) as Partial<PortableList>;
  if (!KINDS.includes(l.kind as ListKind) || !strArray(l.symbols, 2 * MAX_SYMBOLS)) return undefined;
  return { kind: l.kind as ListKind, name: str(l.name, 200) ? l.name : "", symbols: l.symbols };
}

/** Checks the shape of an operation from an untrusted request body. Values are validated again by applyOp. */
export function parseOp(raw: unknown): ListOp | undefined {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = str(b.list, 64) ? b.list : undefined;
  switch (b.op) {
    case "add":
    case "remove":
      return list && str(b.symbol, 40) ? { op: b.op, list, symbol: b.symbol } : undefined;
    case "addMany":
      return list && strArray(b.symbols, 2 * MAX_SYMBOLS) ? { op: "addMany", list, symbols: b.symbols } : undefined;
    case "create":
      if (!str(b.name, 200) || (b.symbols !== undefined && !strArray(b.symbols, 2 * MAX_SYMBOLS))) return undefined;
      return { op: "create", name: b.name, symbols: b.symbols as string[] | undefined };
    case "rename":
      return list && str(b.name, 200) ? { op: "rename", list, name: b.name } : undefined;
    case "delete":
      return list ? { op: "delete", list } : undefined;
    case "import": {
      if (!Array.isArray(b.lists) || b.lists.length > 2 * MAX_NAMED_LISTS + 2) return undefined;
      const lists = b.lists.map(parsePortable);
      return lists.every((l): l is PortableList => !!l) ? { op: "import", lists } : undefined;
    }
    default:
      return undefined;
  }
}

export const toPortable = (doc: ListsDoc): PortableList[] => doc.lists.map(({ name, kind, symbols }) => ({ name, kind, symbols: [...symbols] }));

export const EXPORT_TYPE = "stock-scout-lists";

export function exportFile(doc: ListsDoc, exportedAt: string) {
  return { type: EXPORT_TYPE, version: 1, exportedAt, lists: toPortable(doc) };
}

/** Lists from a file made by exportFile. Returns an error message for anything else. */
export function parseExportFile(raw: unknown): { lists: PortableList[] } | { error: string } {
  const f = (raw ?? {}) as { type?: unknown; lists?: unknown };
  if (f.type !== EXPORT_TYPE || !Array.isArray(f.lists)) return { error: "This file isn't a Stock Scout list export." };
  const op = parseOp({ op: "import", lists: f.lists });
  return op?.op === "import" ? { lists: op.lists } : { error: "The file is damaged or too large to import." };
}

export const countSymbols = (lists: readonly PortableList[]) => lists.reduce((n, l) => n + l.symbols.length, 0);
