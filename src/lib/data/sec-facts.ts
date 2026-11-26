import type { PeriodRow } from "../types";
import { isNum } from "../util";

/**
 * Older annual statement rows from SEC EDGAR company facts (data.sec.gov/api/xbrl/companyfacts/CIK##########.json),
 * every figure a company tagged in its filings. Pure, so the rules can be tested with fixtures.
 *
 * - Annual periods only: facts from annual reports (10-K, 20-F, 40-F and amendments) that span about a year, and
 *   balance-sheet values at the end of those periods. Each period takes the newest filing's figure, so restatements
 *   win. Rows are keyed by period-end year, like the Yahoo adapter.
 * - A field is used only when one of its concepts agrees with Yahoo (within 2%) in the oldest year both have, so the
 *   series joins Yahoo's without a jump. The matching concept is chosen per company: Yahoo's operating income is often
 *   adjusted, and its total debt includes operating leases for some companies only. Older years switch to another
 *   concept only where the two agree on a shared year. Operating income needs a match in at least 3 of 4 shared years
 *   instead, because Yahoo leaves out one-off items in some years only; its candidates add those items back.
 * - Foreign filers that report under IFRS use the IFRS taxonomy's concepts, joined to Yahoo the same way. Yahoo gives
 *   most ADRs their EPS per ADR, so their per-share figures don't join and keep Yahoo's years only.
 * - Every 10-K repeats two earlier years' share counts, restated for any split since. The ratio between two filings'
 *   counts for the same year converts older filings to the newest one's share basis. Per-share figures from a filing
 *   that can't be linked this way are left out, and so are EPS figures that don't fit net income over diluted shares.
 * - Share counts and EPS are left out for fiscal years that started before the listing: until an IPO, the weighted
 *   count leaves out preferred stock that converts at the IPO, so the jump would look like dilution.
 * - After a spin-off or a sale, the next report restates the years it shows as continuing operations, and older
 *   years stay as first reported. When a later report changed a year's revenue by more than 10%, years older than
 *   that report shows are left out, because they describe a different business.
 * - The rows fill Yahoo's gaps and add older years, up to 10 before Yahoo's newest. Never newer years: those would
 *   become the "last annual report" with fields that could not be checked.
 */

export interface SecFact {
  start?: string;
  end: string;
  val: number;
  accn: string;
  form: string;
  filed: string;
}
export interface CompanyFacts {
  facts?: Record<string, Record<string, { units?: Record<string, SecFact[]> }> | undefined>;
}

type NumField = Exclude<{ [K in keyof PeriodRow]-?: PeriodRow[K] extends number | undefined ? K : never }[keyof PeriodRow], "fy">;
/**
 * Summed concepts. The first part must be present; later parts count as 0 when missing, unless `required`. Within a
 * part, the first concept present wins.
 */
type Candidate = { any: string[]; minus?: true; required?: true }[];
interface Spec {
  field: NumField;
  kind: "money" | "perShare" | "shares";
  instant?: true;
  abs?: true;
  /**
   * "most": a candidate joins only when it matches Yahoo in at least 3 of 4 shared years, and the one that matches in
   * the most years wins. Otherwise the first candidate that matches in the oldest shared year wins.
   */
  match?: "most";
  candidates: Candidate[];
}

/** Concepts are US-GAAP unless prefixed with the IFRS taxonomy (foreign filers that report under IFRS). */
const IFRS = "ifrs-full:";
const ifrs = (...concepts: string[]) => concepts.map((k) => IFRS + k);
const one = (...concepts: string[]): Candidate[] => concepts.map((k) => [{ any: [k] }]);
const DEBT_CORES: Candidate[] = [
  [{ any: ["LongTermDebt"] }],
  [{ any: ["LongTermDebtNoncurrent"] }, { any: ["LongTermDebtCurrent", "DebtCurrent"] }],
  [{ any: ["LongTermDebtAndCapitalLeaseObligations"] }, { any: ["LongTermDebtAndCapitalLeaseObligationsCurrent", "LongTermDebtCurrent", "DebtCurrent"] }],
  [{ any: ["DebtLongtermAndShorttermCombinedAmount"] }],
];
const SHORT: Candidate = [{ any: ["ShortTermBorrowings"] }, { any: ["CommercialPaper"] }];
const FIN_LEASE: Candidate = [{ any: ["FinanceLeaseLiability", "CapitalLeaseObligations"] }];
const OP_LEASE: Candidate = [{ any: ["OperatingLeaseLiability"] }];
const DEBT = DEBT_CORES.flatMap((core) =>
  [[...SHORT, ...FIN_LEASE], SHORT, FIN_LEASE, [], [...SHORT, ...FIN_LEASE, ...OP_LEASE], [...SHORT, ...OP_LEASE], [...FIN_LEASE, ...OP_LEASE], OP_LEASE].map((extra) => [...core, ...extra]),
);
const IFRS_LEASES: Candidate = [{ any: ifrs("NoncurrentLeaseLiabilities") }, { any: ifrs("CurrentLeaseLiabilities") }];
const IFRS_BORROWINGS: Candidate = [
  { any: ifrs("NoncurrentPortionOfNoncurrentBorrowings", "LongtermBorrowings") },
  { any: ifrs("CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings", "ShorttermBorrowings") },
];
const IFRS_DEBT: Candidate[] = [
  [{ any: ifrs("Borrowings") }, ...IFRS_LEASES],
  [...IFRS_BORROWINGS, ...IFRS_LEASES],
  [{ any: ifrs("Borrowings") }],
  [...IFRS_BORROWINGS],
  [{ any: ifrs("LiabilitiesArisingFromFinancingActivities") }],
];
const INTANGIBLES = ["IntangibleAssetsNetExcludingGoodwill", "FiniteLivedIntangibleAssetsNet"];
const REVENUE = ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet",
  "RevenuesNetOfInterestExpense", "RegulatedAndUnregulatedOperatingRevenue", "SalesRevenueGoodsNet", "SalesRevenueServicesNet", "ElectricUtilityRevenue"];
const RESTRUCTURING = ["RestructuringCharges", "RestructuringCosts", "RestructuringSettlementAndImpairmentProvisions"];
/**
 * Yahoo's operating income often leaves out one-off items that GAAP operating income includes, in some years or in
 * all of them, so the candidates add those items back or rebuild the figure from its usual parts.
 */
const OPERATING_INCOME: Candidate[] = [
  [{ any: ["OperatingIncomeLoss"] }],
  [{ any: ["OperatingIncomeLoss"] }, { any: RESTRUCTURING }],
  [{ any: ["OperatingIncomeLoss"] }, { any: RESTRUCTURING }, { any: ["GoodwillImpairmentLoss"] }, { any: ["AssetImpairmentCharges", "ImpairmentOfIntangibleAssetsExcludingGoodwill"] }],
  [{ any: ["OperatingIncomeLoss"] }, { any: ["ResearchAndDevelopmentInProcess", "ResearchAndDevelopmentAssetAcquiredOtherThanThroughBusinessCombinationWrittenOff"] }],
  [{ any: REVENUE }, { any: ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold"], minus: true, required: true },
    { any: ["SellingGeneralAndAdministrativeExpense"], minus: true, required: true }, { any: ["ResearchAndDevelopmentExpense"], minus: true }],
  [{ any: REVENUE }, { any: ["CostsAndExpenses"], minus: true, required: true }],
  ...one(...ifrs("ProfitLossFromOperatingActivities")),
];

const SPECS: Spec[] = [
  { field: "revenue", kind: "money", candidates: one(...REVENUE, ...ifrs("Revenue", "RevenueFromContractsWithCustomers")) },
  { field: "operatingIncome", kind: "money", match: "most", candidates: OPERATING_INCOME },
  {
    field: "pretaxIncome", kind: "money",
    candidates: one("IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
      "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments", ...ifrs("ProfitLossBeforeTax")),
  },
  { field: "taxProvision", kind: "money", candidates: one("IncomeTaxExpenseBenefit", ...ifrs("IncomeTaxExpenseContinuingOperations")) },
  {
    field: "netIncome", kind: "money",
    candidates: one("NetIncomeLossAvailableToCommonStockholdersBasic", "NetIncomeLoss", "ProfitLoss",
      ...ifrs("ProfitLossAttributableToOwnersOfParent", "ProfitLossAttributableToOrdinaryEquityHoldersOfParentEntity", "ProfitLoss")),
  },
  { field: "eps", kind: "perShare", candidates: one("EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted", ...ifrs("DilutedEarningsLossPerShare", "BasicAndDilutedEarningsLossPerShare")) },
  {
    field: "dilutedShares", kind: "shares",
    candidates: one("WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfShareOutstandingBasicAndDiluted", ...ifrs("AdjustedWeightedAverageShares")),
  },
  {
    field: "interestExpense", kind: "money", abs: true,
    candidates: one("InterestExpense", "InterestExpenseNonoperating", "InterestExpenseOperating", "InterestAndDebtExpense", "InterestExpenseDebt",
      ...ifrs("InterestExpense", "FinanceCosts", "InterestExpenseOnBorrowings")),
  },
  {
    field: "da", kind: "money", abs: true,
    candidates: one("DepreciationDepletionAndAmortization", "DepreciationAndAmortization", "DepreciationAmortizationAndAccretionNet", "Depreciation",
      ...ifrs("AdjustmentsForDepreciationAndAmortisationExpense", "DepreciationAndAmortisationExpense",
        "AdjustmentsForDepreciationAndAmortisationExpenseAndImpairmentLossReversalOfImpairmentLossRecognisedInProfitOrLoss",
        "DepreciationAmortisationAndImpairmentLossReversalOfImpairmentLossRecognisedInProfitOrLoss")),
  },
  {
    field: "operatingCashFlow", kind: "money",
    candidates: one("NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
      ...ifrs("CashFlowsFromUsedInOperatingActivities", "CashFlowsFromUsedInOperatingActivitiesContinuingOperations")),
  },
  {
    field: "capex", kind: "money", abs: true,
    candidates: [
      ...one("PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets", "PaymentsForCapitalImprovements"),
      // Yahoo counts purchases of intangible assets (such as software) as capital spending at IFRS filers.
      [{ any: ifrs("PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities", "PurchaseOfPropertyPlantAndEquipment") },
        { any: ifrs("PurchaseOfIntangibleAssetsClassifiedAsInvestingActivities", "PurchaseOfIntangibleAssets") }],
      ...one(...ifrs("PurchaseOfPropertyPlantAndEquipmentIntangibleAssetsOtherThanGoodwillInvestmentPropertyAndOtherNoncurrentAssets")),
    ],
  },
  { field: "buybacks", kind: "money", abs: true, candidates: one("PaymentsForRepurchaseOfCommonStock", "PaymentsForRepurchaseOfEquity", ...ifrs("PaymentsToAcquireOrRedeemEntitysShares", "PurchaseOfTreasuryShares")) },
  {
    field: "dividendsPaid", kind: "money", abs: true,
    candidates: one("PaymentsOfDividends", "PaymentsOfDividendsCommonStock", "PaymentsOfOrdinaryDividends",
      ...ifrs("DividendsPaidToEquityHoldersOfParentClassifiedAsFinancingActivities", "DividendsPaidClassifiedAsFinancingActivities", "DividendsPaidOrdinaryShares", "DividendsPaid")),
  },
  {
    field: "equity", kind: "money", instant: true,
    candidates: one("StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest", ...ifrs("EquityAttributableToOwnersOfParent", "Equity")),
  },
  { field: "totalAssets", kind: "money", instant: true, candidates: one("Assets", ...ifrs("Assets")) },
  { field: "totalDebt", kind: "money", instant: true, candidates: [...DEBT, ...IFRS_DEBT] },
  {
    field: "cash", kind: "money", instant: true,
    candidates: [
      [{ any: ["CashCashEquivalentsAndShortTermInvestments"] }],
      [{ any: ["CashAndCashEquivalentsAtCarryingValue"] }, { any: ["ShortTermInvestments", "MarketableSecuritiesCurrent", "AvailableForSaleSecuritiesDebtSecuritiesCurrent"] }],
      [{ any: ["CashAndCashEquivalentsAtCarryingValue"] }],
      [{ any: ["CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"] }],
      ...["OtherCurrentFinancialAssets", "ShorttermDepositsNotClassifiedAsCashEquivalents", "CurrentFinancialAssetsAtFairValueThroughProfitOrLoss", "CurrentInvestments"]
        .map((k): Candidate => [{ any: ifrs("CashAndCashEquivalents") }, { any: ifrs(k) }]),
      ...one(...ifrs("CashAndCashEquivalents")),
    ],
  },
  {
    field: "tangibleBookValue", kind: "money", instant: true,
    candidates: [
      [{ any: ["StockholdersEquity"] }, { any: ["Goodwill"], minus: true }, { any: INTANGIBLES, minus: true }],
      [{ any: ["StockholdersEquity"] }, { any: ["Goodwill"], minus: true }, { any: INTANGIBLES, minus: true }, { any: ["PreferredStockValue"], minus: true }],
      [{ any: ["StockholdersEquity"] }, { any: ["Goodwill"], minus: true }],
      [{ any: ifrs("EquityAttributableToOwnersOfParent") }, { any: ifrs("Goodwill"), minus: true }, { any: ifrs("IntangibleAssetsOtherThanGoodwill"), minus: true }],
      [{ any: ifrs("EquityAttributableToOwnersOfParent") }, { any: ifrs("IntangibleAssetsAndGoodwill"), minus: true }],
    ],
  },
  { field: "sharesOutstanding", kind: "shares", instant: true, candidates: one("CommonStockSharesOutstanding", ...ifrs("NumberOfSharesOutstanding")) },
];

const ANNUAL_FORMS = /^(10-K|10-KT|20-F|40-F)(\/A)?$/;
const DAY = 86_400_000;
const spansYear = (f: SecFact) => {
  if (!f.start) return false;
  const d = (Date.parse(f.end) - Date.parse(f.start)) / DAY;
  return d > 340 && d < 390;
};
const yearOf = (date: string) => Number(date.slice(0, 4));
const TOLERANCE = 0.02;
/** Filings round EPS to cents, so a small EPS (NVDA after its split: $0.17 against 0.174) needs more than 2%. */
const CENT_ROUNDING = 0.006;
const close = (a: number, b: number, abs = 0) => Math.abs(a - b) <= Math.max(TOLERANCE * Math.max(Math.abs(a), Math.abs(b)), abs);
/**
 * Splits run from 3-for-2 to 50-for-1 (CMG, 2024). A smaller difference between two filings' counts for the same year
 * is a restatement; a much larger one is a figure tagged in the wrong scale (thousands instead of shares).
 */
const SPLIT_MIN = 1.3;
const SPLIT_MAX = 100;
const SHARE_CONCEPTS = ["WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfShareOutstandingBasicAndDiluted", ...ifrs("AdjustedWeightedAverageShares")];
/** Share of the shared years a "most" candidate must match. */
const MOST = 0.75;

type Facts = NonNullable<CompanyFacts["facts"]>;
type Units = (concept: string, unit: string) => SecFact[];

function unitsOf(facts: Facts, concept: string, unit: string): SecFact[] {
  const [taxonomy, name] = concept.startsWith(IFRS) ? ["ifrs-full", concept.slice(IFRS.length)] : ["us-gaap", concept];
  return facts[taxonomy]?.[name]?.units?.[unit] ?? [];
}

/**
 * Facts of several registrants as one company, such as a new holding company and the predecessor that filed the
 * older annual reports. Each period still takes the newest filing's figure.
 */
export function mergeFacts(...bodies: (CompanyFacts | undefined)[]): CompanyFacts | undefined {
  const present = bodies.filter((b): b is CompanyFacts => !!b?.facts);
  if (present.length < 2) return present[0];
  const facts: Facts = {};
  for (const b of present) {
    for (const [taxonomy, concepts] of Object.entries(b.facts ?? {})) {
      const into = (facts[taxonomy] ??= {});
      for (const [name, concept] of Object.entries(concepts ?? {})) {
        const units = ((into[name] ??= { units: {} }).units ??= {});
        for (const [unit, list] of Object.entries(concept.units ?? {})) units[unit] = [...(units[unit] ?? []), ...list];
      }
    }
  }
  return { facts };
}

export function secAnnual(body: CompanyFacts, yahoo: PeriodRow[], currency: string, listedSince?: string): PeriodRow[] {
  const facts = body.facts;
  if (!facts || !yahoo.length) return [];
  const newest = Math.max(...yahoo.map((r) => r.fy));
  const units: Units = (concept, unit) => unitsOf(facts, concept, unit);
  const unitOf = (s: Spec) => (s.kind === "money" ? currency : s.kind === "perShare" ? `${currency}/shares` : "shares");

  const ends = fiscalYearEnds(units, currency);
  const since = basisStart(units, currency);
  // One concept only: some companies tag the other one in thousands, which would look like a split.
  const factors = splitFactors(SHARE_CONCEPTS.map((k) => units(k, "shares")).find((fs) => fs.length) ?? []);
  const rows = new Map<number, PeriodRow>();
  for (const spec of SPECS) {
    const unit = unitOf(spec);
    const cache = new Map<string, Map<number, number>>();
    const conceptSeries = (concept: string) => {
      let s = cache.get(concept);
      if (!s) cache.set(concept, (s = byYear(units(concept, unit), spec, ends, factors)));
      return s;
    };
    const candidates = spec.candidates.map((cand) => candidateSeries(cand, conceptSeries, spec.abs));
    const yahooValues = new Map(yahoo.flatMap((r) => (isNum(r[spec.field]) ? [[r.fy, r[spec.field] as number] as const] : [])));
    const joined = join(candidates, yahooValues, spec.kind === "perShare" ? CENT_ROUNDING : 0, spec.match === "most");
    for (const [fy, v] of joined ?? []) {
      if (fy > newest || fy < Math.max(newest - 10, since)) continue;
      const row: PeriodRow = rows.get(fy) ?? { fy, date: ends.get(fy) ?? `${fy}-12-31`, sources: ["sec"] };
      row[spec.field] = v;
      rows.set(fy, row);
    }
  }
  const listed = listedSince ? Date.parse(listedSince) : NaN;
  for (const r of rows.values()) {
    if (isNum(r.operatingCashFlow) && isNum(r.capex)) r.freeCashFlow = r.operatingCashFlow - r.capex;
    if (isNum(r.eps) && isNum(r.dilutedShares) && isNum(r.netIncome) && !perShareFits(r.eps, r.dilutedShares, r.netIncome)) {
      r.eps = r.dilutedShares = undefined;
    }
    if (Date.parse(r.date) < listed + 360 * DAY) r.eps = r.dilutedShares = r.sharesOutstanding = undefined;
  }
  return [...rows.values()]
    .filter((r) => isNum(r.revenue) || isNum(r.netIncome) || isNum(r.totalAssets) || isNum(r.operatingCashFlow))
    .sort((a, b) => a.fy - b.fy);
}

/** Period end per fiscal year, from annual periods of the mapped flow concepts. A 52/53-week year can end twice in one calendar year; the later end wins. */
function fiscalYearEnds(units: Units, currency: string) {
  const ends = new Map<number, string>();
  for (const spec of SPECS) {
    if (spec.instant || spec.kind !== "money") continue;
    for (const cand of spec.candidates) {
      for (const f of units(cand[0]!.any[0]!, currency)) {
        if (!ANNUAL_FORMS.test(f.form) || !spansYear(f)) continue;
        const fy = yearOf(f.end);
        if (f.end > (ends.get(fy) ?? "")) ends.set(fy, f.end);
      }
    }
  }
  return ends;
}

/**
 * The oldest year on the current basis, or 0. After a spin-off or sale, the first report that changes an earlier
 * year's revenue by more than 10% restates every year it shows, so those years and later ones are comparable.
 */
function basisStart(units: Units, currency: string) {
  const revenue = SPECS.find((spec) => spec.field === "revenue") as Spec;
  const byConcept = revenue.candidates.map((cand) => units(cand[0]!.any[0]!, currency).filter((f) => ANNUAL_FORMS.test(f.form) && spansYear(f)));
  let restatedOn = "";
  for (const facts of byConcept) {
    const byEnd = new Map<string, SecFact[]>();
    for (const f of facts) byEnd.set(f.end, [...(byEnd.get(f.end) ?? []), f]);
    for (const fs of byEnd.values()) {
      const sorted = fs.sort((a, b) => a.filed.localeCompare(b.filed));
      const first = sorted[0]!.val;
      const change = sorted.find((f) => first > 0 && !(f.val / first >= 1 / 1.1 && f.val / first <= 1.1));
      if (change && change.filed > restatedOn) restatedOn = change.filed;
    }
  }
  if (!restatedOn) return 0;
  return Math.min(...byConcept.flat().filter((f) => f.filed >= restatedOn).map((f) => yearOf(f.end)));
}

/**
 * Factor per filing (accession number) that converts its share counts to the newest filing's basis. Filings are
 * linked newest first through a fiscal year they both report; a filing without such a year gets no factor, and its
 * per-share figures are not used.
 */
function splitFactors(facts: SecFact[]) {
  const filings = new Map<string, { filed: string; counts: Map<string, number> }>();
  for (const f of facts) {
    if (!ANNUAL_FORMS.test(f.form) || !spansYear(f) || !(f.val > 0)) continue;
    const e = filings.get(f.accn) ?? { filed: f.filed, counts: new Map<string, number>() };
    e.counts.set(f.end, f.val);
    filings.set(f.accn, e);
  }
  const order = [...filings].sort((a, b) => b[1].filed.localeCompare(a[1].filed));
  const factor = new Map<string, number>();
  for (const [accn, f] of order) {
    if (!factor.size) {
      factor.set(accn, 1);
      continue;
    }
    for (const [other, g] of order) {
      const k = factor.get(other);
      const end = k === undefined ? undefined : [...f.counts.keys()].find((e) => g.counts.has(e));
      if (k === undefined || !end) continue;
      const r = (g.counts.get(end) as number) / (f.counts.get(end) as number);
      const size = Math.max(r, 1 / r);
      if (size <= SPLIT_MAX) factor.set(accn, size < SPLIT_MIN ? k : k * r);
      break;
    }
  }
  return factor;
}

/** One concept's value per fiscal year: the newest filing's figure for the period ending at that year's fiscal year-end. */
function byYear(facts: SecFact[], spec: Spec, ends: Map<number, string>, factors: Map<string, number>) {
  const best = new Map<number, SecFact>();
  for (const f of facts) {
    if (!ANNUAL_FORMS.test(f.form) || (spec.instant ? !!f.start : !spansYear(f))) continue;
    // Spin-offs and new listings tag 0 shares and 0 EPS for the years before they existed.
    if ((spec.kind === "shares" && !(f.val > 0)) || (spec.kind === "perShare" && f.val === 0)) continue;
    const fy = yearOf(f.end);
    if (ends.get(fy) !== f.end || (spec.kind !== "money" && !factors.has(f.accn))) continue;
    const cur = best.get(fy);
    if (!cur || f.filed > cur.filed) best.set(fy, f);
  }
  const out = new Map<number, number>();
  for (const [fy, f] of best) {
    const k = factors.get(f.accn) ?? 1;
    out.set(fy, spec.kind === "perShare" ? f.val / k : spec.kind === "shares" ? f.val * k : f.val);
  }
  return out;
}

function candidateSeries(cand: Candidate, series: (concept: string) => Map<number, number>, abs?: true) {
  const out = new Map<number, number>();
  const [first, ...rest] = cand;
  if (!first) return out;
  const partAt = (part: Candidate[number], fy: number) => part.any.map((k) => series(k).get(fy)).find(isNum);
  const years = new Set(first.any.flatMap((k) => [...series(k).keys()]));
  for (const fy of years) {
    const base = partAt(first, fy);
    if (!isNum(base) || rest.some((part) => part.required && !isNum(partAt(part, fy)))) continue;
    const v = rest.reduce((sum, part) => sum + (part.minus ? -1 : 1) * (partAt(part, fy) ?? 0), base);
    out.set(fy, abs ? Math.abs(v) : v);
  }
  return out;
}

/**
 * The candidate that joins Yahoo, then older years: from the same candidate, or from another that agrees with it on
 * the newest year they share. Undefined when nothing matches Yahoo. By default the first candidate that matches in the
 * oldest shared year joins; with `most`, the one that matches in the most shared years, at least 3 of 4 of them.
 */
function join(candidates: Map<number, number>[], yahoo: Map<number, number>, abs: number, most = false) {
  const years = [...yahoo.keys()].sort((a, b) => a - b);
  let cur = -1;
  let seam = 0;
  let best = 0;
  for (const [i, c] of candidates.entries()) {
    const shared = years.filter((y) => c.has(y));
    if (!shared.length) continue;
    const matches = (y: number) => close(c.get(y) as number, yahoo.get(y) as number, abs);
    const hits = most ? shared.filter(matches).length : 0;
    if (most ? hits <= best || hits < Math.ceil(shared.length * MOST) : !matches(shared[0]!)) continue;
    cur = i;
    seam = shared[0]!;
    best = hits;
    if (!most) break;
  }
  if (cur < 0) return undefined;
  const out = new Map([...(candidates[cur] as Map<number, number>)].filter(([fy]) => fy >= seam));
  const older = [...new Set(candidates.flatMap((c) => [...c.keys()]))].filter((fy) => fy < seam).sort((a, b) => b - a);
  for (const fy of older) {
    if (!candidates[cur]!.has(fy)) {
      const next = candidates.findIndex((c, i) => i !== cur && c.has(fy) && agree(c, candidates[cur]!, abs));
      if (next < 0) continue;
      cur = next;
    }
    out.set(fy, candidates[cur]!.get(fy) as number);
  }
  return out;
}

/** Diluted EPS times diluted shares should give net income. Allows half a cent per share of rounding, and up to 2× for two-class and partnership structures. */
function perShareFits(eps: number, shares: number, netIncome: number) {
  const ratio = (eps * shares) / netIncome;
  return Math.abs(eps * shares - netIncome) <= 0.005 * shares || (ratio >= 0.5 && ratio <= 2);
}

function agree(a: Map<number, number>, b: Map<number, number>, abs: number) {
  const shared = [...a.keys()].filter((fy) => b.has(fy)).sort((x, y) => y - x)[0];
  return shared !== undefined && close(a.get(shared) as number, b.get(shared) as number, abs);
}
