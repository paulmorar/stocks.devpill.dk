import type { PeriodRow } from "../types";
import { isNum } from "../util";

export interface Split {
  date: string;
  /** New shares per old share (10 for a 10-for-1 split). */
  ratio: number;
}

/**
 * Restate per-share values and share counts across stock splits.
 *
 * Providers are inconsistent: some restate history after a split, some don't.
 * We detect it per split: if the share count jumps by roughly the split ratio
 * between the last row before the split and the first row after it, history
 * is "as reported" and we restate the earlier rows. Without this, a 10-for-1
 * split would look like 900% dilution and trip the share-count red flag.
 */
export function applySplits(rows: PeriodRow[], splits: Split[]): PeriodRow[] {
  let out = rows.map((r) => ({ ...r }));
  for (const sp of splits) {
    if (!isNum(sp.ratio) || sp.ratio <= 0 || Math.abs(sp.ratio - 1) < 0.05) continue;
    const before = out.filter((r) => r.date < sp.date);
    const after = out.filter((r) => r.date >= sp.date);
    const last = before.at(-1);
    const first = after[0];
    if (!last || !first) continue;
    const sharesBefore = last.dilutedShares ?? last.sharesOutstanding;
    const sharesAfter = first.dilutedShares ?? first.sharesOutstanding;
    if (!isNum(sharesBefore) || !isNum(sharesAfter) || sharesBefore <= 0) continue;
    const jump = sharesAfter / sharesBefore;
    const unadjusted = sp.ratio > 1 ? jump > sp.ratio * 0.6 : jump < sp.ratio * 1.6;
    if (!unadjusted) continue;
    out = out.map((r) =>
      r.date < sp.date
        ? {
            ...r,
            eps: isNum(r.eps) ? r.eps / sp.ratio : r.eps,
            dilutedShares: isNum(r.dilutedShares) ? r.dilutedShares * sp.ratio : r.dilutedShares,
            sharesOutstanding: isNum(r.sharesOutstanding) ? r.sharesOutstanding * sp.ratio : r.sharesOutstanding,
          }
        : r,
    );
  }
  return out;
}
