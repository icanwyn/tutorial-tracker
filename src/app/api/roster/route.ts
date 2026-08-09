import { NextRequest, NextResponse } from "next/server";
import {
  attachDirectoryToRoster,
  getTeacherRoster,
  uploadRoster,
  type RosterUploadRow,
} from "@/lib/store";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  const teacherId = req.nextUrl.searchParams.get("teacherId");
  if (!sessionId || !teacherId) {
    return NextResponse.json(
      { error: "sessionId and teacherId required" },
      { status: 400 }
    );
  }
  const roster = await getTeacherRoster(sessionId, teacherId);
  return NextResponse.json({ roster });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, sessionId, teacherId, rows, studentIds, period, subject } =
      body as {
        action?: string;
        sessionId?: string;
        teacherId?: string;
        rows?: RosterUploadRow[];
        studentIds?: string[];
        period?: string;
        subject?: string;
      };

    if (!sessionId || !teacherId) {
      return NextResponse.json(
        { error: "sessionId and teacherId are required" },
        { status: 400 }
      );
    }

    // Pick existing schoolwide students (no new records)
    if (action === "from_directory") {
      if (!Array.isArray(studentIds) || studentIds.length === 0) {
        return NextResponse.json(
          { error: "studentIds[] required" },
          { status: 400 }
        );
      }
      const result = await attachDirectoryToRoster({
        sessionId,
        teacherId,
        studentIds,
        period: period || "—",
        subject: subject || "—",
      });
      return NextResponse.json(result);
    }

    if (!Array.isArray(rows)) {
      return NextResponse.json(
        { error: "rows[] are required" },
        { status: 400 }
      );
    }

    const result = await uploadRoster(sessionId, teacherId, rows);
    return NextResponse.json(result);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
