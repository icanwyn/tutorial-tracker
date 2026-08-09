import { NextRequest, NextResponse } from "next/server";
import type { DayOfWeek } from "@/lib/types";
import {
  clearStudentSelection,
  getStudentDayChoices,
  getStudentSchedule,
  getTeacherAssignments,
  getTeacherDayRoster,
  removeAssignment,
  saveStudentChoice,
  setAssignments,
  studentSelfSignup,
} from "@/lib/store";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  const teacherId = req.nextUrl.searchParams.get("teacherId");
  const studentId = req.nextUrl.searchParams.get("studentId");
  const day = req.nextUrl.searchParams.get("day") as DayOfWeek | null;

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  if (studentId) {
    const schedule = await getStudentSchedule(sessionId, studentId);
    const choices = await getStudentDayChoices(sessionId, studentId);
    return NextResponse.json({ schedule, choices });
  }

  if (teacherId && day) {
    const roster = await getTeacherDayRoster(sessionId, teacherId, day);
    return NextResponse.json({ roster });
  }

  if (teacherId) {
    const assignments = await getTeacherAssignments(sessionId, teacherId);
    return NextResponse.json({ assignments });
  }

  return NextResponse.json(
    { error: "Provide teacherId, teacherId+day, or studentId" },
    { status: 400 }
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body as { action?: string };

    if (action === "self_signup") {
      const { sessionId, studentId, teacherId, day, offerId } = body as {
        sessionId?: string;
        studentId?: string;
        teacherId?: string;
        day?: DayOfWeek;
        offerId?: string;
      };
      if (!sessionId || !studentId || !day || (!teacherId && !offerId)) {
        return NextResponse.json(
          { error: "sessionId, studentId, day, and teacherId or offerId required" },
          { status: 400 }
        );
      }
      const result = await studentSelfSignup({
        sessionId,
        studentId,
        teacherId: teacherId || "",
        day,
        offerId,
      });
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json({ assignment: result.assignment });
    }

    if (action === "student_choice") {
      const { sessionId, studentId, teacherId, day } = body as {
        sessionId?: string;
        studentId?: string;
        teacherId?: string;
        day?: DayOfWeek;
      };
      if (!sessionId || !studentId || !teacherId || !day) {
        return NextResponse.json(
          { error: "sessionId, studentId, teacherId, day required" },
          { status: 400 }
        );
      }
      const result = await saveStudentChoice({
        sessionId,
        studentId,
        teacherId,
        day,
      });
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json({
        ok: true,
        choice: result.choice,
        editExpiresAt: result.editExpiresAt,
      });
    }

    if (action === "clear_selection") {
      const { sessionId, studentId, day } = body as {
        sessionId?: string;
        studentId?: string;
        day?: DayOfWeek;
      };
      if (!sessionId || !studentId || !day) {
        return NextResponse.json(
          { error: "sessionId, studentId, day required" },
          { status: 400 }
        );
      }
      const result = await clearStudentSelection({
        sessionId,
        studentId,
        day,
      });
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }

    // Teacher assigns students to tutorial days
    const { sessionId, teacherId, studentIds, days, type } = body as {
      sessionId?: string;
      teacherId?: string;
      studentIds?: string[];
      days?: DayOfWeek[];
      type?: "required" | "open_study";
    };

    if (
      !sessionId ||
      !teacherId ||
      !Array.isArray(studentIds) ||
      !Array.isArray(days) ||
      studentIds.length === 0 ||
      days.length === 0
    ) {
      return NextResponse.json(
        { error: "sessionId, teacherId, studentIds[], days[] required" },
        { status: 400 }
      );
    }

    const result = await setAssignments({
      sessionId,
      teacherId,
      studentIds,
      days,
      type: type || "required",
    });
    return NextResponse.json({
      ...result,
      count: result.created.length,
      wonCount: result.won.length,
      lostCount: result.lost.length,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const { sessionId, teacherId, studentId, day } = body as {
      sessionId?: string;
      teacherId?: string;
      studentId?: string;
      day?: DayOfWeek;
    };
    if (!sessionId || !teacherId || !studentId || !day) {
      return NextResponse.json(
        { error: "sessionId, teacherId, studentId, day required" },
        { status: 400 }
      );
    }
    const ok = await removeAssignment(sessionId, teacherId, studentId, day);
    return NextResponse.json({ ok });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
