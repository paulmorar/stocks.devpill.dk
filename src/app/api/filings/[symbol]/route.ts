import { cleanSymbol, fail, json } from "@/lib/api";
import { getFilings } from "@/lib/data/sec";

export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const symbol = cleanSymbol((await ctx.params).symbol);
  if (!symbol) return fail(new Error("Invalid symbol"), 400);
  try {
    const result = await getFilings(symbol);
    return json(result, result.status === "ok" ? 60 * 60 : 60 * 5);
  } catch (e) {
    return fail(e);
  }
}
