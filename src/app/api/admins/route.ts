import { NextRequest, NextResponse } from "next/server";
import {
  grantAdminAccess,
  listAdminGrants,
  revokeAdminAccess,
} from "@/lib/store";
import { getBootstrapAdminNames } from "@/lib/bootstrap";

export async function GET() {
  const grants = await listAdminGrants();
  return NextResponse.json({
    grants,
    bootstrapAdmins: getBootstrapAdminNames(),
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, grantedById } = body as {
      name?: string;
      grantedById?: string;
    };
    if (!name?.trim() || !grantedById) {
      return NextResponse.json(
        { error: "name and grantedById required" },
        { status: 400 }
      );
    }
    const result = await grantAdminAccess({ name, grantedById });
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 403 });
    }
    const grants = await listAdminGrants();
    return NextResponse.json({ grant: result, grants });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const { grantId, byAdminId } = body as {
      grantId?: string;
      byAdminId?: string;
    };
    if (!grantId || !byAdminId) {
      return NextResponse.json(
        { error: "grantId and byAdminId required" },
        { status: 400 }
      );
    }
    const result = await revokeAdminAccess(grantId, byAdminId);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 403 });
    }
    const grants = await listAdminGrants();
    return NextResponse.json({ ok: true, grants });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
