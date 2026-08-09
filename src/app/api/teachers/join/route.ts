import { NextRequest, NextResponse } from "next/server";
import { loginTeacher, updateTeacherRoomSettings } from "@/lib/store";

/**
 * Teacher join / rejoin.
 * Same name + join code restores the same teacher identity so class lists persist.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      joinCode,
      name,
      roomName,
      isOpenStudy,
      accessMode,
      offeringId,
      capacity,
      teacherId,
      personId,
    } = body as {
      joinCode?: string;
      name?: string;
      roomName?: string;
      isOpenStudy?: boolean;
      accessMode?: "open" | "closed";
      offeringId?: string | null;
      capacity?: number;
      teacherId?: string;
      personId?: string;
    };

    if (!joinCode?.trim() || !name?.trim()) {
      return NextResponse.json(
        { error: "joinCode and name are required" },
        { status: 400 }
      );
    }

    const result = await loginTeacher({
      name,
      joinCode,
      roomName: roomName || undefined,
      isOpenStudy: isOpenStudy,
      accessMode,
      offeringId,
      capacity,
      personId: personId || teacherId,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      person: result.person,
      session: result.session,
      join: result.join,
      restored: result.restored,
      rosterCount: result.rosterCount,
      offerCount: result.offerCount ?? 0,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      sessionId,
      teacherId,
      isOpenStudy,
      accessMode,
      offeringId,
      capacity,
      roomName,
    } = body as {
      sessionId?: string;
      teacherId?: string;
      isOpenStudy?: boolean;
      accessMode?: "open" | "closed";
      offeringId?: string | null;
      capacity?: number;
      roomName?: string;
    };

    if (!sessionId || !teacherId) {
      return NextResponse.json(
        { error: "sessionId and teacherId required" },
        { status: 400 }
      );
    }

    const join = await updateTeacherRoomSettings({
      sessionId,
      teacherId,
      isOpenStudy,
      accessMode,
      offeringId,
      capacity,
      roomName,
    });
    if (!join) {
      return NextResponse.json({ error: "Join not found" }, { status: 404 });
    }
    return NextResponse.json({ join });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
