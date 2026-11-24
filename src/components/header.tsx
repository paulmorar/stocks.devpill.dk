"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { fetchJson, useRecent } from "@/lib/client";
import { isSearchShortcut, latestGate, moveHighlight } from "@/lib/search";
import { usePortfolio, useWatchlist } from "./lists";
import { ModeToggle } from "./mode";

type Hit = { symbol: string; name: string; exchange: string; type: string };
type Item = { symbol: string; name?: string; note?: string };

function SearchBox() {
  const router = useRouter();
  const wl = useWatchlist();
  const pf = usePortfolio();
  const recent = useRecent();
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const gate = useRef(latestGate());
  const [q, setQ] = useState("");
  // Results remember their query, so Enter never opens a stale match while a newer search is running.
  const [result, setResult] = useState<{ q: string; hits: Hit[]; failed: boolean }>();
  const [open, setOpen] = useState(false);
  const [hl, setHl] = useState(0);
  const [shortcut, setShortcut] = useState("");

  const query = q.trim();
  const current = result?.q === query ? result : undefined;
  const status = !query ? "idle" : !current ? "loading" : current.failed ? "error" : "done";
  const items: Item[] = query
    ? (current?.hits ?? []).map((h) => ({ symbol: h.symbol, name: h.name, note: h.type === "ETF" ? "ETF" : h.exchange }))
    : recent.list.map((symbol) => ({ symbol }));

  useEffect(() => {
    setShortcut(/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K");
    const onKey = (e: KeyboardEvent) => {
      if (!isSearchShortcut(e)) return;
      e.preventDefault();
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body && !box.current?.contains(active)) returnTo.current = active;
      input.current?.focus();
      input.current?.select();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const id = gate.current.next();
    setHl(0);
    if (!query) return;
    const t = setTimeout(() => {
      fetchJson<Hit[]>(`/api/search?q=${encodeURIComponent(query)}`)
        .then((hits) => gate.current.isCurrent(id) && setResult({ q: query, hits, failed: false }))
        .catch(() => gate.current.isCurrent(id) && setResult({ q: query, hits: [], failed: true }));
    }, 220);
    return () => clearTimeout(t);
  }, [query]);

  const go = (sym: string) => {
    const s = sym.trim().toUpperCase();
    if (!s) return;
    setQ("");
    setOpen(false);
    returnTo.current = null;
    input.current?.blur();
    router.push(`/stock/${encodeURIComponent(s)}`);
  };

  const message =
    status === "loading" ? "Searching…"
    : status === "error" ? `Search isn't available right now. Press Enter to open ${query.toUpperCase()} as a ticker.`
    : status === "done" && !items.length ? `No matches for "${query}". Press Enter to open ${query.toUpperCase()} as a ticker.`
    : "";

  return (
    <div
      className="search"
      ref={box}
      onBlur={(e) => {
        if (!box.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        const back = returnTo.current;
        returnTo.current = null;
        setOpen(false);
        // Back to where Cmd/Ctrl+K was pressed; from a result button, back to the input rather than the page body.
        if (back?.isConnected) back.focus();
        else if (e.target !== input.current) input.current?.focus();
      }}
    >
      <input
        ref={input}
        placeholder="Search ticker or company"
        value={q}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="go"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={(e) => {
          if (!box.current?.contains(e.relatedTarget as Node | null)) setOpen(true);
        }}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
            setHl((h) => moveHighlight(h, e.key === "ArrowDown" ? 1 : -1, items.length));
          } else if (e.key === "Enter") {
            e.preventDefault();
            go((open && items[hl]?.symbol) || query);
          }
        }}
        aria-label="Search stocks"
        aria-describedby="search-status"
      />
      {shortcut && !q && <kbd className="kbd" aria-hidden>{shortcut}</kbd>}
      <span id="search-status" className="sr-only" aria-live="polite">
        {status === "done" ? `${items.length} result${items.length === 1 ? "" : "s"}` : message}
      </span>
      {open && (query || items.length > 0) && (
        // Mouse-down would move focus out of the input and close the list before the click lands.
        <div className="results" role="region" aria-label="Search results" onMouseDown={(e) => e.preventDefault()}>
          {!query && (
            <div className="results-head tiny muted">
              <span>Recently viewed</span>
              <button className="linkish" onClick={() => recent.replace([])}>Clear</button>
            </div>
          )}
          {items.map((it, i) => {
            const watching = wl.has(it.symbol);
            const owned = pf.has(it.symbol);
            const savingW = wl.saving(it.symbol);
            const savingP = pf.saving(it.symbol);
            return (
              <div key={it.symbol} className={`result${i === hl ? " hl" : ""}`} onMouseEnter={() => setHl(i)}>
                <button className="open" onClick={() => go(it.symbol)}>
                  <b>{it.symbol}</b>
                  {it.name && <span className="muted small name">{it.name}</span>}
                  {it.note && <span className="faint tiny">{it.note}</span>}
                </button>
                <button
                  className={`act${watching ? " on" : ""}`}
                  aria-pressed={watching}
                  aria-label={`${watching ? "Remove" : "Add"} ${it.symbol} ${watching ? "from" : "to"} watchlist`}
                  disabled={!wl.ready || savingW}
                  onClick={() => (watching ? wl.remove(it.symbol) : wl.add(it.symbol))}
                >
                  {savingW ? "Saving…" : watching ? "✓ Watching" : "+ Watch"}
                </button>
                <button
                  className={`act${owned ? " on" : ""}`}
                  aria-pressed={owned}
                  aria-label={`${owned ? "Remove" : "Add"} ${it.symbol} ${owned ? "from" : "to"} portfolio`}
                  disabled={!pf.ready || savingP}
                  onClick={() => (owned ? pf.remove(it.symbol) : pf.add(it.symbol))}
                >
                  {savingP ? "Saving…" : owned ? "✓ Portfolio" : "+ Portfolio"}
                </button>
              </div>
            );
          })}
          {message && <div className="results-msg small muted">{message}</div>}
        </div>
      )}
    </div>
  );
}

export function Header({ authOn = false }: { authOn?: boolean }) {
  const path = usePathname();
  if (path === "/login") {
    return (
      <header className="header">
        <div className="wrap">
          <span className="brand">
            <span aria-hidden>🚀</span> Stock Scout
          </span>
        </div>
      </header>
    );
  }
  const nav = [
    { href: "/", label: "Long-term" },
    { href: "/day", label: "Day trading" },
    { href: "/learn", label: "Learn" },
  ];
  return (
    <header className="header">
      <div className="wrap">
        <Link href="/" className="brand">
          <span aria-hidden>🚀</span> Stock Scout
        </Link>
        <nav className="nav">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className={(n.href === "/" ? path === "/" || path.startsWith("/stock") : path.startsWith(n.href)) ? "active" : ""}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="spacer" />
        <SearchBox />
        <ModeToggle />
        {authOn && (
          <form method="post" action="/api/auth/logout">
            <button className="linkish" type="submit" title="Sign out">Sign out</button>
          </form>
        )}
      </div>
    </header>
  );
}
