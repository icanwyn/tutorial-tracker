import { promises as fs } from "fs";
import path from "path";
import type { Database } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "db.json");
/** Ephemeral path on Vercel serverless (not shared across instances) */
const TMP_DB_PATH = path.join("/tmp", "tutorial-tracker-db.json");
const REDIS_KEY = "tutorial-tracker:db";

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

export function hasRedis(): boolean {
  return !!(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  );
}

export function isVercel(): boolean {
  return process.env.VERCEL === "1" || !!process.env.VERCEL_ENV;
}

function dbPath(): string {
  // Prefer project data/ locally; on Vercel only /tmp is writable
  if (isVercel() && !hasRedis()) return TMP_DB_PATH;
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
 * - Local: `data/db.json`
 * - Vercel + Upstash: shared Redis (required for multi-device / multi-user)
 * - Vercel without Redis: in-memory + /tmp (NOT reliable across devices)
 */
export async function loadRawDb(): Promise<Database> {
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
  // Local: also try data/ if /tmp empty (shouldn't happen)
  const fallback =
    fromFile ||
    (dbPath() !== DB_PATH ? await readFileDb(DB_PATH) : null);

  const db = fallback || emptyDb();
  g.__ttDb = db;
  return db;
}

export async function saveRawDb(db: Database): Promise<void> {
  g.__ttDb = db;

  if (hasRedis()) {
    await writeRedis(db);
    return;
  }

  try {
    await writeFileDb(dbPath(), db);
  } catch (err) {
    // On locked filesystems, keep memory cache so single-instance still works
    console.warn(
      "[tutorial-tracker] Could not write DB file — using memory only:",
      err instanceof Error ? err.message : err
    );
  }
}

/** Serialize mutations so concurrent requests don't clobber data. */
export async function withDbLock<T>(
  fn: () => Promise<T>
): Promise<T> {
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

export function storageMode(): "redis" | "file" | "memory-vercel" {
  if (hasRedis()) return "redis";
  if (isVercel()) return "memory-vercel";
  return "file";
}
