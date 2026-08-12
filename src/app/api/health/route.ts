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

  const envHints = {
    SUPABASE_URL: !!(
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
    ),
    /** Common typo people make on Vercel */
    UPABASE_URL_typo: !!process.env.UPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    ADMIN_PASSWORD: !!process.env.ADMIN_PASSWORD,
  };

  let hint: string | undefined;
  if (mode === "memory-vercel") {
    if (envHints.UPABASE_URL_typo && !envHints.SUPABASE_URL) {
      hint =
        "Vercel env is named UPABASE_URL (missing S). Rename to SUPABASE_URL and redeploy.";
    } else if (!envHints.SUPABASE_URL || !envHints.SUPABASE_SERVICE_ROLE_KEY) {
      hint =
        "Add SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in Vercel → Settings → Environment Variables, then Redeploy.";
    } else {
      hint = "Supabase env present but storage still memory — redeploy after saving env vars.";
    }
  }

  return NextResponse.json({
    ok: true,
    storage: mode,
    multiDevice,
    envConfigured: envHints,
    hint,
  });
}
