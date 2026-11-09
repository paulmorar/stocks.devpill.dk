/** Every explanation is written twice: for an experienced investor and for a total beginner. */
export interface Explain {
  expert: string;
  simple: string;
}

export type PillarId = "value" | "growth" | "quality" | "health";

export interface CheckResult {
  id: string;
  pillar: PillarId;
  label: string;
  /** Formatted measured value, e.g. "24.1× vs 28.0×". */
  display: string;
  /** 0..1 partial credit. Undefined = data missing, check skipped. */
  score?: number;
  points: number;
  maxPoints: number;
  explain: Explain;
  /** How the sliding scale is set, e.g. "0 pts at 1.4×, full at 0.7×". */
  rule: string;
  skippedReason?: string;
}

export interface PillarResult {
  id: PillarId;
  label: string;
  question: string;
  simpleQuestion: string;
  maxPoints: number;
  points: number;
  checks: CheckResult[];
}

export interface RedFlag {
  id: string;
  label: string;
  explain: Explain;
}

export type Band = "lime" | "green" | "amber" | "red";

export const MIN_HISTORY_YEARS = 4;
export const hasLimitedHistory = (yearsOfHistory?: number) => yearsOfHistory === MIN_HISTORY_YEARS;

export interface ScoreResult {
  symbol: string;
  scorable: boolean;
  notScoredReason?: string;
  scorecard: "main" | "financials";
  capexMode: boolean;
  /** Score before red-flag caps. */
  raw: number;
  total: number;
  band: Band;
  cap?: number;
  pillars: PillarResult[];
  redFlags: RedFlag[];
  yearsOfHistory: number;
  notes: string[];
}

export function bandOf(score: number): Band {
  if (score >= 80) return "lime";
  if (score >= 65) return "green";
  if (score >= 50) return "amber";
  return "red";
}
