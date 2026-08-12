import { NextResponse } from "next/server";
import { storageMode } from "@/lib/store";

export async function GET() {
  const mode = storageMode();
  const multiDevice =
    mode === "supabase"
      ? "yes — shared Supabase Postgres"
      : mode === "redis"
        ? "yes — shared Redis"
        : mode === "file"
          ? "yes — same server (local file)"
          : "limited — add Supabase env vars for multi-device";

  let hint: string | undefined;
  if (mode === "memory-vercel") {
    hint =
      "Add SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (run supabase/schema.sql first)";
  }

  return NextResponse.json({
    ok: true,
    storage: mode,
    multiDevice,
    hint,
  });
}
