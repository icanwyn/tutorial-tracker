import { NextRequest, NextResponse } from "next/server";
import { createPerson, getPerson } from "@/lib/store";
import { getBootstrapAdminNames } from "@/lib/bootstrap";

/** Register or resume as admin / teacher / student portal identity */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, role, personId, roomName } = body as {
      name?: string;
      role?: "admin" | "teacher" | "student";
      personId?: string;
      roomName?: string;
    };

    if (personId) {
      const existing = await getPerson(personId);
      if (!existing) {
        return NextResponse.json({ error: "Person not found" }, { status: 404 });
      }
      return NextResponse.json({ person: existing });
    }

    if (!name?.trim() || !role) {
      return NextResponse.json(
        { error: "name and role are required" },
        { status: 400 }
      );
    }

    if (!["admin", "teacher", "student"].includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    const result = await createPerson(name, role, roomName);
    if (result && typeof result === "object" && "error" in result) {
      return NextResponse.json(
        {
          error: result.error,
          bootstrapAdmins: getBootstrapAdminNames(),
        },
        { status: 403 }
      );
    }
    return NextResponse.json({ person: result });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json(
      { bootstrapAdmins: getBootstrapAdminNames() },
      { status: 200 }
    );
  }
  const person = await getPerson(id);
  if (!person) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ person });
}
