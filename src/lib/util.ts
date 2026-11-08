/** Small numeric helpers shared by the data layer and the scoring engine. */

export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Read a number from a loosely-typed object, trying several keys in order. */
export function num(obj: unknown, ...keys: string[]): number | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const o = obj as Record<string, unknown>;
  for (const k of keys) {
    let v = o[k];
    // Yahoo sometimes wraps numbers as { raw, fmt }.
    if (v && typeof v === "object" && "raw" in (v as object)) v = (v as { raw: unknown }).raw;
    if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) v = Number(v);
    if (isNum(v)) return v;
  }
  return undefined;
}

export const abs = (v: number | undefined) => (isNum(v) ? Math.abs(v) : undefined);

export function clamp(v: number, lo = 0, hi = 1) {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Linear partial credit: returns 0 at `zeroAt`, 1 at `fullAt`, sliding in between.
 * Works in either direction (fullAt may be smaller than zeroAt for "lower is better").
 */
export function scale(v: number, zeroAt: number, fullAt: number) {
  if (zeroAt === fullAt) return v >= fullAt ? 1 : 0;
  return clamp((v - zeroAt) / (fullAt - zeroAt));
}

export function median(values: number[]) {
  const s = values.filter(isNum).sort((a, b) => a - b);
  if (!s.length) return undefined;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

export function mean(values: number[]) {
  const s = values.filter(isNum);
  return s.length ? s.reduce((a, b) => a + b, 0) / s.length : undefined;
}

export function stdev(values: number[]) {
  const m = mean(values);
  if (m === undefined || values.length < 2) return undefined;
  return Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / (values.length - 1));
}

/** Compound annual growth rate. Undefined when either end is non-positive. */
export function cagr(start: number | undefined, end: number | undefined, years: number) {
  if (!isNum(start) || !isNum(end) || start <= 0 || end <= 0 || years <= 0) return undefined;
  return (end / start) ** (1 / years) - 1;
}

/** Least-squares slope of y against index (units per step). */
export function slope(values: number[]) {
  const n = values.length;
  if (n < 2) return undefined;
  const xm = (n - 1) / 2;
  const ym = values.reduce((a, b) => a + b, 0) / n;
  let numr = 0;
  let den = 0;
  values.forEach((y, x) => {
    numr += (x - xm) * (y - ym);
    den += (x - xm) ** 2;
  });
  return den ? numr / den : undefined;
}

export const pct = (v: number | undefined, digits = 1) =>
  isNum(v) ? `${v >= 0 ? "" : "−"}${Math.abs(v * 100).toFixed(digits)}%` : "—";

export const signedPct = (v: number | undefined, digits = 0) =>
  isNum(v) ? `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(digits)}%` : "—";

export const fx = (v: number | undefined, digits = 1, suffix = "") =>
  isNum(v) ? `${v.toFixed(digits)}${suffix}` : "—";

export function money(v: number | undefined, currency = "USD") {
  if (!isNum(v)) return "—";
  const a = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  const sym = currency === "USD" ? "$" : currency === "EUR" ? "€" : currency === "DKK" ? "kr " : `${currency} `;
  if (a >= 1e12) return `${sign}${sym}${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${sign}${sym}${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${sign}${sym}${(a / 1e6).toFixed(0)}M`;
  return `${sign}${sym}${a.toFixed(2)}`;
}

export const isoDate = (d: Date | string | number) => new Date(d).toISOString().slice(0, 10);
