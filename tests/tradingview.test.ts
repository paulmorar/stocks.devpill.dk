import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InteractiveChart } from "@/components/tv-chart";
import { DEFAULT_STUDIES, readStudies, tradingViewSymbol, tradingViewUrl, widgetConfig } from "@/lib/tradingview";

describe("TradingView chart", () => {
  it("maps Yahoo tickers to TradingView symbols for exchanges that allow embedding", () => {
    expect(tradingViewSymbol("AAPL")).toBe("AAPL");
    expect(tradingViewSymbol("brk-b")).toBe("BRK.B");
    expect(tradingViewSymbol("NOVO-B.CO")).toBe("OMXCOP:NOVO_B");
    expect(tradingViewSymbol("VOLV-B.ST")).toBe("OMXSTO:VOLV_B");
    expect(tradingViewSymbol("SAP.DE")).toBe("XETR:SAP");
    expect(tradingViewSymbol("ASML.AS")).toBe("EURONEXT:ASML");
    expect(tradingViewSymbol("SHOP.TO")).toBe("TSX:SHOP");
    for (const blocked of ["SHEL.L", "7203.T", "0700.HK", "^GSPC", "EURUSD=X", "<b>"]) expect(tradingViewSymbol(blocked)).toBeUndefined();
    expect(tradingViewUrl("OMXCOP:NOVO_B")).toBe("https://www.tradingview.com/symbols/OMXCOP-NOVO_B/");
  });

  it("keeps only known indicators, and sends TradingView nothing but the symbol and display settings", () => {
    expect(readStudies(["RSI@tv-basicstudies", "evil", "MASimple@tv-basicstudies"])).toEqual(["MASimple@tv-basicstudies", "RSI@tv-basicstudies"]);
    expect(readStudies("garbage")).toEqual(DEFAULT_STUDIES);
    expect(readStudies([])).toEqual([]);
    const config = widgetConfig("AAPL", DEFAULT_STUDIES);
    expect(Object.keys(config).sort()).toEqual([
      "allow_symbol_change", "autosize", "calendar", "interval", "locale", "save_image", "studies", "style", "support_host", "symbol", "theme", "timezone", "withdateranges",
    ]);
    // TradingView's embed rejects indicator objects with settings; only plain ids are sent.
    expect(config.studies.every((s) => typeof s === "string")).toBe(true);
  });

  it("loads nothing from TradingView until asked, and explains unsupported exchanges", () => {
    const html = renderToStaticMarkup(createElement(InteractiveChart, { symbol: "AAPL" }));
    expect(html).toContain("Load the TradingView chart");
    expect(html).toContain("your IP");
    expect(html).not.toContain("tradingview-widget-container");
    expect(html).not.toContain("<script");
    expect(renderToStaticMarkup(createElement(InteractiveChart, { symbol: "SHEL.L" }))).toContain("The price chart above still works for SHEL.L");
  });
});
