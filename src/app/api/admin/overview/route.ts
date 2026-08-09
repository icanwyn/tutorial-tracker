import { NextRequest, NextResponse } from "next/server";
import type { DayOfWeek } from "@/lib/types";
import { adminOverview } from "@/lib/store";
import { todayDay } from "@/lib/dates";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  const dayParam = req.nextUrl.searchParams.get("day") as DayOfWeek | null;
  const day = dayParam || todayDay() || "Mon";

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const overview = await adminOverview(sessionId, day);
  if (!overview) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  return NextResponse.json(overview);
}
