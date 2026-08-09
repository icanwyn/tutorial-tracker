import { NextRequest, NextResponse } from "next/server";
import type { DayOfWeek, GradeLevel } from "@/lib/types";
import {
  findOrCreateStudent,
  getStudent,
  listOpenStudyRooms,
  listStudents,
  getActiveSessions,
  getStudentSchedule,
  getStudentDayChoices,
  setStudentGrade,
  importSchoolDirectory,
} from "@/lib/store";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  const openStudy = req.nextUrl.searchParams.get("openStudy");
  const day = req.nextUrl.searchParams.get("day") as DayOfWeek | null;
  const grade = req.nextUrl.searchParams.get("grade") as GradeLevel | null;
  const q = req.nextUrl.searchParams.get("q");

  if (openStudy === "1" && sessionId) {
    const rooms = await listOpenStudyRooms(
      sessionId,
      day || undefined,
      grade || undefined
    );
    return NextResponse.json({ rooms });
  }

  if (id) {
    const student = await getStudent(id);
    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }
    let schedule = null;
    let choices = null;
    const sessions = await getActiveSessions();
    const sid = sessionId || sessions[0]?.id;
    if (sid) {
      schedule = await getStudentSchedule(sid, id);
      choices = await getStudentDayChoices(sid, id);
    }
    return NextResponse.json({
      student,
      schedule,
      choices,
      sessions,
    });
  }

  const students = await listStudents(q || undefined);
  return NextResponse.json({ students, count: students.length });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { firstName, lastName, studentId, grade, action, id, rows } = body as {
      firstName?: string;
      lastName?: string;
      studentId?: string;
      grade?: GradeLevel | null;
      action?: string;
      id?: string;
      rows?: {
        firstName: string;
        lastName: string;
        studentId?: string;
        grade?: GradeLevel | null;
      }[];
    };

    if (action === "set_grade" && id) {
      const student = await setStudentGrade(id, grade ?? null);
      if (!student) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return NextResponse.json({ student });
    }

    /** Schoolwide directory import (admin) — one student, many class lists later */
    if (action === "import_directory") {
      if (!Array.isArray(rows)) {
        return NextResponse.json({ error: "rows[] required" }, { status: 400 });
      }
      const result = await importSchoolDirectory(rows);
      const students = await listStudents();
      return NextResponse.json({ ...result, students });
    }

    if (!firstName?.trim() || !lastName?.trim()) {
      return NextResponse.json(
        { error: "firstName and lastName required" },
        { status: 400 }
      );
    }

    const student = await findOrCreateStudent(firstName, lastName, studentId);
    if (grade === "7" || grade === "8") {
      await setStudentGrade(student.id, grade);
      student.grade = grade;
    }
    return NextResponse.json({ student });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
