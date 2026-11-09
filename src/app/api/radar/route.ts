import latest from "@/data/snapshots/latest.json";
import { analyzeLongTerm } from "@/lib/analyze";
import { fail, json } from "@/lib/api";
import { DEMO_SYMBOLS, demoMode } from "@/lib/data";
import { rank, type Snapshot, toRow } from "@/lib/snapshot";

/** The weekly snapshot (committed by the scan workflow). In demo mode, built live from the sample companies. */
export async function GET() {
  try {
    if (demoMode()) {
      const rows = await Promise.all(DEMO_SYMBOLS.map(async (s) => toRow(await analyzeLongTerm(s), ["DEMO"])));
      const snap: Snapshot = {
        date: new Date().toISOString().slice(0, 10), generatedAt: new Date().toISOString(), universe: "Demo companies",
        attempted: rows.length, rows: rank(rows), failed: [],
      };
      return json(snap, 60);
    }
    return json(latest as Snapshot, 60 * 60);
  } catch (e) {
    return fail(e);
  }
}
