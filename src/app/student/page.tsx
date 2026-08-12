"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { YearCalendar } from "@/components/YearCalendar";
import { api, loadStudentId, saveStudentId } from "@/lib/client";
import { dateForDay, formatWeekLabel, todayDay } from "@/lib/dates";
import type { DayOfWeek, GradeLevel, Student, TutorialSession } from "@/lib/types";
import { DAYS } from "@/lib/types";

/** Calendar day cells — navy/slate with light text */
const CELL_BG = "linear-gradient(165deg, #1e293b 0%, #0f172a 100%)";
const CELL_BG_TODAY = "linear-gradient(165deg, #334155 0%, #1e293b 100%)";
const CELL_TEXT = "#e2e8f0";
const CELL_MUTED = "#94a3b8";
const CELL_BORDER = "rgba(148, 163, 184, 0.28)";

type SelectionConfirm = {
  day: DayOfWeek;
  dateLabel: string;
  roomName: string;
  teacherName: string;
  subject?: string;
  unitTitle?: string;
  kind: "open" | "required";
  editExpiresAt: string;
  canEdit: boolean;
};

function formatDayDate(weekOf: string | undefined, day: DayOfWeek): string {
  if (!weekOf) return day;
  const iso = dateForDay(weekOf, day);
  const d = new Date(iso + "T12:00:00");
  // e.g. "Mon · Aug 12"
  const weekday = d.toLocaleDateString("en-US", { weekday: "short" });
  const md = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${weekday} · ${md}`;
}

/** Month + day only, e.g. "Aug 12" */
function formatMonthDay(weekOf: string | undefined, day: DayOfWeek): string {
  if (!weekOf) return "";
  const iso = dateForDay(weekOf, day);
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatRemain(ms: number): string {
  if (ms <= 0) return "0:00";
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

type ScheduleItem = {
  id: string;
  day: DayOfWeek;
  type: "required" | "open_study" | "student_choice";
  teacherName: string;
  roomName: string;
  teacherId: string;
  createdAt?: string;
  canEdit?: boolean;
  editExpiresAt?: string | null;
  selectedAt?: string | null;
};

type OpenRoom = {
  offerId?: string;
  teacherId: string;
  teacherName: string;
  roomName: string;
  subject?: string;
  unitTitle?: string;
  offeringName?: string | null;
  grades?: string[];
  capacity?: number;
  taken?: number;
  seatsLeft?: number;
};

type DayChoice = {
  day: DayOfWeek;
  resolved: boolean;
  winner: { teacherId: string; label: string; type: string } | null;
  needsChoice: boolean;
  canRechoose?: boolean;
  canEdit?: boolean;
  editExpiresAt?: string | null;
  options: {
    teacherId: string;
    teacherName: string;
    roomName: string;
    offeringName: string | null;
  }[];
  chosenTeacherId: string | null;
};

export default function StudentPage() {
  const [mode, setMode] = useState<"lookup" | "register">("lookup");
  const [studentId, setStudentId] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [grade, setGrade] = useState<GradeLevel | "">("");
  const [student, setStudent] = useState<Student | null>(null);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [choices, setChoices] = useState<DayChoice[]>([]);
  const [sessions, setSessions] = useState<TutorialSession[]>([]);
  const [sessionId, setSessionId] = useState<string>("");
  const [openRooms, setOpenRooms] = useState<OpenRoom[]>([]);
  const [signupDay, setSignupDay] = useState<DayOfWeek>("Mon");
  const [signupOffer, setSignupOffer] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [confirm, setConfirm] = useState<SelectionConfirm | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [loading, setLoading] = useState(false);
  const [booting, setBooting] = useState(true);
  const confirmRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = loadStudentId();
    if (id) {
      setStudentId(id);
      void lookup(id);
    }
    const js = new Date().getDay();
    if (js >= 1 && js <= 5) setSignupDay(DAYS[js - 1]!);
    setBooting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Countdown for 5-minute edit window
  useEffect(() => {
    const hasWindow =
      (confirm?.canEdit && confirm.editExpiresAt) ||
      schedule.some((s) => s.canEdit && s.editExpiresAt) ||
      choices.some((c) => c.canEdit && c.editExpiresAt);
    if (!hasWindow) return;
    const t = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [confirm, schedule, choices]);

  function remainMs(expiresAt: string | null | undefined): number {
    if (!expiresAt) return 0;
    return Math.max(0, new Date(expiresAt).getTime() - nowTick);
  }

  function isStillEditable(expiresAt: string | null | undefined): boolean {
    return remainMs(expiresAt) > 0;
  }

  function scrollToConfirm() {
    requestAnimationFrame(() => {
      confirmRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  async function lookup(id?: string) {
    const sid = (id || studentId).trim();
    if (!sid) {
      setError("Enter your student ID.");
      return;
    }
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      const data = await api<{
        student: Student;
        schedule: ScheduleItem[] | null;
        choices: DayChoice[] | null;
        sessions: TutorialSession[];
      }>(`/api/students?id=${encodeURIComponent(sid)}`);
      setStudent(data.student);
      if (data.student.grade) setGrade(data.student.grade);
      saveStudentId(data.student.id);
      setSessions(data.sessions || []);
      const activeId = data.sessions?.[0]?.id || sessionId || "";
      setSessionId(activeId);
      setSchedule(data.schedule || []);
      setChoices(data.choices || []);
      if (activeId) {
        await loadOpenRooms(activeId, signupDay, data.student.grade || null);
      }
    } catch (e) {
      setStudent(null);
      setError(e instanceof Error ? e.message : "Student not found");
    } finally {
      setLoading(false);
    }
  }

  async function loadOpenRooms(
    sid: string,
    day: DayOfWeek,
    g?: GradeLevel | null
  ) {
    try {
      const q = new URLSearchParams({
        openStudy: "1",
        sessionId: sid,
        day,
      });
      if (g) q.set("grade", g);
      const data = await api<{ rooms: OpenRoom[] }>(`/api/students?${q}`);
      setOpenRooms(data.rooms);
      if (data.rooms[0]?.offerId) setSignupOffer(data.rooms[0].offerId);
      else if (data.rooms[0]) setSignupOffer(data.rooms[0].teacherId);
    } catch {
      setOpenRooms([]);
    }
  }

  async function refreshSchedule(sid: string, studId: string) {
    const data = await api<{
      schedule: ScheduleItem[];
      choices: DayChoice[];
    }>(`/api/assignments?sessionId=${sid}&studentId=${studId}`);
    setSchedule(data.schedule);
    setChoices(data.choices || []);
  }

  async function saveGrade(g: GradeLevel | "") {
    if (!student) return;
    setGrade(g);
    if (!g) return;
    try {
      const data = await api<{ student: Student }>("/api/students", {
        method: "POST",
        body: JSON.stringify({
          action: "set_grade",
          id: student.id,
          grade: g,
        }),
      });
      setStudent(data.student);
      if (sessionId) await loadOpenRooms(sessionId, signupDay, g);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save grade");
    }
  }

  async function registerStudent() {
    if (!firstName.trim() || !lastName.trim()) {
      setError("First and last name are required.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const { student: s } = await api<{ student: Student }>("/api/students", {
        method: "POST",
        body: JSON.stringify({
          firstName,
          lastName,
          grade: grade || undefined,
        }),
      });
      setStudent(s);
      setStudentId(s.id);
      saveStudentId(s.id);
      setSuccess(`Registered! Your ID is ${s.id}.`);
      const sess = await api<{ sessions: TutorialSession[] }>(
        "/api/sessions?active=1"
      );
      setSessions(sess.sessions);
      if (sess.sessions[0]) {
        setSessionId(sess.sessions[0].id);
        await loadOpenRooms(
          sess.sessions[0].id,
          signupDay,
          (s.grade as GradeLevel) || null
        );
      }
      setSchedule([]);
      setChoices([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  function activeWeekOf(): string | undefined {
    return sessions.find((s) => s.id === sessionId)?.weekOf;
  }

  async function selfSignup() {
    if (!student || !sessionId || !signupOffer) {
      setError("Pick a day and an open offering.");
      return;
    }
    const placed = schedule.find((s) => s.day === signupDay);
    if (placed && placed.type === "required") {
      setError("You already have a required tutorial that day.");
      return;
    }
    if (
      placed &&
      (placed.type === "open_study" || placed.type === "student_choice") &&
      !isStillEditable(placed.editExpiresAt)
    ) {
      setError(
        "Your selection is locked. You had 5 minutes after selecting to change it."
      );
      return;
    }
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      const room = openRooms.find(
        (r) => r.offerId === signupOffer || r.teacherId === signupOffer
      );
      const res = await api<{ assignment: ScheduleItem }>("/api/assignments", {
        method: "POST",
        body: JSON.stringify({
          action: "self_signup",
          sessionId,
          studentId: student.id,
          teacherId: room?.teacherId || signupOffer,
          offerId: room?.offerId || signupOffer,
          day: signupDay,
        }),
      });
      const createdAt = res.assignment?.createdAt || new Date().toISOString();
      const editExpiresAt = new Date(
        new Date(createdAt).getTime() + 5 * 60 * 1000
      ).toISOString();
      const conf: SelectionConfirm = {
        day: signupDay,
        dateLabel: formatDayDate(activeWeekOf(), signupDay),
        roomName: room?.roomName || "TBD",
        teacherName: room?.teacherName || "Teacher",
        subject: room?.subject,
        unitTitle: room?.unitTitle || room?.offeringName || undefined,
        kind: "open",
        editExpiresAt,
        canEdit: true,
      };
      setConfirm(conf);
      setSuccess(
        `Confirmed — report to Room ${conf.roomName} on ${conf.dateLabel}. You have 5 minutes to change this if you made a mistake.`
      );
      await refreshSchedule(sessionId, student.id);
      await loadOpenRooms(
        sessionId,
        signupDay,
        student.grade || (grade as GradeLevel) || null
      );
      scrollToConfirm();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Signup failed");
    } finally {
      setLoading(false);
    }
  }

  async function chooseRoom(
    day: DayOfWeek,
    teacherId: string,
    option?: DayChoice["options"][0]
  ) {
    if (!student || !sessionId) return;
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const res = await api<{
        ok: boolean;
        editExpiresAt?: string;
        choice?: { createdAt: string };
      }>("/api/assignments", {
        method: "POST",
        body: JSON.stringify({
          action: "student_choice",
          sessionId,
          studentId: student.id,
          teacherId,
          day,
        }),
      });
      const editExpiresAt =
        res.editExpiresAt ||
        (res.choice?.createdAt
          ? new Date(
              new Date(res.choice.createdAt).getTime() + 5 * 60 * 1000
            ).toISOString()
          : new Date(Date.now() + 5 * 60 * 1000).toISOString());
      const conf: SelectionConfirm = {
        day,
        dateLabel: formatDayDate(activeWeekOf(), day),
        roomName: option?.roomName || "TBD",
        teacherName: option?.teacherName || "Teacher",
        unitTitle: option?.offeringName || undefined,
        kind: "required",
        editExpiresAt,
        canEdit: true,
      };
      setConfirm(conf);
      setSuccess(
        `Confirmed — report to Room ${conf.roomName} on ${conf.dateLabel}. You have 5 minutes to change this if you made a mistake.`
      );
      await refreshSchedule(sessionId, student.id);
      scrollToConfirm();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save choice");
    } finally {
      setLoading(false);
    }
  }

  async function clearSelection(day: DayOfWeek) {
    if (!student || !sessionId) return;
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      await api("/api/assignments", {
        method: "POST",
        body: JSON.stringify({
          action: "clear_selection",
          sessionId,
          studentId: student.id,
          day,
        }),
      });
      if (confirm?.day === day) setConfirm(null);
      setSuccess(
        `Selection cleared for ${formatDayDate(activeWeekOf(), day)}. Pick a new room if needed.`
      );
      await refreshSchedule(sessionId, student.id);
      await loadOpenRooms(
        sessionId,
        day,
        student.grade || (grade as GradeLevel) || null
      );
      setSignupDay(day);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not clear selection");
    } finally {
      setLoading(false);
    }
  }

  function startEditDay(day: DayOfWeek, kind: "open" | "required") {
    setSignupDay(day);
    if (sessionId && student) {
      void loadOpenRooms(
        sessionId,
        day,
        student.grade || (grade as GradeLevel) || null
      );
    }
    if (kind === "open") {
      requestAnimationFrame(() => {
        document
          .getElementById("open-signup-section")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }

  function signOut() {
    setStudent(null);
    setSchedule([]);
    setChoices([]);
    setConfirm(null);
    setStudentId("");
    if (typeof window !== "undefined") {
      localStorage.removeItem("tt_student");
    }
  }

  const weekOf = activeWeekOf();

  const byDay = DAYS.map((d) => ({
    day: d,
    dateLabel: formatDayDate(weekOf, d),
    item: schedule.find((s) => s.day === d) || null,
    choice: choices.find((c) => c.day === d) || null,
  }));

  const placedSignup = schedule.find((s) => s.day === signupDay);
  const requiredBlocksSignup = placedSignup?.type === "required";
  const openLocked =
    placedSignup?.type === "open_study" &&
    !isStillEditable(placedSignup.editExpiresAt);
  /** Open signup allowed when free, or changing an open placement inside the 5-min window */
  const freeForSignup = !requiredBlocksSignup && !openLocked;

  if (booting) {
    return (
      <>
        <TopBar subtitle="Student" />
        <main className="container" style={{ padding: "2rem 0" }}>
          <p className="muted">Loading…</p>
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar
        subtitle="Student"
        right={
          student ? (
            <>
              <span className="muted" style={{ fontSize: "0.875rem" }}>
                {student.firstName} {student.lastName}
                {student.grade ? ` · ${student.grade}th` : ""}
              </span>
              <button className="btn btn-secondary btn-sm" onClick={signOut}>
                Sign out
              </button>
              <Link href="/" className="btn btn-secondary btn-sm">
                Home
              </Link>
            </>
          ) : (
            <Link href="/" className="btn btn-secondary btn-sm">
              Home
            </Link>
          )
        }
      />
      <main className="container stack" style={{ padding: "1.5rem 0 3rem" }}>
        {error ? <div className="error-banner">{error}</div> : null}
        {success ? <div className="success-banner">{success}</div> : null}

        {!student ? (
          <div className="card card-pad" style={{ maxWidth: 480 }}>
            <div className="tabs" style={{ marginBottom: "1rem" }}>
              <button
                className={`tab ${mode === "lookup" ? "active" : ""}`}
                onClick={() => setMode("lookup")}
              >
                I have my ID
              </button>
              <button
                className={`tab ${mode === "register" ? "active" : ""}`}
                onClick={() => setMode("register")}
              >
                Get a new ID
              </button>
            </div>
            {mode === "lookup" ? (
              <div className="stack">
                <div className="field">
                  <label>Student ID</label>
                  <input
                    className="input"
                    value={studentId}
                    onChange={(e) => setStudentId(e.target.value.toUpperCase())}
                    placeholder="e.g. STU-A3F9C2"
                    onKeyDown={(e) => e.key === "Enter" && lookup()}
                  />
                </div>
                <button
                  className="btn btn-primary"
                  disabled={!studentId.trim() || loading}
                  onClick={() => lookup()}
                >
                  Look up
                </button>
              </div>
            ) : (
              <div className="stack">
                <div className="field">
                  <label>First name</label>
                  <input
                    className="input"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>Last name</label>
                  <input
                    className="input"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>Grade</label>
                  <select
                    className="select"
                    value={grade}
                    onChange={(e) =>
                      setGrade(e.target.value as GradeLevel | "")
                    }
                  >
                    <option value="">—</option>
                    <option value="7">7th</option>
                    <option value="8">8th</option>
                  </select>
                </div>
                <button
                  className="btn btn-primary"
                  disabled={!firstName.trim() || !lastName.trim() || loading}
                  onClick={registerStudent}
                >
                  Create student ID
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="card card-pad">
              <div className="code-pill" style={{ fontSize: "1.1rem" }}>
                {student.id}
              </div>
              <div style={{ marginTop: 8, fontWeight: 650 }}>
                {student.firstName} {student.lastName}
              </div>
              <div className="field" style={{ marginTop: 12, maxWidth: 160 }}>
                <label>My grade (filters open offerings)</label>
                <select
                  className="select"
                  value={grade || student.grade || ""}
                  onChange={(e) =>
                    void saveGrade(e.target.value as GradeLevel | "")
                  }
                >
                  <option value="">Not set</option>
                  <option value="7">7th</option>
                  <option value="8">8th</option>
                </select>
              </div>
            </div>

            {choices.some((c) => c.needsChoice || c.canRechoose) ? (
              <div className="card card-pad stack" id="required-choice-section">
                <h3 className="section-title">Choose your required room</h3>
                <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>
                  Multiple teachers requested you and none have higher subject
                  priority — pick one. After you select, you have{" "}
                  <strong>5 minutes</strong> to change your mind.
                </p>
                {choices
                  .filter((c) => c.needsChoice || c.canRechoose)
                  .map((c) => (
                    <div key={c.day} className="stack" style={{ gap: 6 }}>
                      <strong>
                        {formatDayDate(weekOf, c.day)}
                        <span className="muted" style={{ fontWeight: 500 }}>
                          {" "}
                          ({c.day})
                        </span>
                        {c.canRechoose && c.editExpiresAt ? (
                          <span
                            className="badge badge-amber"
                            style={{ marginLeft: 8, fontWeight: 600 }}
                          >
                            Change within {formatRemain(remainMs(c.editExpiresAt))}
                          </span>
                        ) : null}
                      </strong>
                      <div className="row">
                        {c.options.map((o) => (
                          <button
                            key={o.teacherId}
                            className={`btn btn-sm ${
                              c.chosenTeacherId === o.teacherId
                                ? "btn-primary"
                                : "btn-secondary"
                            }`}
                            disabled={loading}
                            onClick={() => chooseRoom(c.day, o.teacherId, o)}
                          >
                            Room {o.roomName} · {o.teacherName}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            ) : null}

            {/* Confirmation appears after selection */}
            {confirm ? (
              <div
                ref={confirmRef}
                className="card card-pad"
                role="status"
                aria-live="polite"
                style={{
                  border: "2px solid var(--gold)",
                  boxShadow: "var(--shadow-gold)",
                  background:
                    "linear-gradient(165deg, rgba(201,162,39,0.16), rgba(15,26,42,0.98) 55%)",
                }}
              >
                <div
                  className="muted"
                  style={{
                    fontSize: "0.68rem",
                    fontWeight: 750,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    marginBottom: 6,
                  }}
                >
                  Selection confirmed — report here
                </div>
                <div
                  style={{
                    fontSize: "1.35rem",
                    fontWeight: 800,
                    color: "var(--gold-bright)",
                    letterSpacing: "0.02em",
                  }}
                >
                  Room {confirm.roomName}
                </div>
                <div style={{ marginTop: 8, fontWeight: 650 }}>
                  {confirm.dateLabel}
                  <span className="muted" style={{ fontWeight: 500 }}>
                    {" "}
                    ({confirm.day})
                  </span>
                </div>
                <div className="muted" style={{ marginTop: 4, fontSize: "0.9rem" }}>
                  {confirm.subject ? `${confirm.subject}` : null}
                  {confirm.subject && confirm.unitTitle ? " · " : null}
                  {confirm.unitTitle || null}
                  {(confirm.subject || confirm.unitTitle) && confirm.teacherName
                    ? " · "
                    : null}
                  {confirm.teacherName}
                </div>
                <p
                  style={{
                    margin: "0.85rem 0 0",
                    fontSize: "0.9rem",
                    color: "var(--silver-bright)",
                  }}
                >
                  Go to{" "}
                  <strong style={{ color: "var(--gold-bright)" }}>
                    Room {confirm.roomName}
                  </strong>{" "}
                  on <strong>{confirm.dateLabel}</strong>
                  {confirm.kind === "required"
                    ? " for your required tutorial."
                    : " for your open-room signup."}
                </p>
                {isStillEditable(confirm.editExpiresAt) ? (
                  <div
                    style={{
                      marginTop: 12,
                      padding: "0.65rem 0.75rem",
                      borderRadius: 10,
                      background: "rgba(224,188,75,0.12)",
                      border: "1px solid rgba(224,188,75,0.35)",
                    }}
                  >
                    <div style={{ fontSize: "0.85rem", marginBottom: 8 }}>
                      Mistake? You can edit for{" "}
                      <strong style={{ color: "var(--gold-bright)" }}>
                        {formatRemain(remainMs(confirm.editExpiresAt))}
                      </strong>
                    </div>
                    <div className="row" style={{ gap: 8 }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={loading}
                        onClick={() =>
                          startEditDay(confirm.day, confirm.kind)
                        }
                      >
                        Change room
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        disabled={loading}
                        onClick={() => void clearSelection(confirm.day)}
                      >
                        Clear selection
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="muted" style={{ margin: "0.75rem 0 0", fontSize: "0.85rem" }}>
                    Edit window closed — this selection is locked.
                  </p>
                )}
              </div>
            ) : null}

            <div className="card card-pad">
              <div
                className="row"
                style={{
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: 12,
                  marginBottom: 4,
                  flexWrap: "wrap",
                }}
              >
                <h3 className="section-title" style={{ margin: 0 }}>
                  Your week
                </h3>
                {weekOf ? (
                  <span className="muted" style={{ fontSize: "0.85rem" }}>
                    {formatWeekLabel(weekOf)}
                  </span>
                ) : null}
              </div>
              <p className="muted" style={{ margin: "0 0 0.75rem", fontSize: "0.85rem" }}>
                Mon–Fri calendar. Report to the room shown each day. After you
                pick a room yourself, you have 5 minutes to change it.
              </p>
              <div className="your-week-cal">
                {byDay.map(({ day, item, choice }) => {
                  const isToday = todayDay() === day;
                  const canEditItem =
                    item &&
                    (item.type === "open_study" ||
                      item.type === "student_choice" ||
                      choice?.canEdit) &&
                    isStillEditable(item.editExpiresAt || choice?.editExpiresAt);
                  const monthDay = formatMonthDay(weekOf, day);
                  return (
                    <div
                      key={day}
                      style={{
                        minHeight: 148,
                        padding: "0.75rem 0.7rem",
                        borderRadius: 14,
                        background: isToday ? CELL_BG_TODAY : CELL_BG,
                        color: CELL_TEXT,
                        border: isToday
                          ? "2px solid var(--gold)"
                          : `1px solid ${CELL_BORDER}`,
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                        boxShadow: "0 8px 20px rgba(15, 23, 42, 0.25)",
                      }}
                    >
                      <div
                        className="row"
                        style={{
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          gap: 4,
                        }}
                      >
                        <div>
                          <div
                            style={{
                              fontWeight: 800,
                              fontSize: "1.05rem",
                              letterSpacing: "-0.02em",
                              color: CELL_TEXT,
                            }}
                          >
                            {day}
                          </div>
                          <div
                            style={{
                              fontSize: "0.78rem",
                              color: CELL_MUTED,
                              marginTop: 2,
                            }}
                          >
                            {monthDay}
                          </div>
                        </div>
                        {isToday ? (
                          <span
                            className="badge"
                            style={{
                              background: "rgba(201, 162, 39, 0.2)",
                              color: "var(--gold-bright)",
                              border: "1px solid rgba(201, 162, 39, 0.4)",
                              fontSize: "0.65rem",
                            }}
                          >
                            Today
                          </span>
                        ) : null}
                      </div>

                      <div style={{ flex: 1, minHeight: 0 }}>
                        {item ? (
                          <>
                            <span
                              className={
                                item.type === "required"
                                  ? "badge badge-blue"
                                  : "badge badge-teal"
                              }
                              style={{ fontSize: "0.65rem" }}
                            >
                              {item.type === "required" ? "Required" : "Open"}
                            </span>
                            <div
                              style={{
                                marginTop: 8,
                                fontWeight: 800,
                                fontSize: "0.95rem",
                                lineHeight: 1.25,
                                color: CELL_TEXT,
                              }}
                            >
                              Room {item.roomName}
                            </div>
                            <div
                              style={{
                                fontSize: "0.75rem",
                                color: CELL_MUTED,
                                marginTop: 4,
                                lineHeight: 1.3,
                              }}
                            >
                              {item.teacherName}
                            </div>
                          </>
                        ) : choice?.needsChoice ? (
                          <span className="badge badge-amber">Choose room ↑</span>
                        ) : (
                          <div
                            style={{
                              fontSize: "0.8rem",
                              color: CELL_MUTED,
                              lineHeight: 1.35,
                              marginTop: 4,
                            }}
                          >
                            Free — pick an open offering below
                          </div>
                        )}
                      </div>

                      {canEditItem ? (
                        <div
                          className="row"
                          style={{ gap: 4, flexWrap: "wrap", marginTop: "auto" }}
                        >
                          <span
                            style={{
                              fontSize: "0.68rem",
                              color: "var(--gold-bright)",
                              fontWeight: 650,
                              width: "100%",
                            }}
                          >
                            Edit{" "}
                            {formatRemain(
                              remainMs(
                                item.editExpiresAt || choice?.editExpiresAt
                              )
                            )}
                          </span>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={loading}
                            style={{ flex: 1, minWidth: 0, padding: "0.3rem 0.4rem" }}
                            onClick={() =>
                              startEditDay(
                                day,
                                item.type === "open_study" ? "open" : "required"
                              )
                            }
                          >
                            Change
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            disabled={loading}
                            style={{ flex: 1, minWidth: 0, padding: "0.3rem 0.4rem" }}
                            onClick={() => void clearSelection(day)}
                          >
                            Clear
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="card card-pad">
              <YearCalendar mode="student" sessionId={sessionId || undefined} />
            </div>

            <div className="card card-pad stack" id="open-signup-section">
              <h3 className="section-title">
                Sign up for open room (today / selected day)
              </h3>
              <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>
                If no teacher required you, choose an <strong>Open</strong> room
                for your grade. Seats are first-come first-served. After you
                confirm, you have <strong>5 minutes</strong> to change or clear.
              </p>
              <div className="field">
                <label>Day</label>
                <div className="row">
                  {DAYS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={`day-chip ${signupDay === d ? "selected" : ""}`}
                      onClick={() => {
                        setSignupDay(d);
                        if (sessionId) {
                          void loadOpenRooms(
                            sessionId,
                            d,
                            student.grade || (grade as GradeLevel) || null
                          );
                        }
                      }}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              {requiredBlocksSignup ? (
                <div className="error-banner">
                  You have a required tutorial on {signupDay} — open signup is
                  locked that day.
                </div>
              ) : openLocked ? (
                <div className="error-banner">
                  Your open-room selection for {signupDay} is locked (5-minute
                  edit window ended). Report to Room {placedSignup?.roomName}.
                </div>
              ) : openRooms.length === 0 ? (
                <div className="empty" style={{ padding: "1rem" }}>
                  No open offerings with seats for your grade on {signupDay}.
                </div>
              ) : (
                <>
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th></th>
                          <th>Grade</th>
                          <th>Subject</th>
                          <th>Unit / title</th>
                          <th>Room</th>
                          <th>Teacher</th>
                          <th>Seats</th>
                        </tr>
                      </thead>
                      <tbody>
                        {openRooms.map((r) => {
                          const id = r.offerId || r.teacherId;
                          return (
                            <tr
                              key={id}
                              onClick={() => setSignupOffer(id)}
                              style={{
                                cursor: "pointer",
                                background:
                                  signupOffer === id
                                    ? "var(--brand-soft)"
                                    : undefined,
                              }}
                            >
                              <td>
                                <input
                                  type="radio"
                                  checked={signupOffer === id}
                                  onChange={() => setSignupOffer(id)}
                                />
                              </td>
                              <td>{(r.grades || []).join("/") || "—"}</td>
                              <td>{r.subject || "—"}</td>
                              <td>{r.unitTitle || r.offeringName || "—"}</td>
                              <td>
                                <strong>{r.roomName}</strong>
                              </td>
                              <td>{r.teacherName}</td>
                              <td>
                                {typeof r.seatsLeft === "number"
                                  ? `${r.seatsLeft} left`
                                  : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {(() => {
                    const selected = openRooms.find(
                      (r) =>
                        r.offerId === signupOffer || r.teacherId === signupOffer
                    );
                    if (!selected) return null;
                    return (
                      <div
                        style={{
                          padding: "0.75rem 0.9rem",
                          borderRadius: 12,
                          background: "var(--silver)",
                          color: "var(--navy)",
                          border: "1px solid var(--silver-mid)",
                          fontSize: "0.9rem",
                        }}
                      >
                        <strong>You are about to select:</strong>
                        <div style={{ marginTop: 6, fontWeight: 800, fontSize: "1.05rem" }}>
                          Room {selected.roomName}
                        </div>
                        <div style={{ marginTop: 4, color: "var(--navy-mid)" }}>
                          {formatDayDate(weekOf, signupDay)} ({signupDay})
                          {selected.subject ? ` · ${selected.subject}` : ""}
                          {selected.unitTitle || selected.offeringName
                            ? ` · ${selected.unitTitle || selected.offeringName}`
                            : ""}
                          {` · ${selected.teacherName}`}
                        </div>
                      </div>
                    );
                  })()}
                  <button
                    className="btn btn-accent"
                    disabled={!sessionId || !signupOffer || loading}
                    onClick={selfSignup}
                  >
                    Confirm signup — Room{" "}
                    {openRooms.find(
                      (r) =>
                        r.offerId === signupOffer || r.teacherId === signupOffer
                    )?.roomName || "—"}{" "}
                    on {formatDayDate(weekOf, signupDay)}
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </main>
    </>
  );
}
