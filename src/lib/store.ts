import type {
  AdminGrant,
  Assignment,
  AttendanceRecord,
  Database,
  DayOfWeek,
  Person,
  RosterEntry,
  Student,
  StudentChoice,
  TeacherJoin,
  DaySubjectPriority,
  TeacherClassListEntry,
  TeacherOffer,
  TutorialOffering,
  TutorialSession,
  WeeklyPriority,
  GradeLevel,
} from "./types";
import { DAYS, DEFAULT_SUBJECTS } from "./types";
import { joinCode, studentId, uid } from "./ids";
import {
  dateForDay,
  mondayOfWeek,
  formatWeekLabel,
  dayOfWeekFromDate,
  schoolYearForDate,
  monthGrid,
  addDays,
  formatMonthLabel,
  formatShortDate,
  todayISO,
  weeksInSchoolYear,
} from "./dates";
import { canBecomeAdmin, normAdminName } from "./adminAccess";
import { getBootstrapAdminNames } from "./bootstrap";
import {
  emptyDb,
  loadRawDb,
  saveRawDb,
  storageMode,
  withDbLock,
} from "./persistence";

export { storageMode } from "./persistence";

function normalizeTeacherJoin(j: TeacherJoin): TeacherJoin {
  const accessMode =
    j.accessMode || (j.isOpenStudy ? "open" : "closed");
  return {
    ...j,
    offeringId: j.offeringId ?? null,
    accessMode,
    capacity: typeof j.capacity === "number" && j.capacity > 0 ? j.capacity : 30,
    isOpenStudy: accessMode === "open",
  };
}

function normalizeDb(raw: Partial<Database> | null | undefined): Database {
  const base = emptyDb();
  if (!raw || typeof raw !== "object") return base;
  return {
    people: raw.people ?? [],
    sessions: raw.sessions ?? [],
    teacherJoins: (raw.teacherJoins ?? []).map((j) =>
      normalizeTeacherJoin(j as TeacherJoin)
    ),
    students: raw.students ?? [],
    roster: raw.roster ?? [],
    teacherClassLists: raw.teacherClassLists ?? [],
    assignments: raw.assignments ?? [],
    attendance: (raw.attendance ?? []).map((a) => ({
      ...a,
      markedByName: (a as AttendanceRecord).markedByName ?? null,
    })),
    priorities: raw.priorities ?? [],
    offerings: raw.offerings ?? [],
    teacherOffers: (raw.teacherOffers ?? []).map((o) => {
      const offer = o as TeacherOffer & { sessionId?: string; date?: string };
      // Legacy session-only offers: pin to Monday of that session week
      if (!offer.date && offer.sessionId) {
        const ses = (raw.sessions ?? []).find((s) => s.id === offer.sessionId);
        offer.date = ses?.weekOf || mondayOfWeek();
      }
      if (!offer.date) offer.date = mondayOfWeek();
      return offer as TeacherOffer;
    }),
    dayPriorities: (raw.dayPriorities ?? []).map((p) => {
      const pri = p as DaySubjectPriority;
      if (!pri.date && pri.sessionId) {
        const ses = (raw.sessions ?? []).find((s) => s.id === pri.sessionId);
        if (ses) pri.date = dateForDay(ses.weekOf, pri.day);
      }
      if (!pri.dayType) pri.dayType = "tutorial";
      return pri;
    }),
    adminGrants: raw.adminGrants ?? [],
    studentChoices: raw.studentChoices ?? [],
  };
}

/**
 * Copy the teacher’s permanent class list into this week’s session roster.
 * Safe to call every sign-in — does not wipe weekly offerings/assignments.
 */
function syncClassListToSession(
  db: Database,
  teacherId: string,
  sessionId: string
): number {
  // Seed permanent list from any prior session roster if master is empty
  let master = db.teacherClassLists.filter((c) => c.teacherId === teacherId);
  if (master.length === 0) {
    const prior = db.roster.filter((r) => r.teacherId === teacherId);
    const seen = new Set<string>();
    const now = new Date().toISOString();
    for (const r of prior) {
      const key = `${r.studentId}|${r.period}|${r.subject}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const entry: TeacherClassListEntry = {
        id: uid("tcl"),
        teacherId,
        studentId: r.studentId,
        period: r.period,
        subject: r.subject,
        createdAt: r.createdAt || now,
        updatedAt: now,
      };
      db.teacherClassLists.push(entry);
    }
    master = db.teacherClassLists.filter((c) => c.teacherId === teacherId);
  }

  let added = 0;
  const now = new Date().toISOString();
  for (const c of master) {
    const exists = db.roster.find(
      (r) =>
        r.sessionId === sessionId &&
        r.teacherId === teacherId &&
        r.studentId === c.studentId &&
        r.period === c.period &&
        r.subject === c.subject
    );
    if (exists) continue;
    db.roster.push({
      id: uid("ros"),
      sessionId,
      teacherId,
      studentId: c.studentId,
      period: c.period,
      subject: c.subject,
      createdAt: now,
    });
    added++;
  }
  return added;
}

function upsertTeacherClassList(
  db: Database,
  teacherId: string,
  studentId: string,
  period: string,
  subject: string
) {
  const now = new Date().toISOString();
  const existing = db.teacherClassLists.find(
    (c) =>
      c.teacherId === teacherId &&
      c.studentId === studentId &&
      c.period === period &&
      c.subject === subject
  );
  if (existing) {
    existing.updatedAt = now;
    return existing;
  }
  const entry: TeacherClassListEntry = {
    id: uid("tcl"),
    teacherId,
    studentId,
    period,
    subject,
    createdAt: now,
    updatedAt: now,
  };
  db.teacherClassLists.push(entry);
  return entry;
}

export async function readDb(): Promise<Database> {
  const raw = await loadRawDb();
  return normalizeDb(raw);
}

async function writeDb(db: Database): Promise<void> {
  await saveRawDb(db);
}

/** Serialize all mutations so concurrent requests don't clobber data. */
export async function updateDb<T>(
  mutator: (db: Database) => T | Promise<T>
): Promise<T> {
  return withDbLock(async () => {
    const db = await readDb();
    const result = await mutator(db);
    await writeDb(db);
    return result;
  });
}

// ─── People ───────────────────────────────────────────────────────────────

export async function createPerson(
  name: string,
  role: Person["role"],
  roomName?: string
): Promise<Person | { error: string }> {
  return updateDb((db) => {
    if (role === "admin") {
      if (!canBecomeAdmin(db, name)) {
        return {
          error: `“${name.trim()}” is not authorized as an admin. Ask an existing admin to grant you access, or use a bootstrap admin name.`,
        };
      }
      const existing = db.people.find(
        (p) =>
          p.role === "admin" &&
          normAdminName(p.name) === normAdminName(name)
      );
      if (existing) return existing;
    }
    const person: Person = {
      id: uid(role === "admin" ? "adm" : role === "teacher" ? "tch" : "stu"),
      name: name.trim(),
      role,
      roomName: roomName?.trim() || undefined,
      createdAt: new Date().toISOString(),
    };
    db.people.push(person);
    return person;
  });
}

export async function getPerson(id: string): Promise<Person | undefined> {
  const db = await readDb();
  return db.people.find((p) => p.id === id);
}

function normName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Join codes: strip spaces/dashes, uppercase (e.g. "bp zj-3j" → "BPZJ3J") */
export function normalizeJoinCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Subjects a teacher is offering this session (from their published offers). */
function teacherSubjects(
  db: Database,
  sessionId: string,
  teacherId: string
): string[] {
  return [
    ...new Set(
      db.teacherOffers
        .filter((o) => o.sessionId === sessionId && o.teacherId === teacherId)
        .map((o) => o.subject)
    ),
  ];
}

/**
 * Score for a teacher claim on a given day using the school-year calendar.
 * Lower = higher priority. Infinity = not on that day’s priority list.
 */
function calendarSubjectScore(
  db: Database,
  sessionId: string,
  teacherId: string,
  day: DayOfWeek
): number {
  const session = db.sessions.find((s) => s.id === sessionId);
  const iso = session ? dateForDay(session.weekOf, day) : null;
  const cal =
    (iso && db.dayPriorities.find((d) => d.date === iso)) ||
    db.dayPriorities.find((d) => d.sessionId === sessionId && d.day === day);
  if (!cal?.subjectOrder?.length) return Number.POSITIVE_INFINITY;
  if (cal.dayType === "no_tutorial") return Number.POSITIVE_INFINITY;

  // Subjects from offers on that date (or session-wide legacy)
  const subjects = [
    ...new Set(
      db.teacherOffers
        .filter(
          (o) =>
            o.teacherId === teacherId &&
            (o.date === iso || o.sessionId === sessionId)
        )
        .map((o) => o.subject)
    ),
  ];
  if (subjects.length === 0) {
    // Fall back to any offers this teacher has in the session week
    const weekSubs = teacherSubjects(db, sessionId, teacherId);
    if (weekSubs.length === 0) return Number.POSITIVE_INFINITY;
    let best = Number.POSITIVE_INFINITY;
    for (const sub of weekSubs) {
      const idx = cal.subjectOrder.findIndex(
        (s) => normName(s) === normName(sub)
      );
      if (idx >= 0) best = Math.min(best, idx);
    }
    return best;
  }

  let best = Number.POSITIVE_INFINITY;
  for (const sub of subjects) {
    const idx = cal.subjectOrder.findIndex(
      (s) => normName(s) === normName(sub)
    );
    if (idx >= 0) best = Math.min(best, idx);
  }
  return best;
}

function offeringPriorityForTeacher(
  db: Database,
  sessionId: string,
  teacherId: string
): number {
  // Static catalog priority (admin “Subject priority” tab)
  const offers = db.teacherOffers.filter(
    (o) => o.sessionId === sessionId && o.teacherId === teacherId
  );
  let best = Number.POSITIVE_INFINITY;
  for (const offer of offers) {
    const catalog = db.offerings.find(
      (c) =>
        c.sessionId === sessionId &&
        normName(c.subject) === normName(offer.subject)
    );
    if (catalog && typeof catalog.priority === "number") {
      best = Math.min(best, catalog.priority);
    }
  }
  const join = db.teacherJoins.find(
    (j) => j.sessionId === sessionId && j.teacherId === teacherId
  );
  if (join?.offeringId) {
    const off = db.offerings.find((o) => o.id === join.offeringId);
    if (off && typeof off.priority === "number") {
      best = Math.min(best, off.priority);
    }
  }
  return best;
}

function countSeatsForOffer(
  db: Database,
  sessionId: string,
  offerId: string,
  day: DayOfWeek
): number {
  return db.assignments.filter((a) => {
    if (a.sessionId !== sessionId || a.day !== day) return false;
    if (a.offerId === offerId) {
      const w = pickEffectiveClaim(db, sessionId, a.studentId, day);
      return w?.teacherId === a.teacherId;
    }
    // Count students effectively in this teacher's room via this offer's room
    const offer = db.teacherOffers.find((o) => o.id === offerId);
    if (!offer) return false;
    const w = pickEffectiveClaim(db, sessionId, a.studentId, day);
    return w?.teacherId === offer.teacherId && a.offerId === offerId;
  }).length;
}

/** Count students effectively in a teacher's room that day */
function countInTeacherRoom(
  db: Database,
  sessionId: string,
  teacherId: string,
  day: DayOfWeek
): number {
  const sids = [
    ...new Set(
      db.assignments
        .filter((a) => a.sessionId === sessionId && a.day === day)
        .map((a) => a.studentId)
    ),
  ];
  let n = 0;
  for (const sid of sids) {
    if (pickEffectiveClaim(db, sessionId, sid, day)?.teacherId === teacherId) n++;
  }
  return n;
}

function legacyListScore(
  db: Database,
  sessionId: string,
  studentId: string,
  claim: Assignment
): number {
  const priority = db.priorities.find(
    (p) => p.sessionId === sessionId && p.studentId === studentId
  );
  if (!priority?.ranks?.length) return Number.POSITIVE_INFINITY;
  const teacher = db.people.find((p) => p.id === claim.teacherId);
  const join = db.teacherJoins.find(
    (j) => j.sessionId === sessionId && j.teacherId === claim.teacherId
  );
  const off = join?.offeringId
    ? db.offerings.find((o) => o.id === join.offeringId)
    : undefined;
  const labels = [
    teacher?.name,
    join?.roomName,
    teacher?.roomName,
    off?.name,
    off?.subject,
  ]
    .filter(Boolean)
    .map((x) => normName(x!));

  let best = Number.POSITIVE_INFINITY;
  priority.ranks.forEach((rank, idx) => {
    const r = normName(rank);
    if (!r) return;
    if (labels.some((l) => l === r || l.includes(r) || r.includes(l))) {
      best = Math.min(best, idx);
    }
  });
  return best;
}

/**
 * Resolve which claim wins for a student on a given day.
 * 1) Required claims beat open study
 * 2) Admin calendar: subject priority for THIS day
 * 3) Static subject catalog priority (admin sections tab)
 * 4) Legacy per-student priority list
 * 5) Student choice among requesting teachers
 * 6) Else null (awaiting student choice) when multiple unprioritized required claims
 * 7) Open-only pool: earliest claim (FCFS)
 */
export function pickEffectiveClaim(
  db: Database,
  sessionId: string,
  studentId: string,
  day: DayOfWeek
): Assignment | null {
  const claims = db.assignments.filter(
    (a) =>
      a.sessionId === sessionId && a.studentId === studentId && a.day === day
  );
  if (claims.length === 0) return null;
  if (claims.length === 1) return claims[0]!;

  const required = claims.filter((c) => c.type === "required");
  const pool = required.length > 0 ? required : claims;
  if (pool.length === 1) return pool[0]!;

  // 1) Calendar day subject priority (primary for the week’s handout)
  const byCalendar = [...pool].sort((a, b) => {
    const pa = calendarSubjectScore(db, sessionId, a.teacherId, day);
    const pb = calendarSubjectScore(db, sessionId, b.teacherId, day);
    if (pa !== pb) return pa - pb;
    return a.createdAt.localeCompare(b.createdAt);
  });
  if (
    Number.isFinite(
      calendarSubjectScore(db, sessionId, byCalendar[0]!.teacherId, day)
    )
  ) {
    return byCalendar[0]!;
  }

  // 2) Static subject / offering catalog priority
  const byOffering = [...pool].sort((a, b) => {
    const pa = offeringPriorityForTeacher(db, sessionId, a.teacherId);
    const pb = offeringPriorityForTeacher(db, sessionId, b.teacherId);
    if (pa !== pb) return pa - pb;
    return a.createdAt.localeCompare(b.createdAt);
  });
  const bestOffering = offeringPriorityForTeacher(
    db,
    sessionId,
    byOffering[0]!.teacherId
  );
  if (Number.isFinite(bestOffering)) {
    return byOffering[0]!;
  }

  // 3) Legacy per-student priority list
  const byLegacy = [...pool].sort((a, b) => {
    const sa = legacyListScore(db, sessionId, studentId, a);
    const sb = legacyListScore(db, sessionId, studentId, b);
    if (sa !== sb) return sa - sb;
    return a.createdAt.localeCompare(b.createdAt);
  });
  if (Number.isFinite(legacyListScore(db, sessionId, studentId, byLegacy[0]!))) {
    return byLegacy[0]!;
  }

  // 4) Student made a choice among these rooms
  const choice = db.studentChoices.find(
    (c) =>
      c.sessionId === sessionId && c.studentId === studentId && c.day === day
  );
  if (choice) {
    const chosen = pool.find((c) => c.teacherId === choice.teacherId);
    if (chosen) return chosen;
  }

  // Multiple unprioritized required claims → student must choose (no auto win)
  if (required.length > 1) {
    return null;
  }

  // Open study FCFS
  return [...pool].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]!;
}

/** Options a student can pick when multiple unprioritized teachers requested them */
export function getStudentChoiceOptions(
  db: Database,
  sessionId: string,
  studentId: string,
  day: DayOfWeek,
  opts?: { includeAfterChoice?: boolean }
): {
  teacherId: string;
  teacherName: string;
  roomName: string;
  offeringName: string | null;
}[] {
  const claims = db.assignments.filter(
    (a) =>
      a.sessionId === sessionId &&
      a.studentId === studentId &&
      a.day === day &&
      a.type === "required"
  );
  if (claims.length < 2) return [];

  const choice = db.studentChoices.find(
    (c) =>
      c.sessionId === sessionId && c.studentId === studentId && c.day === day
  );

  // Already chose — only re-list options inside the 5-minute edit window
  if (choice) {
    if (
      !opts?.includeAfterChoice ||
      !withinStudentEditWindow(choice.createdAt)
    ) {
      return [];
    }
  } else {
    const winner = pickEffectiveClaim(db, sessionId, studentId, day);
    if (winner) return []; // resolved by subject priority (not student pick)
  }

  return claims.map((c) => {
    const teacher = db.people.find((p) => p.id === c.teacherId);
    const join = db.teacherJoins.find(
      (j) => j.sessionId === sessionId && j.teacherId === c.teacherId
    );
    const off = join?.offeringId
      ? db.offerings.find((o) => o.id === join.offeringId)
      : undefined;
    return {
      teacherId: c.teacherId,
      teacherName: teacher?.name ?? "Unknown",
      roomName: join?.roomName ?? "—",
      offeringName: off ? `${off.name} (${off.subject})` : null,
    };
  });
}

export function countOpenSeatsTaken(
  db: Database,
  sessionId: string,
  teacherId: string,
  day: DayOfWeek
): number {
  const studentIds = [
    ...new Set(
      db.assignments
        .filter((a) => a.sessionId === sessionId && a.day === day)
        .map((a) => a.studentId)
    ),
  ];
  let n = 0;
  for (const sid of studentIds) {
    const w = pickEffectiveClaim(db, sessionId, sid, day);
    if (w?.teacherId === teacherId) n++;
  }
  return n;
}

function teacherLabel(db: Database, sessionId: string, teacherId: string): string {
  const teacher = db.people.find((p) => p.id === teacherId);
  const join = db.teacherJoins.find(
    (j) => j.sessionId === sessionId && j.teacherId === teacherId
  );
  const room = join?.roomName || teacher?.roomName;
  const name = teacher?.name || "Unknown";
  return room ? `${room} (${name})` : name;
}

/** Structured contact for “who has this student” (trade / outreach). */
function teacherContact(
  db: Database,
  sessionId: string,
  teacherId: string
): {
  teacherId: string;
  teacherName: string;
  roomName: string;
  label: string;
} {
  const teacher = db.people.find((p) => p.id === teacherId);
  const join = db.teacherJoins.find(
    (j) => j.sessionId === sessionId && j.teacherId === teacherId
  );
  const offer = db.teacherOffers.find(
    (o) => o.sessionId === sessionId && o.teacherId === teacherId
  );
  const teacherName = teacher?.name ?? "Unknown";
  const roomName =
    offer?.roomName || join?.roomName || teacher?.roomName || "—";
  return {
    teacherId,
    teacherName,
    roomName,
    label: roomName !== "—" ? `${teacherName} · Room ${roomName}` : teacherName,
  };
}

function ensureAttendanceShell(
  db: Database,
  sessionId: string,
  teacherId: string,
  studentId: string,
  day: DayOfWeek
) {
  const session = db.sessions.find((s) => s.id === sessionId);
  if (!session) return;
  const date = dateForDay(session.weekOf, day);
  const att = db.attendance.find(
    (a) =>
      a.sessionId === sessionId && a.studentId === studentId && a.day === day
  );
  if (!att) {
    db.attendance.push({
      id: uid("att"),
      sessionId,
      teacherId,
      studentId,
      day,
      date,
      status: "unmarked",
      markedAt: null,
      markedBy: null,
      markedByName: null,
    });
  } else if (att.teacherId !== teacherId && att.status === "unmarked") {
    att.teacherId = teacherId;
  }
}

// ─── Sessions ─────────────────────────────────────────────────────────────

export async function createSession(
  name: string,
  adminId: string,
  weekOf?: string
): Promise<TutorialSession> {
  return updateDb((db) => {
    // One live schoolwide session at a time — avoid stale codes confusing teachers
    for (const s of db.sessions) {
      if (s.status === "active") s.status = "closed";
    }

    let code = joinCode();
    while (
      db.sessions.some(
        (s) => normalizeJoinCode(s.joinCode) === code && s.status === "active"
      )
    ) {
      code = joinCode();
    }
    const session: TutorialSession = {
      id: uid("ses"),
      name: name.trim(),
      joinCode: code,
      weekOf: weekOf || mondayOfWeek(),
      status: "active",
      adminId,
      createdAt: new Date().toISOString(),
    };
    db.sessions.push(session);
    return session;
  });
}

export async function getSession(id: string): Promise<TutorialSession | undefined> {
  const db = await readDb();
  return db.sessions.find((s) => s.id === id);
}

export async function getSessionByCode(
  code: string
): Promise<TutorialSession | undefined> {
  const db = await readDb();
  const normalized = normalizeJoinCode(code);
  if (!normalized) return undefined;
  return db.sessions.find(
    (s) =>
      normalizeJoinCode(s.joinCode) === normalized && s.status === "active"
  );
}

export async function listSessions(): Promise<TutorialSession[]> {
  const db = await readDb();
  return [...db.sessions].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt)
  );
}

export async function closeSession(id: string): Promise<TutorialSession | null> {
  return updateDb((db) => {
    const s = db.sessions.find((x) => x.id === id);
    if (!s) return null;
    s.status = "closed";
    return s;
  });
}

/** Re-activate a closed session so teachers can join with the same code again */
export async function reopenSession(id: string): Promise<TutorialSession | null> {
  return updateDb((db) => {
    const s = db.sessions.find((x) => x.id === id);
    if (!s) return null;
    for (const other of db.sessions) {
      if (other.id !== id && other.status === "active") {
        other.status = "closed";
      }
    }
    s.status = "active";
    return s;
  });
}

/** Prefer the latest active session for this admin (or any active schoolwide session) */
export async function resolveAdminSession(params: {
  adminId?: string;
  sessionId?: string | null;
}): Promise<TutorialSession | null> {
  const db = await readDb();
  const byId = params.sessionId
    ? db.sessions.find((s) => s.id === params.sessionId)
    : undefined;

  // Keep active session from localStorage
  if (byId?.status === "active") return byId;

  // Prefer latest active session owned by this admin
  if (params.adminId) {
    const mineActive = db.sessions
      .filter((s) => s.adminId === params.adminId && s.status === "active")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (mineActive[0]) return mineActive[0];
  }

  // Any active session (schoolwide)
  const anyActive = db.sessions
    .filter((s) => s.status === "active")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (anyActive[0]) return anyActive[0];

  // Fall back to stored session even if closed (admin can reopen)
  if (byId) return byId;

  if (params.adminId) {
    const mine = db.sessions
      .filter((s) => s.adminId === params.adminId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return mine[0] || null;
  }

  return null;
}

// ─── Teacher joins ────────────────────────────────────────────────────────

export async function joinAsTeacher(
  sessionId: string,
  teacherId: string,
  roomName: string,
  isOpenStudy = false
): Promise<TeacherJoin> {
  return updateDb((db) => {
    const existing = db.teacherJoins.find(
      (j) => j.sessionId === sessionId && j.teacherId === teacherId
    );
    if (existing) {
      if (roomName.trim()) existing.roomName = roomName.trim();
      existing.isOpenStudy = isOpenStudy;
      const person = db.people.find((p) => p.id === teacherId);
      if (person && roomName.trim()) person.roomName = roomName.trim();
      return existing;
    }
    const join: TeacherJoin = {
      id: uid("tjn"),
      sessionId,
      teacherId,
      roomName: roomName.trim(),
      offeringId: null,
      accessMode: isOpenStudy ? "open" : "closed",
      capacity: 30,
      isOpenStudy,
      joinedAt: new Date().toISOString(),
    };
    db.teacherJoins.push(join);
    const person = db.people.find((p) => p.id === teacherId);
    if (person) person.roomName = roomName.trim();
    return normalizeTeacherJoin(join);
  });
}

/**
 * Teacher login / rejoin by name + join code.
 * Returning teachers (same name in this session) keep the same ID so roster stays intact.
 */
export async function loginTeacher(params: {
  name: string;
  joinCode: string;
  /** Optional — room/open/closed live on each tutorial offering instead */
  roomName?: string;
  isOpenStudy?: boolean;
  accessMode?: "open" | "closed";
  offeringId?: string | null;
  capacity?: number;
  personId?: string;
}): Promise<
  | {
      ok: true;
      person: Person;
      session: TutorialSession;
      join: TeacherJoin;
      restored: boolean;
      rosterCount: number;
      offerCount: number;
    }
  | { ok: false; error: string }
> {
  return updateDb((db) => {
    const code = normalizeJoinCode(params.joinCode);
    if (!code) {
      return { ok: false as const, error: "Enter the join code from your admin." };
    }

    const matchAny = db.sessions.find(
      (s) => normalizeJoinCode(s.joinCode) === code
    );
    if (!matchAny) {
      const active = db.sessions.filter((s) => s.status === "active");
      const hint =
        active.length === 1
          ? ` Active code right now is ${active[0]!.joinCode}.`
          : active.length > 1
            ? ` There are ${active.length} active sessions — ask admin for the current code.`
            : " No session is active — ask the admin to start or reopen one.";
      return {
        ok: false as const,
        error: `Join code “${code}” was not found.${hint}`,
      };
    }
    if (matchAny.status !== "active") {
      return {
        ok: false as const,
        error: `Code ${code} belongs to a closed session (“${matchAny.name}”). Ask the admin to click Reopen session (or start a new one) so teachers can join again.`,
      };
    }
    const session = matchAny;

    const wantName = normName(params.name);
    if (!wantName) {
      return { ok: false as const, error: "Name is required" };
    }

    let person: Person | undefined;
    let restored = false;

    if (params.personId) {
      const byId = db.people.find(
        (p) => p.id === params.personId && p.role === "teacher"
      );
      if (byId) {
        const join = db.teacherJoins.find(
          (j) => j.sessionId === session.id && j.teacherId === byId.id
        );
        if (join) {
          person = byId;
          restored = true;
        }
      }
    }

    if (!person) {
      for (const j of db.teacherJoins.filter((x) => x.sessionId === session.id)) {
        const p = db.people.find((x) => x.id === j.teacherId);
        if (p && normName(p.name) === wantName) {
          person = p;
          restored = true;
          break;
        }
      }
    }

    // Prefer room from an existing offer, then prior join, then optional form value
    const existingJoin = db.teacherJoins.find(
      (j) =>
        j.sessionId === session.id &&
        (person ? j.teacherId === person.id : false)
    );
    // person may not exist yet — resolve room after person id known

    if (!person) {
      person = {
        id: uid("tch"),
        name: params.name.trim(),
        role: "teacher",
        roomName: params.roomName?.trim() || undefined,
        createdAt: new Date().toISOString(),
      };
      db.people.push(person);
    } else {
      person.name = params.name.trim();
      if (params.roomName?.trim()) person.roomName = params.roomName.trim();
    }

    const priorOffer = db.teacherOffers.find(
      (o) => o.sessionId === session.id && o.teacherId === person!.id
    );
    const roomFromOffer = priorOffer?.roomName;
    const roomName =
      params.roomName?.trim() ||
      roomFromOffer ||
      existingJoin?.roomName ||
      person.roomName ||
      "—";

    const accessMode: "open" | "closed" =
      params.accessMode ||
      (params.isOpenStudy
        ? "open"
        : priorOffer?.accessMode) ||
      existingJoin?.accessMode ||
      "closed";

    let defaultCap = priorOffer?.capacity || existingJoin?.capacity || 30;
    if (params.offeringId) {
      const off = db.offerings.find((o) => o.id === params.offeringId);
      if (off) defaultCap = off.defaultCapacity || 30;
    }
    const capacity =
      typeof params.capacity === "number" && params.capacity > 0
        ? Math.floor(params.capacity)
        : defaultCap;

    let join = db.teacherJoins.find(
      (j) => j.sessionId === session.id && j.teacherId === person!.id
    );
    if (join) {
      if (params.roomName?.trim() || roomFromOffer) {
        join.roomName = roomName;
      }
      // Do not overwrite open/closed from join form — offerings own that
      if (params.accessMode || typeof params.isOpenStudy === "boolean") {
        join.accessMode = accessMode;
        join.isOpenStudy = accessMode === "open";
      }
      if (typeof params.capacity === "number" && params.capacity > 0) {
        join.capacity = capacity;
      }
      if (params.offeringId !== undefined) {
        join.offeringId = params.offeringId || null;
      }
    } else {
      join = {
        id: uid("tjn"),
        sessionId: session.id,
        teacherId: person.id,
        roomName,
        offeringId: params.offeringId || null,
        accessMode,
        capacity,
        isOpenStudy: accessMode === "open",
        joinedAt: new Date().toISOString(),
      };
      db.teacherJoins.push(join);
    }
    person.roomName = join.roomName;

    // Restore permanent class list into this week’s session (daily/weekly sign-in)
    syncClassListToSession(db, person.id, session.id);

    const rosterCount = db.roster.filter(
      (r) => r.sessionId === session.id && r.teacherId === person!.id
    ).length;

    // Offerings are week-specific — count only this session
    const offerCount = db.teacherOffers.filter(
      (o) => o.sessionId === session.id && o.teacherId === person!.id
    ).length;

    return {
      ok: true as const,
      person,
      session,
      join: normalizeTeacherJoin(join),
      restored,
      rosterCount,
      offerCount,
    };
  });
}

export async function updateTeacherRoomSettings(params: {
  sessionId: string;
  teacherId: string;
  isOpenStudy?: boolean;
  accessMode?: "open" | "closed";
  offeringId?: string | null;
  capacity?: number;
  roomName?: string;
}): Promise<TeacherJoin | null> {
  return updateDb((db) => {
    const join = db.teacherJoins.find(
      (j) =>
        j.sessionId === params.sessionId && j.teacherId === params.teacherId
    );
    if (!join) return null;
    if (params.roomName?.trim()) join.roomName = params.roomName.trim();
    if (params.accessMode) {
      join.accessMode = params.accessMode;
      join.isOpenStudy = params.accessMode === "open";
    } else if (typeof params.isOpenStudy === "boolean") {
      join.isOpenStudy = params.isOpenStudy;
      join.accessMode = params.isOpenStudy ? "open" : "closed";
    }
    if (params.offeringId !== undefined) {
      join.offeringId = params.offeringId;
    }
    if (typeof params.capacity === "number" && params.capacity > 0) {
      join.capacity = Math.floor(params.capacity);
    }
    return normalizeTeacherJoin(join);
  });
}

/** @deprecated use updateTeacherRoomSettings */
export async function setOpenStudy(
  sessionId: string,
  teacherId: string,
  isOpenStudy: boolean
): Promise<TeacherJoin | null> {
  return updateTeacherRoomSettings({ sessionId, teacherId, isOpenStudy });
}

export async function listTeachersInSession(
  sessionId: string
): Promise<(TeacherJoin & { teacherName: string })[]> {
  const db = await readDb();
  return db.teacherJoins
    .filter((j) => j.sessionId === sessionId)
    .map((j) => ({
      ...j,
      teacherName:
        db.people.find((p) => p.id === j.teacherId)?.name ?? "Unknown",
    }));
}

// ─── Students & roster ────────────────────────────────────────────────────

/** Normalize district/school IDs for matching (case/spacing). */
export function normSchoolId(id: string): string {
  return id.trim().toUpperCase().replace(/[\s\-_.]/g, "");
}

function namesMatch(
  aFirst: string,
  aLast: string,
  bFirst: string,
  bLast: string
): boolean {
  return (
    normName(aFirst) === normName(bFirst) && normName(aLast) === normName(bLast)
  );
}

/**
 * Resolve one student record for the whole school.
 * Prefer school SIS ID so 7 class rosters share the same person.
 */
export function resolveStudentInDb(
  db: Database,
  params: {
    firstName?: string;
    lastName?: string;
    schoolId?: string;
    grade?: GradeLevel | null;
  }
): { student: Student; created: boolean; matchedBy: "id" | "name" | "new" } {
  const schoolKey = params.schoolId ? normSchoolId(params.schoolId) : "";

  if (schoolKey) {
    const byId = db.students.find(
      (s) =>
        normSchoolId(s.id) === schoolKey ||
        (s.schoolId && normSchoolId(s.schoolId) === schoolKey)
    );
    if (byId) {
      if (params.firstName?.trim()) byId.firstName = params.firstName.trim();
      if (params.lastName?.trim()) byId.lastName = params.lastName.trim();
      if (!byId.schoolId) byId.schoolId = params.schoolId!.trim();
      if (params.grade === "7" || params.grade === "8") byId.grade = params.grade;
      return { student: byId, created: false, matchedBy: "id" };
    }
  }

  if (params.firstName?.trim() && params.lastName?.trim()) {
    const byName = db.students.find((s) =>
      namesMatch(s.firstName, s.lastName, params.firstName!, params.lastName!)
    );
    if (byName) {
      // Attach SIS id if this roster provides one and student was name-only before
      if (schoolKey && !byName.schoolId) {
        // Only rewrite id if no other student owns that school id
        const taken = db.students.some(
          (s) => s.id !== byName.id && normSchoolId(s.id) === schoolKey
        );
        if (!taken) {
          byName.schoolId = params.schoolId!.trim();
        }
      }
      if (params.grade === "7" || params.grade === "8") byName.grade = params.grade;
      return { student: byName, created: false, matchedBy: "name" };
    }
  }

  const student: Student = {
    id: schoolKey ? params.schoolId!.trim() : studentId(),
    schoolId: params.schoolId?.trim() || null,
    firstName: (params.firstName || "—").trim(),
    lastName: (params.lastName || "—").trim(),
    grade: params.grade === "7" || params.grade === "8" ? params.grade : null,
    createdAt: new Date().toISOString(),
  };
  db.students.push(student);
  return { student, created: true, matchedBy: "new" };
}

export async function findOrCreateStudent(
  firstName: string,
  lastName: string,
  existingId?: string
): Promise<Student> {
  return updateDb((db) => {
    const { student } = resolveStudentInDb(db, {
      firstName,
      lastName,
      schoolId: existingId,
    });
    return student;
  });
}

/** Find student by internal id or school SIS id */
export function findStudentInDb(
  db: Database,
  id: string
): Student | undefined {
  if (!id) return undefined;
  const key = normSchoolId(id);
  return db.students.find(
    (s) =>
      s.id === id ||
      normSchoolId(s.id) === key ||
      (s.schoolId != null &&
        s.schoolId !== "" &&
        normSchoolId(s.schoolId) === key)
  );
}

/** Display names with snapshot fallback from assignment */
export function studentDisplayName(
  db: Database,
  studentId: string,
  snapshot?: { firstName?: string | null; lastName?: string | null }
): { firstName: string; lastName: string } {
  const s = findStudentInDb(db, studentId);
  if (s?.firstName?.trim() || s?.lastName?.trim()) {
    return {
      firstName: s.firstName?.trim() || "—",
      lastName: s.lastName?.trim() || "—",
    };
  }
  if (snapshot?.firstName?.trim() || snapshot?.lastName?.trim()) {
    return {
      firstName: snapshot.firstName?.trim() || "—",
      lastName: snapshot.lastName?.trim() || "—",
    };
  }
  // Last resort: show short id so list isn't "?, ?"
  const short =
    studentId.length > 10 ? `${studentId.slice(0, 8)}…` : studentId || "Unknown";
  return { firstName: short, lastName: "" };
}

export async function getStudent(id: string): Promise<Student | undefined> {
  const db = await readDb();
  return findStudentInDb(db, id);
}

export async function listStudents(query?: string): Promise<Student[]> {
  const db = await readDb();
  let list = [...db.students];
  if (query?.trim()) {
    const q = query.trim().toLowerCase();
    list = list.filter(
      (s) =>
        s.firstName.toLowerCase().includes(q) ||
        s.lastName.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        (s.schoolId && s.schoolId.toLowerCase().includes(q)) ||
        `${s.lastName}, ${s.firstName}`.toLowerCase().includes(q)
    );
  }
  return list.sort(
    (a, b) =>
      a.lastName.localeCompare(b.lastName) ||
      a.firstName.localeCompare(b.firstName)
  );
}

export type RosterUploadRow = {
  firstName: string;
  lastName: string;
  period: string;
  subject: string;
  studentId?: string;
  grade?: GradeLevel | null;
};

export type RosterUploadResult = {
  /** New roster enrollment rows for this teacher */
  added: number;
  /** Already on this teacher's list */
  skippedExisting: number;
  /** Linked to an existing schoolwide student (by ID or name) */
  matchedExisting: number;
  /** Brand-new student records created */
  createdStudents: number;
  students: Student[];
  entries: RosterEntry[];
};

export async function uploadRoster(
  sessionId: string,
  teacherId: string,
  rows: RosterUploadRow[]
): Promise<RosterUploadResult> {
  return updateDb((db) => {
    const students: Student[] = [];
    const entries: RosterEntry[] = [];
    let added = 0;
    let skippedExisting = 0;
    let matchedExisting = 0;
    let createdStudents = 0;

    for (const row of rows) {
      if (!row.firstName?.trim() || !row.lastName?.trim()) continue;

      const resolved = resolveStudentInDb(db, {
        firstName: row.firstName,
        lastName: row.lastName,
        schoolId: row.studentId,
        grade: row.grade,
      });
      const student = resolved.student;
      if (resolved.created) createdStudents++;
      else matchedExisting++;

      students.push(student);

      const period = row.period.trim() || "—";
      const subject = row.subject.trim() || "—";

      const exists = db.roster.find(
        (r) =>
          r.sessionId === sessionId &&
          r.teacherId === teacherId &&
          r.studentId === student.id &&
          r.period === period &&
          r.subject === subject
      );
      if (exists) {
        entries.push(exists);
        skippedExisting++;
        continue;
      }

      // Same student already on this teacher's list for another period row is fine —
      // one enrollment row per period/subject. Also allow linking without period dupes:
      // if already enrolled with same period, skip above.

      // Permanent account class list (survives new weeks)
      upsertTeacherClassList(db, teacherId, student.id, period, subject);

      const entry: RosterEntry = {
        id: uid("ros"),
        sessionId,
        teacherId,
        studentId: student.id,
        period,
        subject,
        createdAt: new Date().toISOString(),
      };
      db.roster.push(entry);
      entries.push(entry);
      added++;
    }

    return {
      added,
      skippedExisting,
      matchedExisting,
      createdStudents,
      students,
      entries,
    };
  });
}

/** Teacher picks existing schoolwide students (no new person records). */
export async function attachDirectoryToRoster(params: {
  sessionId: string;
  teacherId: string;
  studentIds: string[];
  period: string;
  subject: string;
}): Promise<RosterUploadResult> {
  const rows: RosterUploadRow[] = [];
  const db = await readDb();
  for (const id of params.studentIds) {
    const s = db.students.find(
      (x) => x.id === id || normSchoolId(x.id) === normSchoolId(id)
    );
    if (!s) continue;
    rows.push({
      firstName: s.firstName,
      lastName: s.lastName,
      period: params.period,
      subject: params.subject,
      studentId: s.id,
      grade: s.grade,
    });
  }
  return uploadRoster(params.sessionId, params.teacherId, rows);
}

/**
 * Admin (or office) loads the schoolwide directory once.
 * Teachers then attach periods from this list — zero duplicates.
 */
export async function importSchoolDirectory(
  rows: {
    firstName: string;
    lastName: string;
    studentId?: string;
    grade?: GradeLevel | null;
  }[]
): Promise<{
  created: number;
  updated: number;
  total: number;
}> {
  return updateDb((db) => {
    let created = 0;
    let updated = 0;
    for (const row of rows) {
      if (!row.firstName?.trim() || !row.lastName?.trim()) continue;
      const r = resolveStudentInDb(db, {
        firstName: row.firstName,
        lastName: row.lastName,
        schoolId: row.studentId,
        grade: row.grade,
      });
      if (r.created) created++;
      else updated++;
    }
    return {
      created,
      updated,
      total: db.students.length,
    };
  });
}

export async function getTeacherRoster(
  sessionId: string,
  teacherId: string
): Promise<(RosterEntry & { firstName: string; lastName: string })[]> {
  // Ensure account class list is present on this week’s session
  await updateDb((db) => {
    syncClassListToSession(db, teacherId, sessionId);
    return true;
  });

  const db = await readDb();
  return db.roster
    .filter((r) => r.sessionId === sessionId && r.teacherId === teacherId)
    .map((r) => {
      const names = studentDisplayName(db, r.studentId);
      return {
        ...r,
        firstName: names.firstName,
        lastName: names.lastName,
      };
    })
    .sort(
      (a, b) =>
        a.lastName.localeCompare(b.lastName) ||
        a.firstName.localeCompare(b.firstName)
    );
}

/** Permanent class list size on teacher account (across weeks) */
export async function getTeacherClassListCount(
  teacherId: string
): Promise<number> {
  const db = await readDb();
  return db.teacherClassLists.filter((c) => c.teacherId === teacherId).length;
}

// ─── Assignments (claims; weekly priority decides the room) ───────────────

export type AssignmentResult = {
  created: Assignment[];
  /** Claims that win for attendance after priority resolution */
  won: {
    studentId: string;
    firstName: string;
    lastName: string;
    day: DayOfWeek;
  }[];
  /** This teacher requested but another room has higher weekly priority */
  lost: {
    studentId: string;
    firstName: string;
    lastName: string;
    day: DayOfWeek;
    winnerTeacherId: string;
    winnerLabel: string;
  }[];
  /** Other teachers lost students to this teacher due to priority */
  taken: {
    studentId: string;
    firstName: string;
    lastName: string;
    day: DayOfWeek;
    fromTeacherId: string;
    fromLabel: string;
  }[];
};

export async function setAssignments(params: {
  sessionId: string;
  teacherId: string;
  studentIds: string[];
  days: DayOfWeek[];
  type?: Assignment["type"];
}): Promise<AssignmentResult> {
  const { sessionId, teacherId, studentIds, days, type = "required" } = params;
  return updateDb((db) => {
    const created: Assignment[] = [];
    const won: AssignmentResult["won"] = [];
    const lost: AssignmentResult["lost"] = [];
    const taken: AssignmentResult["taken"] = [];

    for (const sid of studentIds) {
      const names = studentDisplayName(db, sid);
      const firstName = names.firstName;
      const lastName = names.lastName;

      for (const day of days) {
        // Upsert this teacher's claim (do not wipe other teachers' claims)
        const existingMine = db.assignments.find(
          (a) =>
            a.sessionId === sessionId &&
            a.teacherId === teacherId &&
            a.studentId === sid &&
            a.day === day
        );
        let claim: Assignment;
        if (existingMine) {
          existingMine.type = type;
          existingMine.studentFirstName = firstName;
          existingMine.studentLastName = lastName;
          claim = existingMine;
        } else {
          claim = {
            id: uid("asn"),
            sessionId,
            teacherId,
            studentId: sid,
            day,
            type,
            studentFirstName: firstName,
            studentLastName: lastName,
            createdAt: new Date().toISOString(),
          };
          db.assignments.push(claim);
          created.push(claim);
        }

        const winner = pickEffectiveClaim(db, sessionId, sid, day);
        if (winner) {
          ensureAttendanceShell(db, sessionId, winner.teacherId, sid, day);
        } else {
          // Awaiting student choice: every requesting teacher can take attendance
          const claimants = db.assignments.filter(
            (a) =>
              a.sessionId === sessionId &&
              a.studentId === sid &&
              a.day === day &&
              a.type === "required"
          );
          for (const c of claimants) {
            ensureAttendanceShell(db, sessionId, c.teacherId, sid, day);
          }
        }

        if (winner?.teacherId === teacherId) {
          won.push({ studentId: sid, firstName, lastName, day });
          const rivals = db.assignments.filter(
            (a) =>
              a.sessionId === sessionId &&
              a.studentId === sid &&
              a.day === day &&
              a.teacherId !== teacherId
          );
          for (const r of rivals) {
            taken.push({
              studentId: sid,
              firstName,
              lastName,
              day,
              fromTeacherId: r.teacherId,
              fromLabel: teacherLabel(db, sessionId, r.teacherId),
            });
          }
        } else if (winner) {
          lost.push({
            studentId: sid,
            firstName,
            lastName,
            day,
            winnerTeacherId: winner.teacherId,
            winnerLabel: teacherLabel(db, sessionId, winner.teacherId),
          });
        } else {
          // Contested, no priority — stays on all requesting teachers' attendance lists
          won.push({ studentId: sid, firstName, lastName, day });
        }
      }
    }

    return { created, won, lost, taken };
  });
}

/** Students may change or clear their own open/choice selection within this window. */
export const STUDENT_EDIT_WINDOW_MS = 5 * 60 * 1000;

export function withinStudentEditWindow(
  createdAt: string | undefined | null,
  now = Date.now()
): boolean {
  if (!createdAt) return false;
  const t = new Date(createdAt).getTime();
  if (Number.isNaN(t)) return false;
  return now - t < STUDENT_EDIT_WINDOW_MS && now >= t;
}

export function studentEditExpiresAt(createdAt: string): string {
  return new Date(
    new Date(createdAt).getTime() + STUDENT_EDIT_WINDOW_MS
  ).toISOString();
}

export async function removeAssignment(
  sessionId: string,
  teacherId: string,
  studentId: string,
  day: DayOfWeek
): Promise<boolean> {
  return updateDb((db) => {
    const before = db.assignments.length;
    db.assignments = db.assignments.filter(
      (a) =>
        !(
          a.sessionId === sessionId &&
          a.teacherId === teacherId &&
          a.studentId === studentId &&
          a.day === day
        )
    );
    return db.assignments.length < before;
  });
}

/**
 * Student clears their own open signup or room choice (within 5-minute edit window).
 * Teacher-required placements cannot be cleared.
 */
export async function clearStudentSelection(params: {
  sessionId: string;
  studentId: string;
  day: DayOfWeek;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  return updateDb((db) => {
    const { sessionId, studentId, day } = params;
    const choice = db.studentChoices.find(
      (c) =>
        c.sessionId === sessionId &&
        c.studentId === studentId &&
        c.day === day
    );
    const openOrChoice = db.assignments.find(
      (a) =>
        a.sessionId === sessionId &&
        a.studentId === studentId &&
        a.day === day &&
        (a.type === "open_study" || a.type === "student_choice")
    );

    if (!choice && !openOrChoice) {
      return {
        ok: false as const,
        error: "No student selection to change for that day.",
      };
    }

    const stamp = choice?.createdAt || openOrChoice?.createdAt;
    if (!withinStudentEditWindow(stamp)) {
      return {
        ok: false as const,
        error:
          "Edit window closed. You had 5 minutes after selecting to change it.",
      };
    }

    // Clear student choice record
    db.studentChoices = db.studentChoices.filter(
      (c) =>
        !(
          c.sessionId === sessionId &&
          c.studentId === studentId &&
          c.day === day
        )
    );

    // Remove open/student_choice assignments only (keep teacher required claims)
    db.assignments = db.assignments.filter(
      (a) =>
        !(
          a.sessionId === sessionId &&
          a.studentId === studentId &&
          a.day === day &&
          (a.type === "open_study" || a.type === "student_choice")
        )
    );

    return { ok: true as const };
  });
}

export async function studentSelfSignup(params: {
  sessionId: string;
  studentId: string;
  teacherId: string;
  day: DayOfWeek;
  offerId?: string;
}): Promise<{ ok: true; assignment: Assignment } | { ok: false; error: string }> {
  const { sessionId, studentId, day } = params;
  return updateDb((db) => {
    let offer = params.offerId
      ? db.teacherOffers.find((o) => o.id === params.offerId)
      : undefined;
    if (!offer && params.teacherId) {
      offer = db.teacherOffers.find(
        (o) =>
          o.sessionId === sessionId &&
          o.teacherId === params.teacherId &&
          o.accessMode === "open"
      );
    }
    if (!offer || offer.accessMode !== "open") {
      return {
        ok: false as const,
        error:
          "That offering is closed — only students the teacher requires may attend.",
      };
    }
    const teacherId = offer.teacherId;

    const student = db.students.find((s) => s.id === studentId);
    if (!student) {
      return { ok: false as const, error: "Student ID not found." };
    }
    if (
      student.grade &&
      offer.grades.length &&
      !offer.grades.includes(student.grade)
    ) {
      return {
        ok: false as const,
        error: `This offering is for grade ${offer.grades.join("/")} only.`,
      };
    }

    const requiredClaims = db.assignments.filter(
      (a) =>
        a.sessionId === sessionId &&
        a.studentId === studentId &&
        a.day === day &&
        a.type === "required"
    );
    if (requiredClaims.length > 0) {
      const winner = pickEffectiveClaim(db, sessionId, studentId, day);
      if (winner) {
        return {
          ok: false as const,
          error: `You must attend a required tutorial that day (${teacherLabel(db, sessionId, winner.teacherId)}).`,
        };
      }
      return {
        ok: false as const,
        error:
          "Teachers requested you — choose among those rooms first (or wait for priority).",
      };
    }

    // Lock re-signup after 5-minute edit window
    const existingSelf = db.assignments.find(
      (a) =>
        a.sessionId === sessionId &&
        a.studentId === studentId &&
        a.day === day &&
        (a.type === "open_study" || a.type === "student_choice")
    );
    if (existingSelf) {
      if (existingSelf.teacherId === teacherId && existingSelf.offerId === offer.id) {
        return { ok: true as const, assignment: existingSelf };
      }
      if (!withinStudentEditWindow(existingSelf.createdAt)) {
        return {
          ok: false as const,
          error:
            "Your selection is locked. You had 5 minutes after selecting to change it.",
        };
      }
    }

    const taken = countInTeacherRoom(db, sessionId, teacherId, day);
    const alreadyHere =
      pickEffectiveClaim(db, sessionId, studentId, day)?.teacherId === teacherId;
    if (!alreadyHere && taken >= (offer.capacity || 30)) {
      return {
        ok: false as const,
        error: `Room ${offer.roomName} is full (${offer.capacity} seats, first-come first-served).`,
      };
    }

    // One open placement per day — replace prior open/choice (only inside edit window)
    db.assignments = db.assignments.filter(
      (a) =>
        !(
          a.sessionId === sessionId &&
          a.studentId === studentId &&
          a.day === day &&
          a.type !== "required"
        )
    );

    const names = studentDisplayName(db, studentId);
    const assignment: Assignment = {
      id: uid("asn"),
      sessionId,
      teacherId,
      studentId,
      day,
      type: "open_study",
      offerId: offer.id,
      studentFirstName: names.firstName,
      studentLastName: names.lastName,
      createdAt: new Date().toISOString(),
    };
    db.assignments.push(assignment);

    ensureAttendanceShell(db, sessionId, teacherId, studentId, day);
    return { ok: true as const, assignment };
  });
}

export async function saveStudentChoice(params: {
  sessionId: string;
  studentId: string;
  day: DayOfWeek;
  teacherId: string;
}): Promise<
  | { ok: true; choice: StudentChoice; editExpiresAt: string }
  | { ok: false; error: string }
> {
  return updateDb((db) => {
    const existingChoice = db.studentChoices.find(
      (c) =>
        c.sessionId === params.sessionId &&
        c.studentId === params.studentId &&
        c.day === params.day
    );
    if (existingChoice) {
      if (existingChoice.teacherId === params.teacherId) {
        return {
          ok: true as const,
          choice: existingChoice,
          editExpiresAt: studentEditExpiresAt(existingChoice.createdAt),
        };
      }
      if (!withinStudentEditWindow(existingChoice.createdAt)) {
        return {
          ok: false as const,
          error:
            "Your selection is locked. You had 5 minutes after selecting to change it.",
        };
      }
    }

    const options = getStudentChoiceOptions(
      db,
      params.sessionId,
      params.studentId,
      params.day,
      { includeAfterChoice: true }
    );
    if (!options.some((o) => o.teacherId === params.teacherId)) {
      const hasClaim = db.assignments.some(
        (a) =>
          a.sessionId === params.sessionId &&
          a.studentId === params.studentId &&
          a.day === params.day &&
          a.teacherId === params.teacherId &&
          a.type === "required"
      );
      if (!hasClaim) {
        return {
          ok: false as const,
          error: "That room is not one of your available choices.",
        };
      }
    }

    db.studentChoices = db.studentChoices.filter(
      (c) =>
        !(
          c.sessionId === params.sessionId &&
          c.studentId === params.studentId &&
          c.day === params.day
        )
    );
    const choice: StudentChoice = {
      id: uid("chc"),
      sessionId: params.sessionId,
      studentId: params.studentId,
      day: params.day,
      teacherId: params.teacherId,
      createdAt: new Date().toISOString(),
    };
    db.studentChoices.push(choice);

    // Also ensure assignment claim exists
    const has = db.assignments.some(
      (a) =>
        a.sessionId === params.sessionId &&
        a.studentId === params.studentId &&
        a.day === params.day &&
        a.teacherId === params.teacherId
    );
    if (!has) {
      const names = studentDisplayName(db, params.studentId);
      db.assignments.push({
        id: uid("asn"),
        sessionId: params.sessionId,
        teacherId: params.teacherId,
        studentId: params.studentId,
        day: params.day,
        type: "student_choice",
        studentFirstName: names.firstName,
        studentLastName: names.lastName,
        createdAt: choice.createdAt,
      });
    }

    ensureAttendanceShell(
      db,
      params.sessionId,
      params.teacherId,
      params.studentId,
      params.day
    );
    return {
      ok: true as const,
      choice,
      editExpiresAt: studentEditExpiresAt(choice.createdAt),
    };
  });
}

export async function getTeacherDayRoster(
  sessionId: string,
  teacherId: string,
  day: DayOfWeek
) {
  // Persist attendance shells for anyone who needs to mark present
  return updateDb((db) => {
    const claims = db.assignments.filter(
      (a) =>
        a.sessionId === sessionId && a.teacherId === teacherId && a.day === day
    );

    const rows = [];
    for (const a of claims) {
      const winner = pickEffectiveClaim(db, sessionId, a.studentId, day);
      const names = studentDisplayName(db, a.studentId, {
        firstName: a.studentFirstName,
        lastName: a.studentLastName,
      });
      // Heal snapshot if we resolved a real student
      const live = findStudentInDb(db, a.studentId);
      if (live) {
        a.studentFirstName = live.firstName;
        a.studentLastName = live.lastName;
      }

      const requiredClaimants = db.assignments.filter(
        (x) =>
          x.sessionId === sessionId &&
          x.studentId === a.studentId &&
          x.day === day &&
          x.type === "required"
      );
      // Multiple teachers requested, no subject priority → student chooses
      const needsStudentChoice =
        !winner && a.type === "required" && requiredClaimants.length > 1;

      const isWinner = winner?.teacherId === teacherId;
      // Priority winner only on that teacher; awaiting choice on ALL requesters
      const onAttendanceList =
        isWinner ||
        needsStudentChoice ||
        (!winner && a.type !== "required") ||
        (a.type === "required" && !winner && requiredClaimants.length === 1);

      const lostToPriority = Boolean(winner && !isWinner);

      if (onAttendanceList && !lostToPriority) {
        ensureAttendanceShell(db, sessionId, teacherId, a.studentId, day);
      }
      // When awaiting choice, also shell other claimants so shared present works
      if (needsStudentChoice) {
        for (const c of requiredClaimants) {
          ensureAttendanceShell(db, sessionId, c.teacherId, a.studentId, day);
        }
      }

      const att = db.attendance.find(
        (x) =>
          x.sessionId === sessionId &&
          x.studentId === a.studentId &&
          x.day === day
      );
      const markedByName =
        att?.markedByName ||
        (att?.markedBy
          ? db.people.find((p) => p.id === att.markedBy)?.name ?? null
          : null);

      const assignedTo = winner
        ? teacherContact(db, sessionId, winner.teacherId)
        : null;

      rows.push({
        assignmentId: a.id,
        studentId: a.studentId,
        firstName: names.firstName,
        lastName: names.lastName,
        type: a.type,
        attendanceStatus: att?.status ?? ("unmarked" as const),
        attendanceId: att?.id ?? null,
        /** true = show on attendance table and allow mark present */
        isEffective: onAttendanceList && !lostToPriority,
        lostToPriority,
        effectiveRoom: assignedTo
          ? assignedTo.label
          : needsStudentChoice
            ? "Awaiting student choice"
            : null,
        /** Who currently has the student (for contact / trade) */
        assignedTeacherId: assignedTo?.teacherId ?? null,
        assignedTeacherName: assignedTo?.teacherName ?? null,
        assignedRoomName: assignedTo?.roomName ?? null,
        markedBy: att?.markedBy ?? null,
        markedByName,
        needsStudentChoice,
        contestedWith: needsStudentChoice
          ? requiredClaimants
              .filter((c) => c.teacherId !== teacherId)
              .map((c) => teacherContact(db, sessionId, c.teacherId).label)
          : ([] as string[]),
      });
    }

    return rows.sort(
      (a, b) =>
        a.lastName.localeCompare(b.lastName) ||
        a.firstName.localeCompare(b.firstName)
    );
  });
}

/** All claims for a teacher in a session, with win/loss vs weekly priority */
export async function getTeacherAssignments(
  sessionId: string,
  teacherId: string
): Promise<
  {
    studentId: string;
    firstName: string;
    lastName: string;
    days: {
      day: DayOfWeek;
      type: Assignment["type"];
      isEffective: boolean;
      effectiveRoom: string | null;
      assignedTeacherId: string | null;
      assignedTeacherName: string | null;
      assignedRoomName: string | null;
      needsStudentChoice: boolean;
    }[];
  }[]
> {
  const db = await readDb();
  const mine = db.assignments.filter(
    (a) => a.sessionId === sessionId && a.teacherId === teacherId
  );
  const byStudent = new Map<
    string,
    {
      day: DayOfWeek;
      type: Assignment["type"];
      isEffective: boolean;
      effectiveRoom: string | null;
      assignedTeacherId: string | null;
      assignedTeacherName: string | null;
      assignedRoomName: string | null;
      needsStudentChoice: boolean;
    }[]
  >();
  for (const a of mine) {
    const winner = pickEffectiveClaim(db, sessionId, a.studentId, a.day);
    const requiredCount = db.assignments.filter(
      (x) =>
        x.sessionId === sessionId &&
        x.studentId === a.studentId &&
        x.day === a.day &&
        x.type === "required"
    ).length;
    const needsChoice =
      !winner && a.type === "required" && requiredCount > 1;
    const isWinner = winner?.teacherId === teacherId;
    const contact = winner
      ? teacherContact(db, sessionId, winner.teacherId)
      : null;
    const list = byStudent.get(a.studentId) || [];
    list.push({
      day: a.day,
      type: a.type,
      isEffective: isWinner || needsChoice,
      effectiveRoom: contact
        ? contact.label
        : needsChoice
          ? "Awaiting student choice"
          : null,
      assignedTeacherId: contact?.teacherId ?? null,
      assignedTeacherName: contact?.teacherName ?? null,
      assignedRoomName: contact?.roomName ?? null,
      needsStudentChoice: needsChoice,
    });
    byStudent.set(a.studentId, list);
  }
  return [...byStudent.entries()]
    .map(([sid, days]) => {
      const snap = mine.find((a) => a.studentId === sid);
      const names = studentDisplayName(db, sid, {
        firstName: snap?.studentFirstName,
        lastName: snap?.studentLastName,
      });
      return {
        studentId: sid,
        firstName: names.firstName,
        lastName: names.lastName,
        days: days.sort(
          (a, b) =>
            ["Mon", "Tue", "Wed", "Thu", "Fri"].indexOf(a.day) -
            ["Mon", "Tue", "Wed", "Thu", "Fri"].indexOf(b.day)
        ),
      };
    })
    .sort(
      (a, b) =>
        a.lastName.localeCompare(b.lastName) ||
        a.firstName.localeCompare(b.firstName)
    );
}

// ─── Weekly priority (admin) ──────────────────────────────────────────────

export type PriorityUploadRow = {
  firstName: string;
  lastName: string;
  studentId?: string;
  ranks: string[]; // Priority 1…N labels (room or teacher name)
};

export async function uploadPriorities(
  sessionId: string,
  rows: PriorityUploadRow[]
): Promise<{ saved: number; unmatched: string[] }> {
  return updateDb((db) => {
    let saved = 0;
    const unmatched: string[] = [];

    for (const row of rows) {
      if (!row.ranks?.length && !row.firstName && !row.lastName) continue;

      let student = row.studentId
        ? db.students.find((s) => s.id === row.studentId)
        : undefined;

      if (!student && row.firstName?.trim() && row.lastName?.trim()) {
        student = db.students.find(
          (s) =>
            normName(s.firstName) === normName(row.firstName) &&
            normName(s.lastName) === normName(row.lastName)
        );
      }

      // Create student stub if not yet on any roster so priority can be staged early
      if (!student && row.firstName?.trim() && row.lastName?.trim()) {
        student = {
          id: row.studentId || studentId(),
          firstName: row.firstName.trim(),
          lastName: row.lastName.trim(),
          createdAt: new Date().toISOString(),
        };
        db.students.push(student);
      }

      if (!student) {
        unmatched.push(
          row.studentId ||
            `${row.firstName || "?"} ${row.lastName || "?"}`.trim()
        );
        continue;
      }

      const ranks = row.ranks.map((r) => r.trim()).filter(Boolean);
      if (ranks.length === 0) continue;

      const existing = db.priorities.find(
        (p) => p.sessionId === sessionId && p.studentId === student!.id
      );
      if (existing) {
        existing.ranks = ranks;
        existing.firstName = student.firstName;
        existing.lastName = student.lastName;
        existing.updatedAt = new Date().toISOString();
      } else {
        const entry: WeeklyPriority = {
          id: uid("pri"),
          sessionId,
          studentId: student.id,
          firstName: student.firstName,
          lastName: student.lastName,
          ranks,
          updatedAt: new Date().toISOString(),
        };
        db.priorities.push(entry);
      }
      saved++;
    }

    // Re-sync attendance shells for all claims after priority change
    const claims = db.assignments.filter((a) => a.sessionId === sessionId);
    const seen = new Set<string>();
    for (const c of claims) {
      const key = `${c.studentId}|${c.day}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const winner = pickEffectiveClaim(db, sessionId, c.studentId, c.day);
      if (winner) {
        ensureAttendanceShell(
          db,
          sessionId,
          winner.teacherId,
          c.studentId,
          c.day
        );
      }
    }

    return { saved, unmatched };
  });
}

export async function listPriorities(sessionId: string): Promise<WeeklyPriority[]> {
  const db = await readDb();
  return db.priorities
    .filter((p) => p.sessionId === sessionId)
    .sort(
      (a, b) =>
        a.lastName.localeCompare(b.lastName) ||
        a.firstName.localeCompare(b.firstName)
    );
}

export async function getStudentSchedule(sessionId: string, studentId: string) {
  const db = await readDb();
  const days: DayOfWeek[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const schedule = [];
  for (const day of days) {
    const a = pickEffectiveClaim(db, sessionId, studentId, day);
    if (!a) continue;
    const teacher = db.people.find((p) => p.id === a.teacherId);
    const join = db.teacherJoins.find(
      (j) => j.sessionId === sessionId && j.teacherId === a.teacherId
    );
    const choice = db.studentChoices.find(
      (c) =>
        c.sessionId === sessionId &&
        c.studentId === studentId &&
        c.day === day
    );
    // Edit clock starts at the student's own selection (choice or open signup)
    const editStamp =
      a.type === "open_study" || a.type === "student_choice"
        ? a.createdAt
        : choice?.teacherId === a.teacherId
          ? choice.createdAt
          : null;
    const canEdit = Boolean(editStamp && withinStudentEditWindow(editStamp));
    schedule.push({
      ...a,
      teacherName: teacher?.name ?? "Unknown",
      roomName: join?.roomName ?? teacher?.roomName ?? "—",
      canEdit,
      editExpiresAt: editStamp ? studentEditExpiresAt(editStamp) : null,
      selectedAt: editStamp,
    });
  }
  return schedule;
}

// ─── Attendance ───────────────────────────────────────────────────────────

export async function markAttendance(params: {
  sessionId: string;
  teacherId: string;
  studentId: string;
  day: DayOfWeek;
  status: AttendanceRecord["status"];
  markedBy: string;
}): Promise<AttendanceRecord | null> {
  const { sessionId, teacherId, studentId, day, status, markedBy } = params;
  return updateDb((db) => {
    const session = db.sessions.find((s) => s.id === sessionId);
    if (!session) return null;
    const marker = db.people.find((p) => p.id === markedBy);
    const markedByName = marker?.name ?? null;
    const date = dateForDay(session.weekOf, day);
    let rec = db.attendance.find(
      (a) =>
        a.sessionId === sessionId &&
        a.studentId === studentId &&
        a.day === day
    );
    // Shared record: any teacher who has this student can mark; present shows for everyone
    if (!rec) {
      rec = {
        id: uid("att"),
        sessionId,
        teacherId,
        studentId,
        day,
        date,
        status,
        markedAt: new Date().toISOString(),
        markedBy,
        markedByName,
      };
      db.attendance.push(rec);
    } else {
      rec.status = status;
      rec.markedAt = new Date().toISOString();
      rec.markedBy = markedBy;
      rec.markedByName = markedByName;
      // Keep effective room owner if known
      const winner = pickEffectiveClaim(db, sessionId, studentId, day);
      if (winner) rec.teacherId = winner.teacherId;
    }
    return rec;
  });
}

export async function bulkMarkAttendance(params: {
  sessionId: string;
  teacherId: string;
  day: DayOfWeek;
  marks: { studentId: string; status: AttendanceRecord["status"] }[];
  markedBy: string;
}): Promise<number> {
  let count = 0;
  for (const m of params.marks) {
    const rec = await markAttendance({
      sessionId: params.sessionId,
      teacherId: params.teacherId,
      studentId: m.studentId,
      day: params.day,
      status: m.status,
      markedBy: params.markedBy,
    });
    if (rec) count++;
  }
  return count;
}

// ─── Admin overview ───────────────────────────────────────────────────────

export async function adminOverview(sessionId: string, day: DayOfWeek) {
  const db = await readDb();
  const session = db.sessions.find((s) => s.id === sessionId);
  if (!session) return null;

  // Effective (priority-resolved) placements for this day
  const studentIdsWithClaims = [
    ...new Set(
      db.assignments
        .filter((a) => a.sessionId === sessionId && a.day === day)
        .map((a) => a.studentId)
    ),
  ];
  const effectiveByStudent = new Map<string, Assignment>();
  for (const sid of studentIdsWithClaims) {
    const winner = pickEffectiveClaim(db, sessionId, sid, day);
    if (winner) effectiveByStudent.set(sid, winner);
  }
  const allAssignments = [...effectiveByStudent.values()];

  const teachers = db.teacherJoins
    .filter((j) => j.sessionId === sessionId)
    .map((j) => {
      const person = db.people.find((p) => p.id === j.teacherId);
      const dayAssignments = allAssignments.filter(
        (a) => a.teacherId === j.teacherId
      );
      const students = dayAssignments.map((a) => {
        const s = db.students.find((x) => x.id === a.studentId);
        const att = db.attendance.find(
          (x) =>
            x.sessionId === sessionId &&
            x.studentId === a.studentId &&
            x.day === day
        );
        const claimCount = db.assignments.filter(
          (c) =>
            c.sessionId === sessionId &&
            c.studentId === a.studentId &&
            c.day === day
        ).length;
        return {
          studentId: a.studentId,
          firstName: s?.firstName ?? "?",
          lastName: s?.lastName ?? "?",
          type: a.type,
          attendanceStatus: att?.status ?? ("unmarked" as const),
          contested: claimCount > 1,
        };
      });
      return {
        teacherId: j.teacherId,
        teacherName: person?.name ?? "Unknown",
        roomName: j.roomName,
        isOpenStudy: j.isOpenStudy,
        students: students.sort(
          (a, b) =>
            a.lastName.localeCompare(b.lastName) ||
            a.firstName.localeCompare(b.firstName)
        ),
        present: students.filter((s) => s.attendanceStatus === "present").length,
        absent: students.filter((s) => s.attendanceStatus === "absent").length,
        unmarked: students.filter((s) => s.attendanceStatus === "unmarked").length,
        excused: students.filter((s) => s.attendanceStatus === "excused").length,
      };
    });

  const missing = allAssignments
    .map((a) => {
      const att = db.attendance.find(
        (x) =>
          x.sessionId === sessionId &&
          x.studentId === a.studentId &&
          x.day === day
      );
      const status = att?.status ?? "unmarked";
      if (status === "present" || status === "excused") return null;
      const s = db.students.find((x) => x.id === a.studentId);
      const teacher = db.people.find((p) => p.id === a.teacherId);
      const join = db.teacherJoins.find(
        (j) => j.sessionId === sessionId && j.teacherId === a.teacherId
      );
      return {
        studentId: a.studentId,
        firstName: s?.firstName ?? "?",
        lastName: s?.lastName ?? "?",
        teacherId: a.teacherId,
        teacherName: teacher?.name ?? "Unknown",
        roomName: join?.roomName ?? "—",
        day: a.day,
        assignmentType: a.type,
        attendanceStatus: status,
      };
    })
    .filter(Boolean);

  const unassigned = db.students.filter((s) => {
    const inRoster = db.roster.some(
      (r) => r.sessionId === sessionId && r.studentId === s.id
    );
    if (!inRoster) return false;
    return !effectiveByStudent.has(s.id);
  });

  // Master roster: every unique student from every teacher's class list
  const sessionRoster = db.roster.filter((r) => r.sessionId === sessionId);
  const studentIds = [...new Set(sessionRoster.map((r) => r.studentId))];

  const weekDays: DayOfWeek[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];

  const masterRoster = studentIds
    .map((studentId) => {
      const s = db.students.find((x) => x.id === studentId);
      if (!s) return null;

      const classRows = sessionRoster
        .filter((r) => r.studentId === studentId)
        .map((r) => {
          const teacher = db.people.find((p) => p.id === r.teacherId);
          const join = db.teacherJoins.find(
            (j) => j.sessionId === sessionId && j.teacherId === r.teacherId
          );
          return {
            teacherId: r.teacherId,
            teacherName: teacher?.name ?? "Unknown",
            roomName: join?.roomName ?? teacher?.roomName ?? "—",
            period: r.period,
            subject: r.subject,
          };
        });

      // De-dupe identical class rows
      const seenClass = new Set<string>();
      const classes = classRows.filter((c) => {
        const key = `${c.teacherId}|${c.period}|${c.subject}`;
        if (seenClass.has(key)) return false;
        seenClass.add(key);
        return true;
      });

      const dayAssignment = pickEffectiveClaim(db, sessionId, studentId, day);

      let location: {
        roomName: string;
        teacherName: string;
        teacherId: string;
        type: Assignment["type"];
        attendanceStatus: AttendanceRecord["status"];
        contested: boolean;
        claims: string[];
      } | null = null;

      const dayClaims = db.assignments.filter(
        (a) =>
          a.sessionId === sessionId &&
          a.studentId === studentId &&
          a.day === day
      );

      if (dayAssignment) {
        const teacher = db.people.find((p) => p.id === dayAssignment.teacherId);
        const join = db.teacherJoins.find(
          (j) =>
            j.sessionId === sessionId && j.teacherId === dayAssignment.teacherId
        );
        const att = db.attendance.find(
          (x) =>
            x.sessionId === sessionId &&
            x.studentId === studentId &&
            x.day === day
        );
        location = {
          roomName: join?.roomName ?? teacher?.roomName ?? "—",
          teacherName: teacher?.name ?? "Unknown",
          teacherId: dayAssignment.teacherId,
          type: dayAssignment.type,
          attendanceStatus: att?.status ?? "unmarked",
          contested: dayClaims.length > 1,
          claims: dayClaims.map((c) => teacherLabel(db, sessionId, c.teacherId)),
        };
      }

      const week = weekDays.map((d) => {
        const a = pickEffectiveClaim(db, sessionId, studentId, d);
        if (!a) {
          return {
            day: d,
            roomName: null as string | null,
            teacherName: null as string | null,
            type: null as Assignment["type"] | null,
            contested: false,
          };
        }
        const teacher = db.people.find((p) => p.id === a.teacherId);
        const join = db.teacherJoins.find(
          (j) => j.sessionId === sessionId && j.teacherId === a.teacherId
        );
        const claimCount = db.assignments.filter(
          (c) =>
            c.sessionId === sessionId &&
            c.studentId === studentId &&
            c.day === d
        ).length;
        return {
          day: d,
          roomName: join?.roomName ?? teacher?.roomName ?? "—",
          teacherName: teacher?.name ?? "Unknown",
          type: a.type,
          contested: claimCount > 1,
        };
      });

      const priority = db.priorities.find(
        (p) => p.sessionId === sessionId && p.studentId === studentId
      );

      return {
        studentId,
        firstName: s.firstName,
        lastName: s.lastName,
        classes,
        location,
        week,
        priorityRanks: priority?.ranks ?? [],
      };
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        a!.lastName.localeCompare(b!.lastName) ||
        a!.firstName.localeCompare(b!.firstName)
    );

  const located = masterRoster.filter((s) => s!.location).length;
  const notLocated = masterRoster.length - located;

  return {
    session,
    day,
    teachers,
    missing,
    unassigned,
    masterRoster,
    totals: {
      assigned: allAssignments.length,
      present: allAssignments.filter((a) => {
        const att = db.attendance.find(
          (x) =>
            x.sessionId === sessionId &&
            x.studentId === a.studentId &&
            x.day === day
        );
        return att?.status === "present";
      }).length,
      absent: allAssignments.filter((a) => {
        const att = db.attendance.find(
          (x) =>
            x.sessionId === sessionId &&
            x.studentId === a.studentId &&
            x.day === day
        );
        return att?.status === "absent";
      }).length,
      unmarked: allAssignments.filter((a) => {
        const att = db.attendance.find(
          (x) =>
            x.sessionId === sessionId &&
            x.studentId === a.studentId &&
            x.day === day
        );
        return !att || att.status === "unmarked";
      }).length,
      rooms: teachers.length,
      /** Unique students across all teacher class lists */
      totalStudents: masterRoster.length,
      located,
      notLocated,
    },
  };
}

/** Search master roster by name or student ID */
export async function adminSearchStudents(
  sessionId: string,
  day: DayOfWeek,
  query: string
) {
  const overview = await adminOverview(sessionId, day);
  if (!overview) return null;
  const q = query.trim().toLowerCase();
  if (!q) return overview.masterRoster;
  return overview.masterRoster.filter((s) => {
    if (!s) return false;
    return (
      s.firstName.toLowerCase().includes(q) ||
      s.lastName.toLowerCase().includes(q) ||
      `${s.firstName} ${s.lastName}`.toLowerCase().includes(q) ||
      `${s.lastName}, ${s.firstName}`.toLowerCase().includes(q) ||
      s.studentId.toLowerCase().includes(q) ||
      s.location?.roomName.toLowerCase().includes(q) ||
      s.location?.teacherName.toLowerCase().includes(q) ||
      s.classes.some(
        (c) =>
          c.subject.toLowerCase().includes(q) ||
          c.teacherName.toLowerCase().includes(q) ||
          c.roomName.toLowerCase().includes(q)
      )
    );
  });
}

function offersForSessionWeek(
  db: Database,
  sessionId: string,
  teacherId?: string
): TeacherOffer[] {
  const session = db.sessions.find((s) => s.id === sessionId);
  const weekOf = session?.weekOf;
  const weekDates = weekOf
    ? DAYS.map((d) => dateForDay(weekOf, d))
    : [];
  return db.teacherOffers.filter((o) => {
    if (teacherId && o.teacherId !== teacherId) return false;
    // Prefer date match for the session week (calendar offers may be future weeks)
    if (weekDates.length && o.date && weekDates.includes(o.date)) return true;
    // Legacy offers without a date, tied to this session only
    if (!o.date && o.sessionId === sessionId) return true;
    return false;
  });
}

export async function listOpenStudyRooms(
  sessionId: string,
  day?: DayOfWeek,
  grade?: GradeLevel | null
) {
  const db = await readDb();
  const d = day || "Mon";
  const session = db.sessions.find((s) => s.id === sessionId);
  const iso = session ? dateForDay(session.weekOf, d) : null;

  const openOffers = db.teacherOffers.filter((o) => {
    if (o.accessMode !== "open") return false;
    if (iso && o.date === iso) return true;
    if (o.sessionId === sessionId && (!o.date || o.date === iso)) return true;
    return false;
  });
  return openOffers
    .filter((o) => {
      if (!grade) return true;
      return o.grades.includes(grade);
    })
    .map((o) => {
      const person = db.people.find((p) => p.id === o.teacherId);
      const taken = countInTeacherRoom(db, sessionId, o.teacherId, d);
      const cap = o.capacity || 30;
      return {
        offerId: o.id,
        teacherId: o.teacherId,
        teacherName: person?.name ?? "Unknown",
        roomName: o.roomName,
        subject: o.subject,
        unitTitle: o.unitTitle,
        grades: o.grades,
        date: o.date,
        offeringName: o.unitTitle,
        offeringSubject: o.subject,
        capacity: cap,
        taken,
        seatsLeft: Math.max(0, cap - taken),
        accessMode: "open" as const,
      };
    });
}

/** Compiled offerings board for a session week (or explicit week Monday) */
export async function listCompiledOffers(
  sessionId: string,
  weekOf?: string
) {
  const db = await readDb();
  const session = db.sessions.find((s) => s.id === sessionId);
  const mon = weekOf || session?.weekOf || mondayOfWeek();
  const weekDates = DAYS.map((d) => dateForDay(mon, d));

  const rows = db.teacherOffers
    .filter(
      (o) =>
        (o.date && weekDates.includes(o.date)) ||
        (!o.date && o.sessionId === sessionId)
    )
    .map((o) => {
      const teacher = db.people.find((p) => p.id === o.teacherId);
      return {
        ...o,
        teacherName: teacher?.name ?? "Unknown",
        gradeLabel: o.grades.slice().sort().join("/"),
      };
    })
    .sort((a, b) => {
      const da = (a.date || "").localeCompare(b.date || "");
      if (da !== 0) return da;
      const sub = a.subject.localeCompare(b.subject);
      if (sub !== 0) return sub;
      return a.unitTitle.localeCompare(b.unitTitle);
    });

  const bySubject: Record<string, typeof rows> = {};
  for (const r of rows) {
    if (!bySubject[r.subject]) bySubject[r.subject] = [];
    bySubject[r.subject]!.push(r);
  }
  return {
    rows,
    bySubject,
    subjects: Object.keys(bySubject).sort(),
    weekOf: mon,
    weekLabel: formatWeekLabel(mon),
  };
}

export async function listTeacherOffers(
  sessionId: string,
  teacherId?: string,
  weekOf?: string
): Promise<(TeacherOffer & { teacherName: string })[]> {
  const db = await readDb();
  const session = db.sessions.find((s) => s.id === sessionId);
  const mon = weekOf || session?.weekOf;
  let list: TeacherOffer[];
  if (mon) {
    const weekDates = DAYS.map((d) => dateForDay(mon, d));
    list = db.teacherOffers.filter((o) => {
      if (teacherId && o.teacherId !== teacherId) return false;
      if (o.date && weekDates.includes(o.date)) return true;
      // Legacy: no date, bound to this session
      if (!o.date && o.sessionId === sessionId) return true;
      return false;
    });
  } else {
    list = offersForSessionWeek(db, sessionId, teacherId);
  }
  return list
    .map((o) => ({
      ...o,
      teacherName:
        db.people.find((p) => p.id === o.teacherId)?.name ?? "Unknown",
    }))
    .sort(
      (a, b) =>
        (a.date || "").localeCompare(b.date || "") ||
        a.subject.localeCompare(b.subject)
    );
}

/** All offers for a teacher (any week) — calendar + quick-add */
export async function listAllTeacherOffers(
  teacherId: string
): Promise<(TeacherOffer & { teacherName: string })[]> {
  const db = await readDb();
  return db.teacherOffers
    .filter((o) => o.teacherId === teacherId)
    .map((o) => ({
      ...o,
      teacherName:
        db.people.find((p) => p.id === o.teacherId)?.name ?? "Unknown",
    }))
    .sort(
      (a, b) =>
        (a.date || "").localeCompare(b.date || "") ||
        a.subject.localeCompare(b.subject)
    );
}

export async function listTeacherOffersByRange(params: {
  teacherId?: string;
  startDate: string;
  endDate: string;
}): Promise<(TeacherOffer & { teacherName: string })[]> {
  const db = await readDb();
  return db.teacherOffers
    .filter((o) => {
      if (params.teacherId && o.teacherId !== params.teacherId) return false;
      if (!o.date) return false;
      return o.date >= params.startDate && o.date <= params.endDate;
    })
    .map((o) => ({
      ...o,
      teacherName:
        db.people.find((p) => p.id === o.teacherId)?.name ?? "Unknown",
    }))
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
}

export async function upsertTeacherOffer(params: {
  id?: string;
  sessionId?: string;
  /** ISO date required for school-year pipeline */
  date?: string;
  teacherId: string;
  grades: GradeLevel[];
  subject: string;
  unitTitle: string;
  accessMode: "open" | "closed";
  roomName: string;
  capacity?: number;
}): Promise<TeacherOffer | { error: string }> {
  return updateDb((db) => {
    const grades = [...new Set(params.grades)].filter(
      (g): g is GradeLevel => g === "7" || g === "8"
    );
    if (grades.length === 0) {
      return { error: "Select 7th and/or 8th grade." };
    }
    if (!params.subject.trim()) return { error: "Subject is required." };
    if (!params.unitTitle.trim()) return { error: "Unit / title is required." };
    if (!params.roomName.trim()) return { error: "Room number is required." };

    let date = params.date?.trim() || "";
    if (!date && params.sessionId) {
      const ses = db.sessions.find((s) => s.id === params.sessionId);
      date = ses?.weekOf || mondayOfWeek();
    }
    if (!date) return { error: "Pick a date for this offering." };
    if (dayOfWeekFromDate(date) === null) {
      return { error: "Offerings can only be on weekdays (Mon–Fri)." };
    }

    // Link only to a session whose week contains this offer date
    const weekMon = mondayOfWeek(new Date(date + "T12:00:00"));
    let session =
      (params.sessionId &&
        db.sessions.find(
          (s) => s.id === params.sessionId && s.weekOf === weekMon
        )) ||
      db.sessions.find((s) => s.status === "active" && s.weekOf === weekMon) ||
      db.sessions.find((s) => s.weekOf === weekMon);

    const capacity = Math.max(1, Math.floor(params.capacity || 30));

    if (params.id) {
      const existing = db.teacherOffers.find(
        (o) => o.id === params.id && o.teacherId === params.teacherId
      );
      if (!existing) return { error: "Offer not found." };
      existing.grades = grades;
      existing.subject = params.subject.trim();
      existing.unitTitle = params.unitTitle.trim();
      existing.accessMode = params.accessMode;
      existing.roomName = params.roomName.trim();
      existing.capacity = capacity;
      existing.date = date;
      if (session) existing.sessionId = session.id;
      if (session) {
        const join = db.teacherJoins.find(
          (j) =>
            j.sessionId === session.id && j.teacherId === params.teacherId
        );
        if (join) {
          join.roomName = existing.roomName;
          join.accessMode = existing.accessMode;
          join.isOpenStudy = existing.accessMode === "open";
          join.capacity = existing.capacity;
        }
      }
      return existing;
    }

    const offer: TeacherOffer = {
      id: uid("tof"),
      date,
      sessionId: session?.id,
      teacherId: params.teacherId,
      grades,
      subject: params.subject.trim(),
      unitTitle: params.unitTitle.trim(),
      accessMode: params.accessMode,
      roomName: params.roomName.trim(),
      capacity,
      createdAt: new Date().toISOString(),
    };
    db.teacherOffers.push(offer);

    if (session) {
      const join = db.teacherJoins.find(
        (j) =>
          j.sessionId === session.id && j.teacherId === params.teacherId
      );
      if (join) {
        join.roomName = offer.roomName;
        if (offer.accessMode === "open") {
          join.accessMode = "open";
          join.isOpenStudy = true;
          join.capacity = offer.capacity;
        }
      }
    }
    return offer;
  });
}

export async function deleteTeacherOffer(
  id: string,
  teacherId: string
): Promise<boolean> {
  return updateDb((db) => {
    const before = db.teacherOffers.length;
    db.teacherOffers = db.teacherOffers.filter(
      (o) => !(o.id === id && o.teacherId === teacherId)
    );
    return db.teacherOffers.length < before;
  });
}

/**
 * Free students (no teacher required them) are randomly put into open rooms
 * with seats left. Students already requested by teachers (even if still
 * choosing among rooms) are NOT auto-moved — they stay in the required/choice flow.
 */
export async function autoPlaceUnassigned(params: {
  sessionId: string;
  day: DayOfWeek;
}): Promise<{
  placed: number;
  stillOpen: number;
  awaitingChoice: number;
  noOpenSeats: number;
  details: string[];
  awaitingChoiceNames: string[];
  noSeatsNames: string[];
}> {
  return updateDb((db) => {
    const { sessionId, day } = params;
    const rosteredIds = [
      ...new Set(
        db.roster
          .filter((r) => r.sessionId === sessionId)
          .map((r) => r.studentId)
      ),
    ];

    const freeForOpen: string[] = [];
    const awaitingChoice: string[] = [];
    const awaitingChoiceNames: string[] = [];

    for (const sid of rosteredIds) {
      const winner = pickEffectiveClaim(db, sessionId, sid, day);
      if (winner) continue; // already in a room

      const requiredClaims = db.assignments.filter(
        (a) =>
          a.sessionId === sessionId &&
          a.studentId === sid &&
          a.day === day &&
          a.type === "required"
      );

      if (requiredClaims.length > 0) {
        // Teacher(s) requested them — do not dump into random open rooms
        const student = db.students.find((s) => s.id === sid);
        const names = requiredClaims
          .map((c) => teacherContact(db, sessionId, c.teacherId).label)
          .join(" / ");
        awaitingChoice.push(sid);
        awaitingChoiceNames.push(
          `${student?.lastName ?? "?"}, ${student?.firstName ?? "?"} → choose among: ${names}`
        );
        // Drop any failed auto open_study that can't override required claims
        db.assignments = db.assignments.filter(
          (a) =>
            !(
              a.sessionId === sessionId &&
              a.studentId === sid &&
              a.day === day &&
              a.type === "open_study"
            )
        );
        continue;
      }

      freeForOpen.push(sid);
    }

    const details: string[] = [];
    const noSeatsNames: string[] = [];
    let placed = 0;

    const shuffled = [...freeForOpen].sort(() => Math.random() - 0.5);

    const seatsLeft = (offer: TeacherOffer) => {
      const taken = countInTeacherRoom(db, sessionId, offer.teacherId, day);
      return (offer.capacity || 30) - taken;
    };

    for (const sid of shuffled) {
      const student = db.students.find((s) => s.id === sid);
      if (!student) continue;

      let pool = db.teacherOffers.filter((o) => {
        if (o.sessionId !== sessionId || o.accessMode !== "open") return false;
        if (student.grade && !o.grades.includes(student.grade)) return false;
        return seatsLeft(o) > 0;
      });

      // Grade unknown or no grade-matched seats → any open room with space
      if (pool.length === 0) {
        pool = db.teacherOffers.filter(
          (o) =>
            o.sessionId === sessionId &&
            o.accessMode === "open" &&
            seatsLeft(o) > 0
        );
      }

      if (pool.length === 0) {
        const msg = `${student.lastName}, ${student.firstName}: no open seats left`;
        details.push(msg);
        noSeatsNames.push(`${student.lastName}, ${student.firstName}`);
        continue;
      }

      // Prefer rooms with more remaining capacity (balance fill)
      pool.sort((a, b) => seatsLeft(b) - seatsLeft(a));
      const top = seatsLeft(pool[0]!);
      const best = pool.filter((o) => seatsLeft(o) === top);
      const pick = best[Math.floor(Math.random() * best.length)]!;

      db.assignments = db.assignments.filter(
        (a) =>
          !(
            a.sessionId === sessionId &&
            a.studentId === sid &&
            a.day === day &&
            a.type !== "required"
          )
      );
      db.assignments.push({
        id: uid("asn"),
        sessionId,
        teacherId: pick.teacherId,
        studentId: sid,
        day,
        type: "open_study",
        offerId: pick.id,
        studentFirstName: student.firstName,
        studentLastName: student.lastName,
        createdAt: new Date().toISOString(),
      });
      ensureAttendanceShell(db, sessionId, pick.teacherId, sid, day);
      placed++;
      details.push(
        `${student.lastName}, ${student.firstName} → Room ${pick.roomName} (${pick.unitTitle}) · ${teacherContact(db, sessionId, pick.teacherId).teacherName}`
      );
    }

    return {
      placed,
      stillOpen: noSeatsNames.length,
      awaitingChoice: awaitingChoice.length,
      noOpenSeats: noSeatsNames.length,
      details,
      awaitingChoiceNames,
      noSeatsNames,
    };
  });
}

export async function setStudentGrade(
  studentId: string,
  grade: GradeLevel | null
): Promise<Student | null> {
  return updateDb((db) => {
    const s = db.students.find((x) => x.id === studentId);
    if (!s) return null;
    s.grade = grade;
    return s;
  });
}

// ─── School-year calendar (priorities + offerings) ────────────────────────

export type CalendarDayView = {
  day: DayOfWeek;
  date: string;
  dateLabel: string;
  primarySubject: string | null;
  subjectOrder: string[];
  note: string;
  isToday: boolean;
  dayType: "tutorial" | "no_tutorial" | "special";
  offerCount: number;
  openOfferCount: number;
};

function subjectList(db: Database): string[] {
  const subjectSet = new Set<string>([...DEFAULT_SUBJECTS]);
  for (const o of db.offerings) {
    if (o.subject) subjectSet.add(o.subject);
  }
  for (const o of db.teacherOffers) {
    if (o.subject) subjectSet.add(o.subject);
  }
  return [...subjectSet].sort();
}

function dayViewForDate(
  db: Database,
  date: string
): CalendarDayView | null {
  const day = dayOfWeekFromDate(date);
  if (!day) return null;
  const entry = db.dayPriorities.find((d) => d.date === date);
  const offers = db.teacherOffers.filter((o) => o.date === date);
  return {
    day,
    date,
    dateLabel: formatShortDate(date),
    primarySubject: entry?.subjectOrder?.[0] ?? null,
    subjectOrder: entry?.subjectOrder ?? [],
    note: entry?.note ?? "",
    isToday: date === todayISO(),
    dayType: entry?.dayType || "tutorial",
    offerCount: offers.length,
    openOfferCount: offers.filter((o) => o.accessMode === "open").length,
  };
}

/** Session-week view (back-compat + strip) */
export async function getPriorityCalendar(sessionId: string): Promise<{
  weekOf: string;
  weekLabel: string;
  days: CalendarDayView[];
  subjects: string[];
}> {
  const db = await readDb();
  const session = db.sessions.find((s) => s.id === sessionId);
  const weekOf = session?.weekOf || mondayOfWeek();
  const days: CalendarDayView[] = [];
  for (const day of DAYS) {
    const date = dateForDay(weekOf, day);
    const view = dayViewForDate(db, date);
    if (view) days.push(view);
  }
  return {
    weekOf,
    weekLabel: formatWeekLabel(weekOf),
    days,
    subjects: subjectList(db),
  };
}

export async function getSchoolYearCalendar(params: {
  year?: number;
  month?: number;
  weekOf?: string;
  view: "month" | "week";
  teacherId?: string;
}): Promise<{
  schoolYear: { label: string; startDate: string; endDate: string };
  view: "month" | "week";
  year: number;
  month: number;
  monthLabel: string;
  weekOf: string;
  weekLabel: string;
  subjects: string[];
  /** Month grid cells */
  cells: {
    date: string;
    inMonth: boolean;
    isWeekend: boolean;
    inSchoolYear: boolean;
    primarySubject: string | null;
    dayType: string;
    offerCount: number;
    openOfferCount: number;
    myOfferCount: number;
    isToday: boolean;
  }[];
  /** Week detail Mon–Fri */
  weekDays: CalendarDayView[];
  weekOffers: (TeacherOffer & { teacherName: string })[];
  weeks: string[];
}> {
  const db = await readDb();
  const sy = schoolYearForDate(new Date());
  const today = new Date();
  const year = params.year || today.getFullYear();
  const month = params.month || today.getMonth() + 1;
  const weekOf = params.weekOf || mondayOfWeek();

  const cells = monthGrid(year, month).map((c) => {
    const pri = db.dayPriorities.find((d) => d.date === c.date);
    const offers = db.teacherOffers.filter((o) => o.date === c.date);
    const myOffers = params.teacherId
      ? offers.filter((o) => o.teacherId === params.teacherId)
      : offers;
    return {
      date: c.date,
      inMonth: c.inMonth,
      isWeekend: c.isWeekend,
      inSchoolYear: c.date >= sy.startDate && c.date <= sy.endDate,
      primarySubject: pri?.subjectOrder?.[0] ?? null,
      dayType: pri?.dayType || "tutorial",
      offerCount: offers.length,
      openOfferCount: offers.filter((o) => o.accessMode === "open").length,
      myOfferCount: myOffers.length,
      isToday: c.date === todayISO(),
    };
  });

  const weekDays: CalendarDayView[] = [];
  for (const day of DAYS) {
    const date = dateForDay(weekOf, day);
    const view = dayViewForDate(db, date);
    if (view) weekDays.push(view);
  }

  const weekDates = DAYS.map((d) => dateForDay(weekOf, d));
  const weekOffers = db.teacherOffers
    .filter((o) => o.date && weekDates.includes(o.date))
    .filter((o) => !params.teacherId || o.teacherId === params.teacherId)
    .map((o) => ({
      ...o,
      teacherName:
        db.people.find((p) => p.id === o.teacherId)?.name ?? "Unknown",
    }))
    .sort(
      (a, b) =>
        (a.date || "").localeCompare(b.date || "") ||
        a.subject.localeCompare(b.subject)
    );

  return {
    schoolYear: {
      label: sy.label,
      startDate: sy.startDate,
      endDate: sy.endDate,
    },
    view: params.view,
    year,
    month,
    monthLabel: formatMonthLabel(year, month),
    weekOf,
    weekLabel: formatWeekLabel(weekOf),
    subjects: subjectList(db),
    cells,
    weekDays,
    weekOffers,
    weeks: weeksInSchoolYear(sy.startDate, sy.endDate),
  };
}

export async function setDaySubjectPriority(params: {
  sessionId?: string;
  date?: string;
  day?: DayOfWeek;
  subjectOrder: string[];
  note?: string;
  dayType?: "tutorial" | "no_tutorial" | "special";
}): Promise<DaySubjectPriority> {
  return updateDb((db) => {
    let date = params.date?.trim() || "";
    let day = params.day;
    if (!date && params.sessionId && params.day) {
      const session = db.sessions.find((s) => s.id === params.sessionId);
      date = session
        ? dateForDay(session.weekOf, params.day)
        : dateForDay(mondayOfWeek(), params.day);
      day = params.day;
    }
    if (!date) throw new Error("date required");
    const dow = dayOfWeekFromDate(date);
    if (!dow) throw new Error("Priorities only apply to weekdays");
    day = day || dow;

    const order = params.subjectOrder.map((s) => s.trim()).filter(Boolean);
    const existing = db.dayPriorities.find((d) => d.date === date);
    if (existing) {
      existing.subjectOrder = order;
      existing.note = params.note?.trim() || "";
      existing.day = day;
      existing.dayType = params.dayType || existing.dayType || "tutorial";
      if (params.sessionId) existing.sessionId = params.sessionId;
      existing.updatedAt = new Date().toISOString();
      return existing;
    }
    const entry: DaySubjectPriority = {
      id: uid("dsp"),
      date,
      day,
      sessionId: params.sessionId,
      subjectOrder: order,
      dayType: params.dayType || "tutorial",
      note: params.note?.trim() || "",
      updatedAt: new Date().toISOString(),
    };
    db.dayPriorities.push(entry);
    return entry;
  });
}

/** Apply same primary subject to all weekdays in a week (by Monday) */
export async function setWeekSubjectPriority(params: {
  sessionId?: string;
  weekOf?: string;
  subjectOrder: string[];
  note?: string;
}): Promise<DaySubjectPriority[]> {
  let weekOf = params.weekOf;
  if (!weekOf && params.sessionId) {
    const db = await readDb();
    weekOf = db.sessions.find((s) => s.id === params.sessionId)?.weekOf;
  }
  weekOf = weekOf || mondayOfWeek();
  const results: DaySubjectPriority[] = [];
  for (const day of DAYS) {
    const date = dateForDay(weekOf, day);
    const entry = await setDaySubjectPriority({
      sessionId: params.sessionId,
      date,
      day,
      subjectOrder: params.subjectOrder,
      note: params.note,
    });
    results.push(entry);
  }
  return results;
}

export async function clearDaySubjectPriority(
  sessionIdOrDate: string,
  day?: DayOfWeek
): Promise<boolean> {
  return updateDb((db) => {
    const before = db.dayPriorities.length;
    if (day) {
      // legacy: sessionId + day
      const session = db.sessions.find((s) => s.id === sessionIdOrDate);
      const date = session
        ? dateForDay(session.weekOf, day)
        : sessionIdOrDate;
      db.dayPriorities = db.dayPriorities.filter((d) => d.date !== date);
    } else {
      // date only
      db.dayPriorities = db.dayPriorities.filter(
        (d) => d.date !== sessionIdOrDate
      );
    }
    return db.dayPriorities.length < before;
  });
}

export async function getActiveSessions(): Promise<TutorialSession[]> {
  const db = await readDb();
  return db.sessions.filter((s) => s.status === "active");
}

// ─── Tutorial offerings (admin-defined sections) ──────────────────────────

export async function listOfferings(
  sessionId: string
): Promise<TutorialOffering[]> {
  const db = await readDb();
  return db.offerings
    .filter((o) => o.sessionId === sessionId)
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
}

export async function upsertOffering(params: {
  sessionId: string;
  id?: string;
  name: string;
  subject: string;
  description?: string;
  priority: number;
  defaultCapacity: number;
}): Promise<TutorialOffering> {
  return updateDb((db) => {
    if (params.id) {
      const existing = db.offerings.find((o) => o.id === params.id);
      if (existing) {
        existing.name = params.name.trim();
        existing.subject = params.subject.trim();
        existing.description = (params.description || "").trim();
        existing.priority = Math.max(1, Math.floor(params.priority));
        existing.defaultCapacity = Math.max(
          1,
          Math.floor(params.defaultCapacity || 30)
        );
        return existing;
      }
    }
    const offering: TutorialOffering = {
      id: uid("off"),
      sessionId: params.sessionId,
      name: params.name.trim(),
      subject: params.subject.trim(),
      description: (params.description || "").trim(),
      priority: Math.max(1, Math.floor(params.priority)),
      defaultCapacity: Math.max(1, Math.floor(params.defaultCapacity || 30)),
      createdAt: new Date().toISOString(),
    };
    db.offerings.push(offering);
    return offering;
  });
}

export async function deleteOffering(id: string): Promise<boolean> {
  return updateDb((db) => {
    const before = db.offerings.length;
    db.offerings = db.offerings.filter((o) => o.id !== id);
    for (const j of db.teacherJoins) {
      if (j.offeringId === id) j.offeringId = null;
    }
    return db.offerings.length < before;
  });
}

// ─── Admin grants ─────────────────────────────────────────────────────────

export async function listAdminGrants(): Promise<
  (AdminGrant & { isBootstrap?: boolean })[]
> {
  const db = await readDb();
  const grants = db.adminGrants.map((g) => ({ ...g, isBootstrap: false }));
  const bootstrap = getBootstrapAdminNames().map((name) => ({
    id: `bootstrap:${normAdminName(name)}`,
    name,
    grantedById: "system",
    grantedByName: "System (hardcoded)",
    createdAt: "",
    isBootstrap: true,
  }));
  return [...bootstrap, ...grants];
}

export async function grantAdminAccess(params: {
  name: string;
  grantedById: string;
}): Promise<AdminGrant | { error: string }> {
  return updateDb((db) => {
    const granter = db.people.find((p) => p.id === params.grantedById);
    if (!granter || granter.role !== "admin") {
      return { error: "Only an admin can grant admin access." };
    }
    if (!canBecomeAdmin(db, granter.name) && granter.role !== "admin") {
      return { error: "Not authorized." };
    }
    const name = params.name.trim();
    if (!name) return { error: "Name is required." };
    if (canBecomeAdmin(db, name)) {
      // Already allowed — return existing grant or synthetic
      const existing = db.adminGrants.find(
        (g) => normAdminName(g.name) === normAdminName(name)
      );
      if (existing) return existing;
    }
    const grant: AdminGrant = {
      id: uid("agr"),
      name,
      grantedById: granter.id,
      grantedByName: granter.name,
      createdAt: new Date().toISOString(),
    };
    db.adminGrants.push(grant);
    return grant;
  });
}

export async function revokeAdminAccess(
  grantId: string,
  byAdminId: string
): Promise<{ ok: true } | { error: string }> {
  return updateDb((db) => {
    const granter = db.people.find((p) => p.id === byAdminId);
    if (!granter || granter.role !== "admin") {
      return { error: "Only an admin can revoke access." };
    }
    if (grantId.startsWith("bootstrap:")) {
      return { error: "Cannot revoke hardcoded bootstrap admins." };
    }
    const before = db.adminGrants.length;
    db.adminGrants = db.adminGrants.filter((g) => g.id !== grantId);
    if (db.adminGrants.length === before) {
      return { error: "Grant not found." };
    }
    return { ok: true as const };
  });
}

export async function getStudentDayChoices(
  sessionId: string,
  studentId: string
) {
  const db = await readDb();
  const days: DayOfWeek[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  return days.map((day) => {
    const winner = pickEffectiveClaim(db, sessionId, studentId, day);
    const choice = db.studentChoices.find(
      (c) =>
        c.sessionId === sessionId &&
        c.studentId === studentId &&
        c.day === day
    );
    const canEditChoice = Boolean(
      choice && withinStudentEditWindow(choice.createdAt)
    );
    const options = getStudentChoiceOptions(db, sessionId, studentId, day, {
      includeAfterChoice: canEditChoice,
    });
    // Still need a first pick, or re-pick inside the edit window
    const needsChoice = options.length > 0 && !choice;
    const canRechoose = options.length > 0 && canEditChoice;
    return {
      day,
      resolved: Boolean(winner),
      winner: winner
        ? {
            teacherId: winner.teacherId,
            label: teacherLabel(db, sessionId, winner.teacherId),
            type: winner.type,
          }
        : null,
      needsChoice,
      canRechoose,
      canEdit: canEditChoice,
      editExpiresAt: choice ? studentEditExpiresAt(choice.createdAt) : null,
      options,
      chosenTeacherId: choice?.teacherId ?? null,
    };
  });
}
