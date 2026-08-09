import { NextRequest, NextResponse } from "next/server";
import type { GradeLevel } from "@/lib/types";
import {
  deleteTeacherOffer,
  listCompiledOffers,
  listTeacherOffers,
  listTeacherOffersByRange,
  upsertTeacherOffer,
} from "@/lib/store";
import { schoolYearForDate } from "@/lib/dates";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  const teacherId = req.nextUrl.searchParams.get("teacherId");
  const compiled = req.nextUrl.searchParams.get("compiled");
  const weekOf = req.nextUrl.searchParams.get("weekOf");
  const startDate = req.nextUrl.searchParams.get("startDate");
  const endDate = req.nextUrl.searchParams.get("endDate");
  const yearRange = req.nextUrl.searchParams.get("year");

  if (yearRange === "1" || (startDate && endDate)) {
    const sy = schoolYearForDate();
    const offers = await listTeacherOffersByRange({
      teacherId: teacherId || undefined,
      startDate: startDate || sy.startDate,
      endDate: endDate || sy.endDate,
    });
    return NextResponse.json({ offers, schoolYear: sy });
  }

  if (compiled === "1") {
    if (!sessionId && !weekOf) {
      return NextResponse.json(
        { error: "sessionId or weekOf required" },
        { status: 400 }
      );
    }
    const board = await listCompiledOffers(sessionId || "", weekOf || undefined);
    return NextResponse.json(board);
  }

  if (sessionId) {
    const offers = await listTeacherOffers(
      sessionId,
      teacherId || undefined,
      weekOf || undefined
    );
    return NextResponse.json({ offers });
  }

  if (weekOf) {
    const offers = await listTeacherOffersByRange({
      teacherId: teacherId || undefined,
      startDate: weekOf,
      endDate: weekOf.slice(0, 8) + String(Number(weekOf.slice(8, 10)) + 4).padStart(2, "0"),
    });
    // fix end date properly
    const { dateForDay } = await import("@/lib/dates");
    const fri = dateForDay(weekOf, "Fri");
    const offers2 = await listTeacherOffersByRange({
      teacherId: teacherId || undefined,
      startDate: weekOf,
      endDate: fri,
    });
    return NextResponse.json({ offers: offers2 });
  }

  return NextResponse.json(
    { error: "sessionId, weekOf, or year=1 required" },
    { status: 400 }
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      id,
      sessionId,
      date,
      teacherId,
      grades,
      subject,
      unitTitle,
      accessMode,
      roomName,
      capacity,
    } = body as {
      id?: string;
      sessionId?: string;
      date?: string;
      teacherId?: string;
      grades?: GradeLevel[];
      subject?: string;
      unitTitle?: string;
      accessMode?: "open" | "closed";
      roomName?: string;
      capacity?: number;
    };

    if (!teacherId) {
      return NextResponse.json(
        { error: "teacherId required" },
        { status: 400 }
      );
    }

    const result = await upsertTeacherOffer({
      id,
      sessionId,
      date,
      teacherId,
      grades: grades || [],
      subject: subject || "",
      unitTitle: unitTitle || "",
      accessMode: accessMode || "closed",
      roomName: roomName || "",
      capacity,
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ offer: result });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, teacherId } = body as {
      id?: string;
      teacherId?: string;
    };
    if (!id || !teacherId) {
      return NextResponse.json(
        { error: "id and teacherId required" },
        { status: 400 }
      );
    }
    await deleteTeacherOffer(id, teacherId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
