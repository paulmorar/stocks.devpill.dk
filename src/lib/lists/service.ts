import "server-only";
import { applyOp, blankDoc, defaultDoc, type ListOp, type ListsDoc, normalizeDoc } from "./model";
import type { ListStore } from "./store";

/** Account lists on top of a store: read, change with compare-and-set retries, delete. */

export class ConflictError extends Error {}

const ATTEMPTS = 8;
const newId = () => `l_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
/** Random pause before a retry, so requests that collided don't collide again in lockstep. */
const backoff = (attempt: number) => new Promise<void>((r) => setTimeout(r, attempt * (10 + Math.random() * 30)));

export async function loadLists(store: ListStore, owner: string): Promise<{ doc: ListsDoc; stored: boolean }> {
  const hit = await store.read(owner);
  return hit ? { doc: normalizeDoc(hit.doc, hit.version), stored: true } : { doc: defaultDoc(), stored: false };
}

export type UpdateResult =
  | { ok: true; doc: ListsDoc; stored: boolean; listId?: string }
  | { ok: false; status: 400 | 404; error: string };

/**
 * Applies `op` to the newest saved document and saves it with compare-and-set. If another request saved in
 * between, the operation is applied again to that newer document, so neither change is lost.
 */
export async function updateLists(
  store: ListStore,
  owner: string,
  op: ListOp,
  { now = () => new Date().toISOString(), wait = backoff }: { now?: () => string; wait?: (attempt: number) => Promise<void> } = {},
): Promise<UpdateResult> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt) await wait(attempt);
    const hit = await store.read(owner);
    // An account that has never saved starts like a new browser, except that an import starts empty, so the
    // default watchlist doesn't bring back stocks the person removed in the browser being imported.
    const base = hit ? normalizeDoc(hit.doc, hit.version) : op.op === "import" ? blankDoc() : defaultDoc();
    const result = applyOp(base, op, { now: now(), newId });
    if (!result.ok) return result;
    // Importing always saves on a new account, so the choice ("import" or "start empty") is remembered.
    if (!result.changed && (hit || op.op !== "import")) return { ok: true, doc: base, stored: !!hit, listId: result.listId };
    const next = { ...result.doc, version: base.version + 1 };
    const { version: _version, ...body } = next;
    if (await store.write(owner, base.version, body)) return { ok: true, doc: next, stored: true, listId: result.listId };
  }
  throw new ConflictError("Your lists changed in another tab at the same moment. Reload and try again.");
}

export const deleteLists = (store: ListStore, owner: string) => store.remove(owner);
