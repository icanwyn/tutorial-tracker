import { NextResponse } from "next/server";
import { storageMode } from "@/lib/store";

export async function GET() {
  const mode = storageMode();
  return NextResponse.json({
    ok: true,
    storage: mode,
    multiDevice:
      mode === "redis"
        ? "yes — shared Redis"
        : mode === "file"
          ? "yes — same server (local file)"
          : "limited — Vercel without Redis does not share data across devices reliably",
    hint:
      mode === "memory-vercel"
        ? "Add UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in Vercel env for multi-device testing"
        : undefined,
  });
}
