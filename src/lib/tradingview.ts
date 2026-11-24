import { SYMBOL_RE } from "./util";

/**
 * TradingView's embeddable Advanced Chart (legacy iframe embed, documented at
 * tradingview.com/widget-docs). Pure helpers: symbol mapping, indicator choices and the widget settings.
 */

export const WIDGET_SRC = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";

/**
 * Yahoo exchange suffix -> TradingView exchange, for exchanges whose charts TradingView allows in embeds
 * (checked in Nov 2026). London (.L), Tokyo (.T) and Hong Kong (.HK) charts are only available on TradingView itself.
 */
const EXCHANGES: Record<string, { tv: string; name: string }> = {
  CO: { tv: "OMXCOP", name: "Copenhagen" },
  ST: { tv: "OMXSTO", name: "Stockholm" },
  HE: { tv: "OMXHEX", name: "Helsinki" },
  OL: { tv: "OSL", name: "Oslo" },
  DE: { tv: "XETR", name: "Xetra" },
  AS: { tv: "EURONEXT", name: "Euronext Amsterdam" },
  PA: { tv: "EURONEXT", name: "Euronext Paris" },
  SW: { tv: "SIX", name: "SIX Swiss" },
  TO: { tv: "TSX", name: "Toronto" },
  AX: { tv: "ASX", name: "ASX" },
};
export const EMBEDDABLE_EXCHANGES = [...new Set(Object.values(EXCHANGES).map((e) => e.name))];

/** BRK-B -> BRK.B, NOVO-B.CO -> OMXCOP:NOVO_B. Undefined for indices, currencies and exchanges TradingView won't embed. */
export function tradingViewSymbol(yahoo: string): string | undefined {
  const s = yahoo.trim().toUpperCase();
  if (!SYMBOL_RE.test(s)) return undefined;
  if (/^[A-Z0-9]+(-[A-Z0-9]+)?$/.test(s)) return s.replace("-", ".");
  const m = s.match(/^([A-Z0-9]+(?:-[A-Z0-9]+)?)\.([A-Z]{1,3})$/);
  const ex = m ? EXCHANGES[m[2]!] : undefined;
  return ex ? `${ex.tv}:${m![1]!.replace("-", "_")}` : undefined;
}

export const tradingViewUrl = (tv: string) => `https://www.tradingview.com/symbols/${tv.replace(":", "-")}/`;

/** TradingView's built-in indicators, by the ids its embed accepts. Settings such as lengths can't be passed in. */
export const STUDIES = [
  { id: "MASimple@tv-basicstudies", label: "Moving average" },
  { id: "RSI@tv-basicstudies", label: "RSI" },
  { id: "MACD@tv-basicstudies", label: "MACD" },
  { id: "BB@tv-basicstudies", label: "Bollinger Bands" },
] as const;
export const DEFAULT_STUDIES: string[] = ["MASimple@tv-basicstudies", "RSI@tv-basicstudies"];
export const STUDIES_KEY = "scout:chart-indicators";

/** Saved indicator choices: known ids only, in menu order. Anything unreadable falls back to the defaults. */
export function readStudies(raw: unknown): string[] {
  return Array.isArray(raw) ? STUDIES.map((s) => s.id).filter((id) => raw.includes(id)) : DEFAULT_STUDIES;
}

/** Settings for the embed. Only the symbol and display options; nothing about the person viewing it. */
export function widgetConfig(tv: string, studies: string[]) {
  return {
    autosize: true,
    symbol: tv,
    interval: "D",
    timezone: "exchange",
    theme: "dark",
    style: "1",
    locale: "en",
    withdateranges: true,
    allow_symbol_change: false,
    save_image: false,
    calendar: false,
    studies,
    support_host: "https://www.tradingview.com",
  };
}
