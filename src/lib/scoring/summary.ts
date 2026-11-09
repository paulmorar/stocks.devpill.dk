import type { TrendResult } from "../trend";
import { hasLimitedHistory, type Explain, type ScoreResult } from "./types";

const BAND_WORD = { lime: "excellent", green: "good", amber: "middling", red: "weak" } as const;

const STRENGTH: Record<string, string> = {
  value: "the price looks reasonable", growth: "it's been growing", quality: "it's a high-quality, profitable business", health: "its finances are solid",
};
const WEAKNESS: Record<string, string> = {
  value: "the price is on the expensive side", growth: "growth has been slow", quality: "returns and margins are unimpressive", health: "its finances look stretched",
};

/** A short, plain-language read of the whole card. Rule-based, not AI-generated. */
export function summarize(name: string, s: ScoreResult, t?: TrendResult): Explain {
  if (!s.scorable) {
    return { expert: `Not scored: ${s.notScoredReason}`, simple: `We don't score this one. ${s.notScoredReason}` };
  }
  const ratios = s.pillars
    .filter((p) => p.checks.some((c) => c.score !== undefined))
    .map((p) => ({ id: p.id, label: p.label, r: p.points / p.maxPoints }))
    .sort((a, b) => b.r - a.r);
  const best = ratios[0];
  const worst = ratios.at(-1);

  const flagText = s.redFlags.length
    ? ` ${s.redFlags.length === 1 ? "A red flag" : `${s.redFlags.length} red flags`} (${s.redFlags.map((f) => f.label.toLowerCase()).join("; ")}) cap${s.redFlags.length === 1 ? "s" : ""} the score at ${s.redFlags.length >= 2 ? 39 : 59}.`
    : "";
  const trendTextE = t ? ` Trend: ${t.state}${t.rs !== undefined ? `, RS ${(t.rs * 100).toFixed(0)}` : ""}.` : "";
  const trendTextS = t
    ? ` ${t.state === "Uptrend" ? "The stock price has been rising." : t.state === "Downtrend" ? "The stock price has been falling." : t.state === "Recovering" ? "The stock price is bouncing back after a slump." : t.state === "Weakening" ? "The stock price has started to slip." : "The stock price has no clear direction."}`
    : "";
  const historyText = hasLimitedHistory(s.yearsOfHistory)
    ? ` Limited history: only ${s.yearsOfHistory} annual periods are available, so this score is provisional.`
    : "";

  const expert = `${s.total}/100 (${s.band}). Strongest pillar: ${best?.label} (${Math.round((best?.r ?? 0) * 100)}%); weakest: ${worst?.label} (${Math.round((worst?.r ?? 0) * 100)}%).${flagText}${trendTextE}`;
  const simple = `${name} scores ${s.total} out of 100 — ${BAND_WORD[s.band]}. In short: ${best ? STRENGTH[best.id] : ""}${worst && worst.id !== best?.id && worst.r < 0.6 ? `, but ${WEAKNESS[worst.id]}` : ""}.${s.redFlags.length ? ` There ${s.redFlags.length === 1 ? "is a serious warning sign" : "are serious warning signs"}, so the score is held down no matter how cheap it looks.` : ""}${trendTextS}`;
  return { expert: expert + historyText, simple: simple + historyText };
}
