import { NextRequest, NextResponse } from "next/server";
import {
  closeSession,
  getSession,
  listTeachersInSession,
  reopenSession,
} from "@/lib/store";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const teachers = await listTeachersInSession(id);
  return NextResponse.json({ session, teachers });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  if (body.action === "close") {
    const session = await closeSession(id);
    if (!session) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ session });
  }
  if (body.action === "reopen") {
    const session = await reopenSession(id);
    if (!session) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ session });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
