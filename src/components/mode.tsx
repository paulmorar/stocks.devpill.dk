"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Explain as ExplainT } from "@/lib/scoring/types";

/**
 * Expert / Beginner mode. Every explanation in the app is written twice;
 * the mode picks which one leads, and the other is one click away.
 */
export type Mode = "beginner" | "expert";

const Ctx = createContext<{ mode: Mode; setMode: (m: Mode) => void }>({ mode: "beginner", setMode: () => {} });

export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<Mode>("beginner");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("scout:mode");
      if (saved === "expert" || saved === "beginner") setModeState(saved);
    } catch {}
  }, []);
  const setMode = (m: Mode) => {
    setModeState(m);
    try {
      localStorage.setItem("scout:mode", m);
    } catch {}
  };
  return <Ctx.Provider value={{ mode, setMode }}>{children}</Ctx.Provider>;
}

export const useMode = () => useContext(Ctx);

export function ModeToggle() {
  const { mode, setMode } = useMode();
  return (
    <div className="mode" role="group" aria-label="Explanation level">
      <button className={mode === "beginner" ? "on" : ""} onClick={() => setMode("beginner")} aria-pressed={mode === "beginner"}>
        Beginner
      </button>
      <button className={mode === "expert" ? "on" : ""} onClick={() => setMode("expert")} aria-pressed={mode === "expert"}>
        Expert
      </button>
    </div>
  );
}

/** Shows the explanation for the current mode, with the other version behind a toggle. */
export function Explain({ e, className = "" }: { e: ExplainT; className?: string }) {
  const { mode } = useMode();
  const [other, setOther] = useState(false);
  const main = mode === "expert" ? e.expert : e.simple;
  const alt = mode === "expert" ? e.simple : e.expert;
  return (
    <div className={`explain ${className}`}>
      <p style={{ marginBottom: 4 }}>{main}</p>
      <button className="linkish" onClick={() => setOther((v) => !v)}>
        {other ? "Hide" : mode === "expert" ? "Plain-English version" : "Show the technical version"}
      </button>
      {other && <div className="alt">{alt}</div>}
    </div>
  );
}

/** Text that only shows in one mode. */
export function Only({ mode, children }: { mode: Mode; children: ReactNode }) {
  const m = useMode().mode;
  return m === mode ? <>{children}</> : null;
}
