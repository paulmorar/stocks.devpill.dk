import type { TrendResult } from "../trend";
import { hasLimitedHistory, type Explain, type ScoreResult } from "./types";

const BAND_WORD = { lime: "excellent", green: "good", amber: "middling", red: "weak" } as const;

const STRENGTH: Record<string, string> = {
  value: "the price looks reasonable", growth: "the business is growing", quality: "the business earns strong profits", health: "its finances are solid",
};
const WEAKNESS: Record<string, string> = {
  value: "the price looks expensive", growth: "growth has been slow", quality: "returns and profit margins are weak", health: "its finances look stretched",
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
    ? ` Limited history: we have only ${s.yearsOfHistory} annual reports. Treat this provisional score as an early estimate.`
    : "";

  const pillarText = best && worst
    ? `Strongest pillar: ${best.label}, with ${Math.round(best.r * 100)}% of its available points. Weakest: ${worst.label}, with ${Math.round(worst.r * 100)}%.`
    : "There is not enough data to compare the pillars.";
  const businessText = best
    ? ` The score suggests ${STRENGTH[best.id]}${worst && worst.id !== best.id && worst.r < 0.6 ? `, but ${WEAKNESS[worst.id]}` : ""}.`
    : " There is not enough data to compare the pillars.";
  const expert = `${s.total}/100 (${s.band}). ${pillarText}${flagText}${trendTextE}`;
  const simple = `${name} scores ${s.total} out of 100, a ${BAND_WORD[s.band]} result in this model.${businessText}${s.redFlags.length ? ` Serious warning signs limit the score, even if the price looks cheap.` : ""}${trendTextS}`;
  return { expert: expert + historyText, simple: simple + historyText };
}
