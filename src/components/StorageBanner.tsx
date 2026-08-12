"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";

type Health = {
  storage: string;
  multiDevice: string;
  hint?: string;
  envConfigured?: Record<string, boolean>;
};

/** Warn admins/teachers when the live site is not using shared Supabase data */
export function StorageBanner() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    void api<Health>("/api/health")
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  if (!health) return null;
  if (health.storage === "supabase" || health.storage === "redis") {
    return null;
  }
  if (health.storage === "file") {
    return (
      <div
        className="muted"
        style={{
          fontSize: "0.8rem",
          padding: "0.5rem 0.75rem",
          borderRadius: 8,
          border: "1px solid var(--border)",
          background: "var(--surface)",
        }}
      >
        Storage: local file (fine on one server). For phones + Vercel use
        Supabase.
      </div>
    );
  }

  return (
    <div className="error-banner" style={{ marginBottom: "1rem" }}>
      <strong>Shared database not connected on this server.</strong>
      <div style={{ marginTop: 6, fontSize: "0.9rem" }}>
        Admin and teachers will not see the same sessions.{" "}
        {health.hint ||
          "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on Vercel, then redeploy."}
      </div>
      <div className="muted" style={{ marginTop: 6, fontSize: "0.8rem" }}>
        storage={health.storage} · {health.multiDevice}
      </div>
    </div>
  );
}
