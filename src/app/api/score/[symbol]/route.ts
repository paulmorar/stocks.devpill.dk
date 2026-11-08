import { analyzeLongTerm } from "@/lib/analyze";
import { cleanSymbol, fail, json } from "@/lib/api";

export const maxDuration = 30;

export async function GET(_req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const symbol = cleanSymbol((await ctx.params).symbol);
  if (!symbol) return fail(new Error("Invalid symbol"), 400);
  try {
    return json(await analyzeLongTerm(symbol), 60 * 30);
  } catch (e) {
    return fail(e);
  }
}
