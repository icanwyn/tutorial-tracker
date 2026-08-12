import { promises as fs } from "fs";
import path from "path";
import type { Database } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "db.json");
/** Ephemeral path on Vercel serverless (not shared across instances) */
const TMP_DB_PATH = path.join("/tmp", "tutorial-tracker-db.json");
const REDIS_KEY = "tutorial-tracker:db";
const SUPABASE_ROW_ID = "main";

type GlobalCache = {
  __ttDb?: Database;
  __ttWriteQueue?: Promise<void>;
};

const g = globalThis as typeof globalThis & GlobalCache;

export function emptyDb(): Database {
  return {
    people: [],
    sessions: [],
    teacherJoins: [],
    students: [],
    roster: [],
    teacherClassLists: [],
    assignments: [],
    attendance: [],
    priorities: [],
    offerings: [],
    teacherOffers: [],
    dayPriorities: [],
    adminGrants: [],
    studentChoices: [],
  };
}

export function hasSupabase(): boolean {
  return !!(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

export function hasRedis(): boolean {
  return !!(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  );
}

export function isVercel(): boolean {
  return process.env.VERCEL === "1" || !!process.env.VERCEL_ENV;
}

function dbPath(): string {
  if (isVercel() && !hasSupabase() && !hasRedis()) return TMP_DB_PATH;
  return DB_PATH;
}

async function readFileDb(file: string): Promise<Database | null> {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as Database;
  } catch {
    return null;
  }
}

async function writeFileDb(file: string, db: Database): Promise<void> {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, JSON.stringify(db, null, 2), "utf8");
}

function supabaseUrl(): string {
  return (
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    ""
  ).trim();
}

async function getSupabaseAdmin() {
  const { createClient } = await import("@supabase/supabase-js");
  const url = supabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!.trim();
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function readSupabase(): Promise<Database | null> {
  if (!hasSupabase()) return null;
  const supabase = await getSupabaseAdmin();
  const { data, error } = await supabase
    .from("app_state")
    .select("data")
    .eq("id", SUPABASE_ROW_ID)
    .maybeSingle();

  if (error) {
    console.error("[tutorial-tracker] Supabase read error:", error.message);
    throw new Error(
      `Supabase read failed: ${error.message}. Did you run supabase/schema.sql?`
    );
  }
  if (!data?.data || typeof data.data !== "object") return null;
  return data.data as Database;
}

async function writeSupabase(db: Database): Promise<void> {
  const supabase = await getSupabaseAdmin();
  const { error } = await supabase.from("app_state").upsert(
    {
      id: SUPABASE_ROW_ID,
      data: db,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );
  if (error) {
    console.error("[tutorial-tracker] Supabase write error:", error.message);
    throw new Error(`Supabase write failed: ${error.message}`);
  }
}

async function readRedis(): Promise<Database | null> {
  if (!hasRedis()) return null;
  const { Redis } = await import("@upstash/redis");
  const redis = Redis.fromEnv();
  const data = await redis.get<Database>(REDIS_KEY);
  if (!data || typeof data !== "object") return null;
  return data;
}

async function writeRedis(db: Database): Promise<void> {
  const { Redis } = await import("@upstash/redis");
  const redis = Redis.fromEnv();
  await redis.set(REDIS_KEY, db);
}

/**
 * Load the shared school database.
 *
 * Priority: Supabase → Redis → local file → Vercel memory/tmp
 */
export async function loadRawDb(): Promise<Database> {
  if (hasSupabase()) {
    const fromSb = await readSupabase();
    if (fromSb) {
      g.__ttDb = fromSb;
      return fromSb;
    }
    const empty = emptyDb();
    g.__ttDb = empty;
    // Ensure row exists
    try {
      await writeSupabase(empty);
    } catch {
      /* first write may fail if table missing — surface on next write */
    }
    return empty;
  }

  if (hasRedis()) {
    const fromRedis = await readRedis();
    if (fromRedis) {
      g.__ttDb = fromRedis;
      return fromRedis;
    }
    const empty = emptyDb();
    g.__ttDb = empty;
    return empty;
  }

  if (g.__ttDb) return g.__ttDb;

  const fromFile = await readFileDb(dbPath());
  const fallback =
    fromFile ||
    (dbPath() !== DB_PATH ? await readFileDb(DB_PATH) : null);

  const db = fallback || emptyDb();
  g.__ttDb = db;
  return db;
}

export async function saveRawDb(db: Database): Promise<void> {
  g.__ttDb = db;

  if (hasSupabase()) {
    await writeSupabase(db);
    return;
  }

  if (hasRedis()) {
    await writeRedis(db);
    return;
  }

  try {
    await writeFileDb(dbPath(), db);
  } catch (err) {
    console.warn(
      "[tutorial-tracker] Could not write DB file — using memory only:",
      err instanceof Error ? err.message : err
    );
  }
}

/** Serialize mutations so concurrent requests don't clobber data. */
export async function withDbLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = g.__ttWriteQueue || Promise.resolve();
  let release!: () => void;
  g.__ttWriteQueue = new Promise<void>((r) => {
    release = r;
  });
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

export function storageMode():
  | "supabase"
  | "redis"
  | "file"
  | "memory-vercel" {
  if (hasSupabase()) return "supabase";
  if (hasRedis()) return "redis";
  if (isVercel()) return "memory-vercel";
  return "file";
}
