import { NextRequest, NextResponse } from "next/server";
import type { DayOfWeek } from "@/lib/types";
import {
  clearDaySubjectPriority,
  getPriorityCalendar,
  getSchoolYearCalendar,
  setDaySubjectPriority,
  setWeekSubjectPriority,
} from "@/lib/store";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  const view = (req.nextUrl.searchParams.get("view") || "week") as
    | "month"
    | "week";
  const year = req.nextUrl.searchParams.get("year");
  const month = req.nextUrl.searchParams.get("month");
  const weekOf = req.nextUrl.searchParams.get("weekOf");
  const teacherId = req.nextUrl.searchParams.get("teacherId");
  const yearCal = req.nextUrl.searchParams.get("yearCal");

  // Full school-year calendar (month / week)
  if (yearCal === "1" || year || month || (view === "month" && !sessionId)) {
    const calendar = await getSchoolYearCalendar({
      view: view === "month" ? "month" : "week",
      year: year ? Number(year) : undefined,
      month: month ? Number(month) : undefined,
      weekOf: weekOf || undefined,
      teacherId: teacherId || undefined,
    });
    return NextResponse.json({ calendar, mode: "year" });
  }

  // Session week (legacy strip)
  if (sessionId) {
    const calendar = await getPriorityCalendar(sessionId);
    return NextResponse.json({ calendar, mode: "session" });
  }

  // Default: school year week around today
  const calendar = await getSchoolYearCalendar({
    view: "week",
    weekOf: weekOf || undefined,
    teacherId: teacherId || undefined,
  });
  return NextResponse.json({ calendar, mode: "year" });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      action,
      sessionId,
      day,
      date,
      weekOf,
      subjectOrder,
      note,
      primarySubject,
      dayType,
    } = body as {
      action?: string;
      sessionId?: string;
      day?: DayOfWeek;
      date?: string;
      weekOf?: string;
      subjectOrder?: string[];
      primarySubject?: string;
      note?: string;
      dayType?: "tutorial" | "no_tutorial" | "special";
    };

    let order = (subjectOrder || []).map((s) => s.trim()).filter(Boolean);
    if (primarySubject?.trim() && order.length === 0) {
      order = [primarySubject.trim()];
    } else if (
      primarySubject?.trim() &&
      !order.includes(primarySubject.trim())
    ) {
      order = [primarySubject.trim(), ...order];
    }

    if (action === "set_week") {
      if (order.length === 0) {
        return NextResponse.json(
          { error: "subjectOrder or primarySubject required" },
          { status: 400 }
        );
      }
      await setWeekSubjectPriority({
        sessionId,
        weekOf,
        subjectOrder: order,
        note,
      });
    } else if (action === "clear_day") {
      if (date) {
        await clearDaySubjectPriority(date);
      } else if (sessionId && day) {
        await clearDaySubjectPriority(sessionId, day);
      } else {
        return NextResponse.json(
          { error: "date or sessionId+day required" },
          { status: 400 }
        );
      }
    } else {
      // set day by date (preferred) or session+day
      if (order.length === 0 && dayType !== "no_tutorial") {
        return NextResponse.json(
          { error: "subjectOrder or primarySubject required" },
          { status: 400 }
        );
      }
      if (!date && !(sessionId && day)) {
        return NextResponse.json(
          { error: "date or sessionId+day required" },
          { status: 400 }
        );
      }
      await setDaySubjectPriority({
        sessionId,
        date,
        day,
        subjectOrder: order,
        note,
        dayType,
      });
    }

    // Return year calendar focused on the edited week/date
    const focusWeek =
      weekOf ||
      (date
        ? date.slice(0, 8) +
          String(
            Math.max(
              1,
              new Date(date + "T12:00:00").getDate() -
                ((new Date(date + "T12:00:00").getDay() + 6) % 7)
            )
          ).padStart(2, "0")
        : undefined);

    // simpler: use monday of date
    const { mondayOfWeek } = await import("@/lib/dates");
    const wo = weekOf || (date ? mondayOfWeek(new Date(date + "T12:00:00")) : undefined);

    if (sessionId && !date) {
      const calendar = await getPriorityCalendar(sessionId);
      return NextResponse.json({ calendar, mode: "session" });
    }

    const calendar = await getSchoolYearCalendar({
      view: "week",
      weekOf: wo,
    });
    return NextResponse.json({ calendar, mode: "year" });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
