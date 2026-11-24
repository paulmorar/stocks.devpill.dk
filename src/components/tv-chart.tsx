"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_STUDIES, EMBEDDABLE_EXCHANGES, readStudies, STUDIES, STUDIES_KEY, tradingViewSymbol, tradingViewUrl, WIDGET_SRC, widgetConfig } from "@/lib/tradingview";

function TradingViewFrame({ tv, studies, onError }: { tv: string; studies: string[]; onError: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const inner = document.createElement("div");
    inner.className = "tradingview-widget-container__widget";
    inner.style.height = "100%";
    const script = document.createElement("script");
    script.src = WIDGET_SRC;
    script.async = true;
    script.type = "text/javascript";
    script.textContent = JSON.stringify(widgetConfig(tv, studies));
    script.onerror = onError;
    el.append(inner, script);
    return () => {
      inner.remove();
      script.remove();
    };
  }, [tv, studies, onError]);
  return (
    <div className="tv-frame">
      <p className="tv-placeholder small muted">Loading the TradingView chart…</p>
      <div ref={box} className="tradingview-widget-container" style={{ height: "100%", position: "relative" }} />
    </div>
  );
}

/**
 * Optional TradingView chart with candles, volume and indicators. Nothing loads from TradingView until the
 * button is pressed; the lightweight price chart above stays the default.
 */
export function InteractiveChart({ symbol }: { symbol: string }) {
  const tv = tradingViewSymbol(symbol);
  const frame = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [studies, setStudies] = useState<string[]>(DEFAULT_STUDIES);
  // Stable, so the frame's effect doesn't reload the widget on every render.
  const onError = useCallback(() => setFailed(true), []);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STUDIES_KEY);
      if (saved !== null) setStudies(readStudies(JSON.parse(saved)));
    } catch {}
  }, []);
  useEffect(() => {
    setOpen(false);
    setFailed(false);
  }, [symbol]);

  const toggle = (id: string) => {
    const next = readStudies(studies.includes(id) ? studies.filter((s) => s !== id) : [...studies, id]);
    setStudies(next);
    try {
      localStorage.setItem(STUDIES_KEY, JSON.stringify(next));
    } catch {
      // Private browsing or storage turned off: the choice still applies until the page is closed.
    }
  };

  return (
    <section className="panel" ref={frame}>
      <div className="row between" style={{ marginBottom: 8 }}>
        <h2 style={{ marginBottom: 0 }}>Interactive chart</h2>
        {open && tv && !failed && (
          <div className="row small" role="group" aria-label="Indicators">
            {STUDIES.map((s) => (
              <label key={s.id} className="row" style={{ gap: 4 }}>
                <input type="checkbox" checked={studies.includes(s.id)} onChange={() => toggle(s.id)} /> {s.label}
              </label>
            ))}
            <button className="btn" onClick={() => frame.current?.requestFullscreen?.().catch(() => {})}>Full screen</button>
          </div>
        )}
      </div>
      {!tv ? (
        <p className="small muted" style={{ margin: 0 }}>
          TradingView only allows its chart to be embedded for US listings and these exchanges: {EMBEDDABLE_EXCHANGES.join(", ")}.
          The price chart above still works for {symbol}.
        </p>
      ) : !open ? (
        <>
          <p className="small muted">
            Candles, volume, drawing tools and indicators from TradingView. Loading it sends this page&apos;s address, the ticker and your IP
            address to TradingView. Nothing about your account or lists is shared.
          </p>
          <button className="btn" onClick={() => setOpen(true)}>Load the TradingView chart</button>
        </>
      ) : failed ? (
        <p className="small band-amber" style={{ margin: 0 }}>
          The TradingView chart didn&apos;t load. A content blocker may be stopping it.{" "}
          <a href={tradingViewUrl(tv)} target="_blank" rel="noopener noreferrer">Open {symbol} on TradingView</a>.
        </p>
      ) : (
        <>
          <TradingViewFrame key={`${tv}:${studies.join(",")}`} tv={tv} studies={studies} onError={onError} />
          <div className="tiny faint" style={{ marginTop: 6 }}>
            <a href={tradingViewUrl(tv)} rel="noopener nofollow" target="_blank">{symbol} chart</a> by TradingView. Its prices, times and
            indicators come from TradingView and can differ from the data behind the score. Indicator settings changed inside the chart
            aren&apos;t saved.
          </div>
        </>
      )}
    </section>
  );
}
