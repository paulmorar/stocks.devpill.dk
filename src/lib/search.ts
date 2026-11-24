/** Helpers for the header search, kept pure so the keyboard and ordering rules can be tested without a browser. */

/** Cmd+K on macOS, Ctrl+K elsewhere. */
export const isSearchShortcut = (e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">) =>
  (e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k";

export const RECENT_MAX = 6;

/** Newest first, no duplicates, capped. */
export function pushRecent(list: readonly string[], symbol: string, max = RECENT_MAX): string[] {
  const s = symbol.trim().toUpperCase();
  return s ? [s, ...list.filter((x) => x !== s)].slice(0, max) : [...list];
}

/** Arrow-key movement through `length` items, wrapping at both ends. */
export function moveHighlight(current: number, step: 1 | -1, length: number): number {
  return length > 0 ? (((current + step) % length) + length) % length : 0;
}

/** Hands out request ids; only the newest may update the results, so a slow old response can't replace newer ones. */
export function latestGate() {
  let latest = 0;
  return { next: () => ++latest, isCurrent: (id: number) => id === latest };
}
