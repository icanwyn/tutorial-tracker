import { NextRequest, NextResponse } from "next/server";
import {
  createSession,
  getPerson,
  listSessions,
  getActiveSessions,
  resolveAdminSession,
} from "@/lib/store";

export async function GET(req: NextRequest) {
  const active = req.nextUrl.searchParams.get("active");
  const adminId = req.nextUrl.searchParams.get("adminId");
  const sessionId = req.nextUrl.searchParams.get("sessionId");

  if (adminId || sessionId) {
    const session = await resolveAdminSession({
      adminId: adminId || undefined,
      sessionId,
    });
    return NextResponse.json({ session, sessions: session ? [session] : [] });
  }

  const sessions =
    active === "1" ? await getActiveSessions() : await listSessions();
  return NextResponse.json({ sessions });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, adminId, weekOf } = body as {
      name?: string;
      adminId?: string;
      weekOf?: string;
    };

    if (!name?.trim() || !adminId) {
      return NextResponse.json(
        { error: "name and adminId are required" },
        { status: 400 }
      );
    }

    const admin = await getPerson(adminId);
    if (!admin || admin.role !== "admin") {
      return NextResponse.json(
        { error: "Only admins can start a session" },
        { status: 403 }
      );
    }

    const session = await createSession(name, adminId, weekOf);
    return NextResponse.json({ session });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
