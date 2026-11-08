import { search } from "@/lib/data";
import { fail, json } from "@/lib/api";

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 40);
  if (q.length < 1) return json([], 60);
  try {
    return json(await search(q), 60 * 60);
  } catch (e) {
    return fail(e);
  }
}
