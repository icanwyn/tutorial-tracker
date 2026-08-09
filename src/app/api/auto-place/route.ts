import { NextRequest, NextResponse } from "next/server";
import type { DayOfWeek } from "@/lib/types";
import { autoPlaceUnassigned } from "@/lib/store";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { sessionId, day } = body as {
      sessionId?: string;
      day?: DayOfWeek;
    };
    if (!sessionId || !day) {
      return NextResponse.json(
        { error: "sessionId and day required" },
        { status: 400 }
      );
    }
    const result = await autoPlaceUnassigned({ sessionId, day });
    return NextResponse.json(result);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
