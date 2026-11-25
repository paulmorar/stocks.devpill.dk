import { DEMO_SYMBOLS, demoMode } from "@/lib/data";
import { fmpEnabled } from "@/lib/data/fmp";
import { secUserAgent } from "@/lib/data/sec-map";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ demo: demoMode(), fmp: fmpEnabled(), sec: !!secUserAgent(), demoSymbols: DEMO_SYMBOLS });
}
