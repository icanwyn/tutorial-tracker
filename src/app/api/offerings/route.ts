import { NextRequest, NextResponse } from "next/server";
import {
  deleteOffering,
  listOfferings,
  upsertOffering,
} from "@/lib/store";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }
  const offerings = await listOfferings(sessionId);
  return NextResponse.json({ offerings });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      sessionId,
      id,
      name,
      subject,
      description,
      priority,
      defaultCapacity,
    } = body as {
      sessionId?: string;
      id?: string;
      name?: string;
      subject?: string;
      description?: string;
      priority?: number;
      defaultCapacity?: number;
    };

    if (!sessionId || !name?.trim() || !subject?.trim()) {
      return NextResponse.json(
        { error: "sessionId, name, and subject are required" },
        { status: 400 }
      );
    }

    const offering = await upsertOffering({
      sessionId,
      id,
      name,
      subject,
      description,
      priority: priority ?? 1,
      defaultCapacity: defaultCapacity ?? 30,
    });
    const offerings = await listOfferings(sessionId);
    return NextResponse.json({ offering, offerings });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, sessionId } = body as { id?: string; sessionId?: string };
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    await deleteOffering(id);
    const offerings = sessionId ? await listOfferings(sessionId) : [];
    return NextResponse.json({ ok: true, offerings });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
