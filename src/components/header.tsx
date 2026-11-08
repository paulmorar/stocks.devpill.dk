"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { fetchJson } from "@/lib/client";
import { ModeToggle } from "./mode";

type Hit = { symbol: string; name: string; exchange: string; type: string };

function SearchBox() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [hl, setHl] = useState(0);
  const t = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    clearTimeout(t.current);
    if (!q.trim()) return setHits([]);
    t.current = setTimeout(() => {
      fetchJson<Hit[]>(`/api/search?q=${encodeURIComponent(q)}`).then(setHits).catch(() => setHits([]));
    }, 220);
  }, [q]);

  const go = (sym: string) => {
    setOpen(false);
    setQ("");
    router.push(`/stock/${encodeURIComponent(sym.toUpperCase())}`);
  };

  return (
    <div className="search">
      <input
        placeholder="Search ticker or company"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setHl(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setHl((h) => Math.min(h + 1, hits.length - 1));
          if (e.key === "ArrowUp") setHl((h) => Math.max(h - 1, 0));
          if (e.key === "Enter") go(hits[hl]?.symbol ?? q.trim());
        }}
        aria-label="Search stocks"
      />
      {open && hits.length > 0 && (
        <div className="results">
          {hits.map((h, i) => (
            <button key={h.symbol} className={i === hl ? "hl" : ""} onMouseDown={() => go(h.symbol)}>
              <b style={{ minWidth: 70 }}>{h.symbol}</b>
              <span className="muted small" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.name}</span>
              <span className="faint tiny">{h.type === "ETF" ? "ETF" : h.exchange}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Header() {
  const path = usePathname();
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
      </div>
    </header>
  );
}
