import { getScreen, type ScreenId } from "@/lib/data";
import { fail, json } from "@/lib/api";

const ALLOWED: ScreenId[] = [
  "day_gainers", "day_losers", "most_actives", "undervalued_large_caps", "undervalued_growth_stocks",
  "growth_technology_stocks", "portfolio_anchors", "aggressive_small_caps", "small_cap_gainers",
];

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") as ScreenId;
  const count = Math.min(50, Math.max(5, Number(url.searchParams.get("count") ?? 25) || 25));
  if (!ALLOWED.includes(id)) return fail(new Error(`Unknown screen. Use one of: ${ALLOWED.join(", ")}`), 400);
  try {
    return json(await getScreen(id, count), 60 * 5);
  } catch (e) {
    return fail(e);
  }
}
