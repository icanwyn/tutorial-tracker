export type Role = "admin" | "teacher" | "student";

export type DayOfWeek = "Mon" | "Tue" | "Wed" | "Thu" | "Fri";

export const DAYS: DayOfWeek[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];

export type AttendanceStatus = "present" | "absent" | "excused" | "unmarked";

export type AssignmentType = "required" | "open_study" | "student_choice";

/** Open = free students may sign up (FCFS); closed = required students only */
export type RoomAccessMode = "open" | "closed";

export type GradeLevel = "7" | "8";

/** Departments shown on the printed tutorial offerings sheet */
export const DEFAULT_SUBJECTS = [
  "English",
  "History",
  "Math",
  "Science",
  "World Languages",
  "Electives",
  "General Support",
] as const;

export interface Person {
  id: string;
  name: string;
  role: Role;
  roomName?: string;
  createdAt: string;
}

export interface TutorialSession {
  id: string;
  name: string;
  joinCode: string;
  weekOf: string;
  status: "active" | "closed";
  adminId: string;
  createdAt: string;
}

export type CalendarDayType = "tutorial" | "no_tutorial" | "special";

/**
 * School-year subject priority for a specific calendar date.
 * Used when multiple teachers request the same student that day.
 */
export interface DaySubjectPriority {
  id: string;
  /** ISO date YYYY-MM-DD — primary key for school-year calendar */
  date: string;
  day: DayOfWeek;
  /** @deprecated optional link to a live session week */
  sessionId?: string;
  /**
   * Subjects ordered highest → lowest priority for this day.
   * subjectOrder[0] is the day’s primary focus (e.g. “English”).
   */
  subjectOrder: string[];
  dayType?: CalendarDayType;
  note?: string;
  updatedAt: string;
}

/**
 * Admin-defined subject catalog / priority order (optional).
 * Lower priority number = higher subject priority when teachers request the same student.
 */
export interface TutorialOffering {
  id: string;
  sessionId: string;
  name: string;
  subject: string;
  description: string;
  priority: number;
  defaultCapacity: number;
  createdAt: string;
}

/**
 * One tutorial offering on a specific date (school-year pipeline).
 * Matches handout: Grade | Subject | Unit/Title | Open/Closed | Room | Teacher
 * Students see offerings for the current week only.
 */
export interface TeacherOffer {
  id: string;
  /** ISO date this offering runs */
  date: string;
  /** Optional link when a live session is active that week */
  sessionId?: string;
  teacherId: string;
  /** 7th and/or 8th */
  grades: GradeLevel[];
  subject: string;
  unitTitle: string;
  accessMode: RoomAccessMode;
  roomName: string;
  /** Seat cap when open (first-come first-served) */
  capacity: number;
  createdAt: string;
}

/** Teacher membership in a session */
export interface TeacherJoin {
  id: string;
  sessionId: string;
  teacherId: string;
  roomName: string;
  offeringId: string | null;
  accessMode: RoomAccessMode;
  capacity: number;
  isOpenStudy: boolean;
  joinedAt: string;
}

export interface Student {
  /**
   * Canonical student key. Prefer the district/school SIS ID when known
   * so every teacher’s class list reuses the same person (not 7 copies).
   */
  id: string;
  /** Optional display of SIS id if different from id */
  schoolId?: string | null;
  firstName: string;
  lastName: string;
  /** Used to filter open offerings (7 or 8) */
  grade?: GradeLevel | null;
  createdAt: string;
}

export interface RosterEntry {
  id: string;
  sessionId: string;
  teacherId: string;
  studentId: string;
  period: string;
  subject: string;
  createdAt: string;
}

/**
 * Permanent class list on the teacher’s account (not tied to one week).
 * Copied into each new tutorial session when they join so daily/weekly
 * sign-in keeps the roster; offerings stay week-specific.
 */
export interface TeacherClassListEntry {
  id: string;
  teacherId: string;
  studentId: string;
  period: string;
  subject: string;
  createdAt: string;
  updatedAt: string;
}

/** Teacher request or student self-placement for a day */
export interface Assignment {
  id: string;
  sessionId: string;
  teacherId: string;
  studentId: string;
  day: DayOfWeek;
  type: AssignmentType;
  /** Which teacher offer they signed into (open list / auto-place) */
  offerId?: string | null;
  /** Snapshot so attendance still shows a name if student row is missing */
  studentFirstName?: string | null;
  studentLastName?: string | null;
  createdAt: string;
}

/**
 * When multiple teachers request a student and none have subject priority,
 * the student picks one of those rooms.
 */
export interface StudentChoice {
  id: string;
  sessionId: string;
  studentId: string;
  day: DayOfWeek;
  teacherId: string;
  createdAt: string;
}

export interface AttendanceRecord {
  id: string;
  sessionId: string;
  /** Room that currently "owns" the shell (effective placement) */
  teacherId: string;
  studentId: string;
  day: DayOfWeek;
  date: string;
  status: AttendanceStatus;
  markedAt: string | null;
  markedBy: string | null;
  /** Display name of who marked (shared across all lists) */
  markedByName: string | null;
}

/**
 * Per-student room/teacher priority list (optional legacy/admin override).
 * ranks[0] is highest. Prefer offering.priority when set.
 */
export interface WeeklyPriority {
  id: string;
  sessionId: string;
  studentId: string;
  firstName: string;
  lastName: string;
  ranks: string[];
  updatedAt: string;
}

/** Explicit grant allowing a person (by name) to sign in as admin */
export interface AdminGrant {
  id: string;
  name: string;
  grantedById: string;
  grantedByName: string;
  createdAt: string;
}

export interface Database {
  people: Person[];
  sessions: TutorialSession[];
  teacherJoins: TeacherJoin[];
  students: Student[];
  roster: RosterEntry[];
  /** Year-long / permanent class lists keyed by teacher */
  teacherClassLists: TeacherClassListEntry[];
  assignments: Assignment[];
  attendance: AttendanceRecord[];
  priorities: WeeklyPriority[];
  offerings: TutorialOffering[];
  teacherOffers: TeacherOffer[];
  /** Per-day subject priority calendar for each session week */
  dayPriorities: DaySubjectPriority[];
  adminGrants: AdminGrant[];
  studentChoices: StudentChoice[];
}

export interface StudentLocation {
  studentId: string;
  firstName: string;
  lastName: string;
  day: DayOfWeek;
  teacherId: string | null;
  teacherName: string | null;
  roomName: string | null;
  assignmentType: AssignmentType | null;
  attendanceStatus: AttendanceStatus;
}

export interface MissingStudent {
  studentId: string;
  firstName: string;
  lastName: string;
  teacherId: string;
  teacherName: string;
  roomName: string;
  day: DayOfWeek;
  assignmentType: AssignmentType;
}
