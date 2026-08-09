import { NextRequest, NextResponse } from "next/server";
import type { AttendanceStatus, DayOfWeek } from "@/lib/types";
import { bulkMarkAttendance, getTeacherDayRoster, markAttendance } from "@/lib/store";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  const teacherId = req.nextUrl.searchParams.get("teacherId");
  const day = req.nextUrl.searchParams.get("day") as DayOfWeek | null;

  if (!sessionId || !teacherId || !day) {
    return NextResponse.json(
      { error: "sessionId, teacherId, day required" },
      { status: 400 }
    );
  }

  const roster = await getTeacherDayRoster(sessionId, teacherId, day);
  return NextResponse.json({ roster });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (Array.isArray(body.marks)) {
      const { sessionId, teacherId, day, marks, markedBy } = body as {
        sessionId?: string;
        teacherId?: string;
        day?: DayOfWeek;
        marks?: { studentId: string; status: AttendanceStatus }[];
        markedBy?: string;
      };
      if (!sessionId || !teacherId || !day || !marks || !markedBy) {
        return NextResponse.json(
          { error: "sessionId, teacherId, day, marks, markedBy required" },
          { status: 400 }
        );
      }
      const count = await bulkMarkAttendance({
        sessionId,
        teacherId,
        day,
        marks,
        markedBy,
      });
      return NextResponse.json({ count });
    }

    const { sessionId, teacherId, studentId, day, status, markedBy } = body as {
      sessionId?: string;
      teacherId?: string;
      studentId?: string;
      day?: DayOfWeek;
      status?: AttendanceStatus;
      markedBy?: string;
    };

    if (!sessionId || !teacherId || !studentId || !day || !status || !markedBy) {
      return NextResponse.json(
        {
          error:
            "sessionId, teacherId, studentId, day, status, markedBy required",
        },
        { status: 400 }
      );
    }

    const record = await markAttendance({
      sessionId,
      teacherId,
      studentId,
      day,
      status,
      markedBy,
    });
    if (!record) {
      return NextResponse.json({ error: "Failed to mark" }, { status: 400 });
    }
    return NextResponse.json({ record });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
