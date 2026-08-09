import { NextRequest, NextResponse } from "next/server";
import {
  adminPasswordRequired,
  verifyAdminPassword,
} from "@/lib/adminAuth";
import { createPerson, getPerson } from "@/lib/store";

/** Register or resume as admin / teacher / student portal identity */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, role, personId, roomName, password } = body as {
      name?: string;
      role?: "admin" | "teacher" | "student";
      personId?: string;
      roomName?: string;
      password?: string;
    };

    if (personId) {
      const existing = await getPerson(personId);
      if (!existing) {
        return NextResponse.json({ error: "Person not found" }, { status: 404 });
      }
      // Re-auth admins when a site password is configured
      if (existing.role === "admin") {
        const check = verifyAdminPassword(password);
        if (!check.ok) {
          return NextResponse.json(
            { error: check.error || "Admin password required." },
            { status: 401 }
          );
        }
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

    if (role === "admin") {
      const check = verifyAdminPassword(password);
      if (!check.ok) {
        return NextResponse.json(
          { error: check.error || "Admin password required." },
          { status: 401 }
        );
      }
    }

    const result = await createPerson(name, role, roomName);
    if (result && typeof result === "object" && "error" in result) {
      return NextResponse.json(
        {
          error: result.error,
          // Do not list bootstrap names when password is set (reduces name guessing)
          ...(adminPasswordRequired()
            ? {}
            : { hint: "Use an authorized admin name, or ask an existing admin to grant access." }),
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
    // Public: only whether password is required — never list authorized names
    return NextResponse.json({
      passwordRequired: adminPasswordRequired(),
    });
  }
  const person = await getPerson(id);
  if (!person) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ person });
}
