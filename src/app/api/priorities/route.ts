import { NextRequest, NextResponse } from "next/server";
import {
  listPriorities,
  uploadPriorities,
  type PriorityUploadRow,
} from "@/lib/store";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }
  const priorities = await listPriorities(sessionId);
  return NextResponse.json({ priorities });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { sessionId, rows } = body as {
      sessionId?: string;
      rows?: PriorityUploadRow[];
    };

    if (!sessionId || !Array.isArray(rows)) {
      return NextResponse.json(
        { error: "sessionId and rows[] are required" },
        { status: 400 }
      );
    }

    const result = await uploadPriorities(sessionId, rows);
    const priorities = await listPriorities(sessionId);
    return NextResponse.json({ ...result, priorities });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
