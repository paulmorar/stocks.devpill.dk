import type { CheckResult, PillarId } from "./types";

export type CheckOutcome =
  | { score: number; display: string; expert: string; simple: string }
  | { skip: string };

export interface CheckDef {
  id: string;
  pillar: PillarId;
  label: string;
  rule: string;
  run: () => CheckOutcome;
}

/** Run a check, turning thrown errors or missing data into a skipped check (which re-weights its pillar). */
export function runCheck(def: CheckDef): CheckResult {
  let out: CheckOutcome;
  try {
    out = def.run();
  } catch (e) {
    out = { skip: `Could not compute (${(e as Error).message})` };
  }
  if ("skip" in out) {
    return {
      id: def.id, pillar: def.pillar, label: def.label, rule: def.rule, display: "—",
      points: 0, maxPoints: 0, skippedReason: out.skip,
      explain: { expert: `Skipped: ${out.skip}. Its points are shared among the pillar's other checks.`, simple: `We couldn't check this one (${out.skip.toLowerCase()}), so it doesn't count either way.` },
    };
  }
  const score = Math.max(0, Math.min(1, out.score));
  return {
    id: def.id, pillar: def.pillar, label: def.label, rule: def.rule, display: out.display,
    score, points: 0, maxPoints: 0, explain: { expert: out.expert, simple: out.simple },
  };
}

export const skip = (reason: string): CheckOutcome => ({ skip: reason });
