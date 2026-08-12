"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { StatusBadge } from "@/components/StatusBadge";
import {
  api,
  clearPerson,
  loadPerson,
  loadTeacherJoin,
  parseRosterFile,
  parseRosterText,
  savePerson,
  saveTeacherJoin,
  type RosterParseRow,
} from "@/lib/client";
import { YearCalendar } from "@/components/YearCalendar";
import { PriorityCalendarStrip } from "@/components/PriorityCalendar";
import type {
  AttendanceStatus,
  DayOfWeek,
  Person,
  TutorialSession,
} from "@/lib/types";
import { DAYS, DEFAULT_SUBJECTS } from "@/lib/types";

type RosterRow = {
  id: string;
  studentId: string;
  firstName: string;
  lastName: string;
  period: string;
  subject: string;
};

type DayStudent = {
  assignmentId: string;
  studentId: string;
  firstName: string;
  lastName: string;
  type: "required" | "open_study" | "student_choice";
  attendanceStatus: AttendanceStatus;
  attendanceId: string | null;
  isEffective?: boolean;
  effectiveRoom?: string | null;
  markedByName?: string | null;
  needsStudentChoice?: boolean;
  lostToPriority?: boolean;
  contestedWith?: string[];
  assignedTeacherId?: string | null;
  assignedTeacherName?: string | null;
  assignedRoomName?: string | null;
};

type StudentAssignment = {
  studentId: string;
  firstName: string;
  lastName: string;
  days: {
    day: DayOfWeek;
    type: "required" | "open_study" | "student_choice";
    isEffective: boolean;
    effectiveRoom: string | null;
    assignedTeacherId?: string | null;
    assignedTeacherName?: string | null;
    assignedRoomName?: string | null;
    needsStudentChoice?: boolean;
  }[];
};

export default function TeacherPage() {
  const [person, setPerson] = useState<Person | null>(null);
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [roomName, setRoomName] = useState("");
  const [isOpenStudy, setIsOpenStudy] = useState(false);
  const [accessMode, setAccessMode] = useState<"open" | "closed">("closed");
  const [offeringId, setOfferingId] = useState("");
  const [capacity, setCapacity] = useState("30");
  const [offerings, setOfferings] = useState<
    {
      id: string;
      name: string;
      subject: string;
      priority: number;
      defaultCapacity: number;
    }[]
  >([]);
  const [session, setSession] = useState<TutorialSession | null>(null);
  const [tab, setTab] = useState<
    "offers" | "roster" | "assign" | "attendance" | "calendar"
  >("offers");
  /** Bumps when teacher opens Priority calendar so we scroll to today */
  const [calendarFocusToken, setCalendarFocusToken] = useState(0);
  const [myOffers, setMyOffers] = useState<
    {
      id: string;
      date?: string;
      grades: ("7" | "8")[];
      subject: string;
      unitTitle: string;
      accessMode: "open" | "closed";
      roomName: string;
      capacity: number;
    }[]
  >([]);
  const [offerForm, setOfferForm] = useState({
    grade7: true,
    grade8: true,
    subject: "English",
    unitTitle: "",
    accessMode: "closed" as "open" | "closed",
    roomName: "",
    capacity: "30",
    day: "Mon" as DayOfWeek,
  });
  const [dirQuery, setDirQuery] = useState("");
  const [directory, setDirectory] = useState<
    { id: string; firstName: string; lastName: string; grade?: string | null }[]
  >([]);
  const [dirSelected, setDirSelected] = useState<Set<string>>(new Set());
  const [dirPeriod, setDirPeriod] = useState("1");
  const [dirSubject, setDirSubject] = useState("");
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [paste, setPaste] = useState("");
  const [previewRows, setPreviewRows] = useState<RosterParseRow[]>([]);
  const [previewWarnings, setPreviewWarnings] = useState<string[]>([]);
  const [previewSource, setPreviewSource] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignDays, setAssignDays] = useState<Set<DayOfWeek>>(new Set(["Mon"]));
  const [search, setSearch] = useState("");
  const [periodFilter, setPeriodFilter] = useState<string>("all");
  const [studentAssignments, setStudentAssignments] = useState<
    StudentAssignment[]
  >([]);

  const [attendDay, setAttendDay] = useState<DayOfWeek>("Mon");
  const [dayRoster, setDayRoster] = useState<DayStudent[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    const p = loadPerson();
    if (p?.role === "teacher") {
      setPerson(p);
      setName(p.name);
      if (p.roomName) setRoomName(p.roomName);
    }
    const join = loadTeacherJoin();
    if (join) {
      setRoomName(join.roomName);
      setIsOpenStudy(join.isOpenStudy);
      api<{ session: TutorialSession }>(`/api/sessions/${join.sessionId}`)
        .then((d) => setSession(d.session))
        .catch(() => {});
    }
    const js = new Date().getDay();
    if (js >= 1 && js <= 5) {
      setAttendDay(DAYS[js - 1]!);
      setAssignDays(new Set([DAYS[js - 1]!]));
    }
    setBooting(false);
  }, []);

  const loadRoster = useCallback(async () => {
    if (!session || !person) return;
    const data = await api<{ roster: RosterRow[] }>(
      `/api/roster?sessionId=${session.id}&teacherId=${person.id}`
    );
    setRoster(data.roster);
  }, [session, person]);

  const loadAssignments = useCallback(async () => {
    if (!session || !person) return;
    const data = await api<{ assignments: StudentAssignment[] }>(
      `/api/assignments?sessionId=${session.id}&teacherId=${person.id}`
    );
    setStudentAssignments(data.assignments);
  }, [session, person]);

  const loadDayRoster = useCallback(async () => {
    if (!session || !person) return;
    const data = await api<{ roster: DayStudent[] }>(
      `/api/attendance?sessionId=${session.id}&teacherId=${person.id}&day=${attendDay}`
    );
    setDayRoster(data.roster);
  }, [session, person, attendDay]);

  const loadMyOffers = useCallback(async () => {
    if (!person) return;
    // All offers for this teacher (calendar + quick-add, any week)
    const data = await api<{ offers: typeof myOffers }>(
      `/api/teacher-offers?all=1&teacherId=${person.id}`
    );
    setMyOffers(data.offers || []);
  }, [person]);

  useEffect(() => {
    if (session && person) {
      void loadRoster().catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load roster")
      );
      void loadAssignments().catch(() => {});
      void loadMyOffers().catch(() => {});
      api<{ offerings: typeof offerings }>(
        `/api/offerings?sessionId=${session.id}`
      )
        .then((d) => setOfferings(d.offerings || []))
        .catch(() => {});
    }
  }, [session, person, loadRoster, loadAssignments, loadMyOffers]);

  // Refresh published list whenever teacher opens the offerings tab
  useEffect(() => {
    if (session && person && tab === "offers") {
      void loadMyOffers().catch(() => {});
    }
  }, [tab, session, person, loadMyOffers]);

  useEffect(() => {
    if (session && person && tab === "attendance") {
      void loadDayRoster().catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load attendance")
      );
    }
  }, [session, person, tab, attendDay, loadDayRoster]);

  useEffect(() => {
    if (session && person && tab === "assign") {
      void loadAssignments().catch(() => {});
    }
  }, [session, person, tab, loadAssignments]);

  /** Single-step join / rejoin — same name + code restores class list */
  async function joinSession() {
    setError("");
    setSuccess("");
    if (!name.trim() || !joinCode.trim()) {
      setError("Name and join code are required.");
      return;
    }
    setLoading(true);
    try {
      const data = await api<{
        person: Person;
        session: TutorialSession;
        join: {
          roomName: string;
          isOpenStudy: boolean;
          accessMode?: "open" | "closed";
          sessionId: string;
          teacherId: string;
        };
        restored: boolean;
        rosterCount: number;
        offerCount?: number;
      }>("/api/teachers/join", {
        method: "POST",
        body: JSON.stringify({
          joinCode,
          name,
          personId: person?.id || loadPerson()?.id,
        }),
      });
      savePerson(data.person);
      setPerson(data.person);
      setSession(data.session);
      setIsOpenStudy(data.join.isOpenStudy);
      setRoomName(data.join.roomName || "");
      // Prefill offer form room from prior join if available
      if (data.join.roomName && data.join.roomName !== "—") {
        setOfferForm((f) => ({
          ...f,
          roomName: f.roomName || data.join.roomName,
        }));
      }
      saveTeacherJoin({
        sessionId: data.session.id,
        teacherId: data.person.id,
        roomName: data.join.roomName,
        isOpenStudy: data.join.isOpenStudy,
      });
      if (data.rosterCount > 0) {
        setSuccess(
          `Welcome back — class list restored (${data.rosterCount} student row${
            data.rosterCount === 1 ? "" : "s"
          } on your account). ` +
            (data.offerCount
              ? `${data.offerCount} offering(s) already this week. `
              : "Add this week’s tutorial offerings (they reset each week). ") +
            "You don’t need to re-upload your class list."
        );
        setTab(data.offerCount ? "assign" : "offers");
      } else if (data.restored) {
        setSuccess(
          `Welcome back. Upload your class list once — it stays on your account for every day and week.`
        );
        setTab("roster");
      } else {
        setSuccess(
          `Joined “${data.session.name}”. Upload your class list once (saved to your account), then add this week’s offerings.`
        );
        setTab("roster");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to join");
    } finally {
      setLoading(false);
    }
  }

  function applyParseResult(
    rows: RosterParseRow[],
    warnings: string[],
    source: string
  ) {
    setPreviewRows(rows);
    setPreviewWarnings(warnings);
    setPreviewSource(source);
    if (rows.length === 0) {
      setError(
        warnings[0] ||
          "No students found. Use columns: First Name, Last Name, Period, Subject."
      );
    } else {
      setError("");
      setSuccess(
        `Ready to import ${rows.length} student${rows.length === 1 ? "" : "s"} from ${source}.`
      );
    }
  }

  function onPasteChange(text: string) {
    setPaste(text);
    if (!text.trim()) {
      setPreviewRows([]);
      setPreviewWarnings([]);
      setPreviewSource("");
      return;
    }
    const result = parseRosterText(text);
    applyParseResult(result.rows, result.warnings, "copy & paste");
  }

  async function handleFile(file: File | null) {
    if (!file) return;
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (
        !["xlsx", "xls", "csv", "ods", "txt"].includes(ext || "") &&
        !file.type.includes("sheet") &&
        !file.type.includes("csv") &&
        !file.type.includes("excel")
      ) {
        // Still try — SheetJS handles many formats
      }
      const result = await parseRosterFile(file);
      // Also show first rows as paste-friendly preview text
      setPaste(
        result.rows
          .map(
            (r) =>
              `${r.firstName}, ${r.lastName}, ${r.period}, ${r.subject}${
                r.studentId ? `, ${r.studentId}` : ""
              }`
          )
          .join("\n")
      );
      applyParseResult(result.rows, result.warnings, file.name);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not read that file. Try .xlsx, .xls, or .csv."
      );
      setPreviewRows([]);
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function confirmImport() {
    if (!session || !person) return;
    const rows = previewRows.length
      ? previewRows
      : parseRosterText(paste).rows;
    if (rows.length === 0) {
      setError(
        "No students to import. Upload an Excel file or paste your class list."
      );
      return;
    }
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      const result = await api<{
        added: number;
        matchedExisting: number;
        createdStudents: number;
        skippedExisting: number;
      }>("/api/roster", {
        method: "POST",
        body: JSON.stringify({
          sessionId: session.id,
          teacherId: person.id,
          rows,
        }),
      });
      setSuccess(
        `Class list saved: ${result.added} enrollment(s) for your class. ` +
          `Linked ${result.matchedExisting} existing schoolwide student(s)` +
          (result.createdStudents
            ? `, created ${result.createdStudents} new`
            : "") +
          (result.skippedExisting
            ? `, skipped ${result.skippedExisting} already on your list`
            : "") +
          `. Tip: include Student ID from Aeries/IC so all 7 teachers share one record.`
      );
      setPaste("");
      setPreviewRows([]);
      setPreviewWarnings([]);
      setPreviewSource("");
      await loadRoster();
      setTab("assign");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setLoading(false);
    }
  }

  async function searchDirectory(q: string) {
    setDirQuery(q);
    if (q.trim().length < 2) {
      setDirectory([]);
      return;
    }
    try {
      const data = await api<{ students: typeof directory }>(
        `/api/students?q=${encodeURIComponent(q.trim())}`
      );
      setDirectory(data.students.slice(0, 40));
    } catch {
      setDirectory([]);
    }
  }

  async function addFromDirectory() {
    if (!session || !person || dirSelected.size === 0) return;
    setLoading(true);
    setError("");
    try {
      const result = await api<{
        added: number;
        matchedExisting: number;
        createdStudents: number;
      }>("/api/roster", {
        method: "POST",
        body: JSON.stringify({
          action: "from_directory",
          sessionId: session.id,
          teacherId: person.id,
          studentIds: [...dirSelected],
          period: dirPeriod,
          subject: dirSubject || "—",
        }),
      });
      setSuccess(
        `Added ${result.added} student(s) from the school directory (0 new people created).`
      );
      setDirSelected(new Set());
      await loadRoster();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  function toggleStudent(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const uniqueStudents = useMemo(() => {
    const map = new Map<string, RosterRow>();
    for (const r of roster) {
      if (!map.has(r.studentId)) map.set(r.studentId, r);
    }
    return [...map.values()].sort(
      (a, b) =>
        a.lastName.localeCompare(b.lastName) ||
        a.firstName.localeCompare(b.firstName)
    );
  }, [roster]);

  const periods = useMemo(() => {
    const set = new Set(roster.map((r) => r.period).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [roster]);

  const assignmentMap = useMemo(() => {
    const m = new Map<string, StudentAssignment["days"]>();
    for (const a of studentAssignments) {
      m.set(a.studentId, a.days);
    }
    return m;
  }, [studentAssignments]);

  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return uniqueStudents.filter((s) => {
      if (periodFilter !== "all") {
        const hasPeriod = roster.some(
          (r) => r.studentId === s.studentId && r.period === periodFilter
        );
        if (!hasPeriod) return false;
      }
      if (!q) return true;
      return (
        s.firstName.toLowerCase().includes(q) ||
        s.lastName.toLowerCase().includes(q) ||
        s.studentId.toLowerCase().includes(q)
      );
    });
  }, [uniqueStudents, search, periodFilter, roster]);

  function toggleAllFiltered() {
    const ids = filteredStudents.map((s) => s.studentId);
    const allSelected = ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        ids.forEach((id) => next.delete(id));
      } else {
        ids.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  function toggleAssignDay(d: DayOfWeek) {
    setAssignDays((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  }

  async function assignSelected() {
    if (!session || !person) return;
    if (selected.size === 0 || assignDays.size === 0) {
      setError("Select at least one student and one day they must attend.");
      return;
    }
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      const result = await api<{
        wonCount: number;
        lostCount: number;
        won: { firstName: string; lastName: string; day: string }[];
        lost: {
          firstName: string;
          lastName: string;
          day: string;
          winnerLabel: string;
        }[];
      }>("/api/assignments", {
        method: "POST",
        body: JSON.stringify({
          sessionId: session.id,
          teacherId: person.id,
          studentIds: [...selected],
          days: [...assignDays],
          type: "required",
        }),
      });
      const parts: string[] = [];
      parts.push(
        `Requested ${selected.size} student${selected.size === 1 ? "" : "s"} for ${[
          ...assignDays,
        ].join(", ")}.`
      );
      if (result.wonCount) {
        parts.push(
          `${result.wonCount} placement${result.wonCount === 1 ? "" : "s"} confirmed for your room.`
        );
      }
      if (result.lostCount) {
        const sample = result.lost
          .slice(0, 3)
          .map(
            (l) =>
              `${l.lastName}, ${l.firstName} (${l.day} → ${l.winnerLabel})`
          )
          .join("; ");
        parts.push(
          `${result.lostCount} go to higher weekly priority elsewhere: ${sample}${
            result.lostCount > 3 ? "…" : ""
          }`
        );
      }
      setSuccess(parts.join(" "));
      if (result.lostCount && !result.wonCount) {
        setError(
          "Weekly priority places those students in other rooms. Admin can update the priority list."
        );
      }
      setSelected(new Set());
      await loadAssignments();
      await loadDayRoster();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Assign failed");
    } finally {
      setLoading(false);
    }
  }

  async function removeStudentDay(studentId: string, day: DayOfWeek) {
    if (!session || !person) return;
    try {
      await api("/api/assignments", {
        method: "DELETE",
        body: JSON.stringify({
          sessionId: session.id,
          teacherId: person.id,
          studentId,
          day,
        }),
      });
      await loadAssignments();
      setSuccess(`Removed required attendance for ${day}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove");
    }
  }

  async function markOne(studentId: string, status: AttendanceStatus) {
    if (!session || !person) return;
    try {
      await api("/api/attendance", {
        method: "POST",
        body: JSON.stringify({
          sessionId: session.id,
          teacherId: person.id,
          studentId,
          day: attendDay,
          status,
          markedBy: person.id,
        }),
      });
      setDayRoster((prev) =>
        prev.map((s) =>
          s.studentId === studentId
            ? {
                ...s,
                attendanceStatus: status,
                markedByName:
                  status === "present" ? person.name : s.markedByName,
              }
            : s
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to mark");
    }
  }

  async function markAllPresent() {
    if (!session || !person) return;
    const effective = dayRoster.filter(
      (s) => s.isEffective !== false && !s.lostToPriority
    );
    if (effective.length === 0) return;
    setLoading(true);
    try {
      await api("/api/attendance", {
        method: "POST",
        body: JSON.stringify({
          sessionId: session.id,
          teacherId: person.id,
          day: attendDay,
          markedBy: person.id,
          marks: effective.map((s) => ({
            studentId: s.studentId,
            status: "present" as const,
          })),
        }),
      });
      await loadDayRoster();
      setSuccess("Marked all present.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  function signOut() {
    clearPerson();
    setPerson(null);
    setSession(null);
  }

  if (booting) {
    return (
      <>
        <TopBar subtitle="Teacher" />
        <main className="container" style={{ padding: "2rem 0" }}>
          <p className="muted">Loading…</p>
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar
        subtitle="Teacher"
        right={
          person ? (
            <>
              <span className="muted" style={{ fontSize: "0.875rem" }}>
                {person.name}
                {roomName ? ` · ${roomName}` : ""}
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
        below={
          person && session ? (
            <>
              <span className="pinned-nav-label">Pinned</span>
              <div className="pinned-nav-primary">
                <button
                  type="button"
                  className={`pinned-tab ${tab === "calendar" ? "active" : ""}`}
                  onClick={() => {
                    setTab("calendar");
                    setCalendarFocusToken((n) => n + 1);
                    requestAnimationFrame(() => {
                      document
                        .getElementById("teacher-calendar-section")
                        ?.scrollIntoView({
                          behavior: "smooth",
                          block: "start",
                        });
                    });
                  }}
                >
                  Priority calendar
                </button>
                <button
                  type="button"
                  className={`pinned-tab ${tab === "offers" ? "active" : ""}`}
                  onClick={() => setTab("offers")}
                >
                  My offerings
                </button>
              </div>
              <div className="pinned-nav-secondary">
                <button
                  type="button"
                  className={`tab ${tab === "roster" ? "active" : ""}`}
                  onClick={() => setTab("roster")}
                >
                  Class list
                </button>
                <button
                  type="button"
                  className={`tab ${tab === "assign" ? "active" : ""}`}
                  onClick={() => setTab("assign")}
                >
                  Who must attend
                </button>
                <button
                  type="button"
                  className={`tab ${tab === "attendance" ? "active" : ""}`}
                  onClick={() => setTab("attendance")}
                >
                  Attendance
                </button>
              </div>
            </>
          ) : null
        }
      />
      <main className="container stack" style={{ padding: "1.5rem 0 3rem" }}>
        {error ? <div className="error-banner">{error}</div> : null}
        {success ? <div className="success-banner">{success}</div> : null}

        {!session || !person ? (
          <div className="card card-pad" style={{ maxWidth: 480 }}>
            <h2 className="section-title">Teacher join / return</h2>
            <p className="muted" style={{ marginTop: 0, fontSize: "0.9rem" }}>
              Use the <strong>same name</strong> and join code you used before.
              Your class list stays on the server — you only need to request
              students for each day again if the week is new.
            </p>
            <div className="stack">
              <div className="field">
                <label>Your name</label>
                <input
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Ms. Rivera"
                />
              </div>
              <div className="field">
                <label>Join code</label>
                <input
                  className="input"
                  value={joinCode}
                  onChange={(e) =>
                    setJoinCode(
                      e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "")
                    )
                  }
                  placeholder="e.g. K7M2PQ"
                  style={{ letterSpacing: "0.12em", fontWeight: 700 }}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
                Room number and open/closed are set when you publish each
                tutorial offering (next step).
              </p>
              <button
                className="btn btn-accent"
                disabled={!name.trim() || !joinCode.trim() || loading}
                onClick={joinSession}
              >
                Join / restore my room
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="card card-pad">
              <div className="row" style={{ marginBottom: 4 }}>
                <span className="badge badge-teal">Joined</span>
                <span className="muted" style={{ fontSize: "0.9rem" }}>
                  {session.name}
                </span>
              </div>
              <strong style={{ fontSize: "1.15rem" }}>
                {person?.name}
                {myOffers[0]?.roomName
                  ? ` · Room ${myOffers[0].roomName}`
                  : roomName && roomName !== "—"
                    ? ` · Room ${roomName}`
                    : ""}
              </strong>
              <div className="muted" style={{ fontSize: "0.85rem" }}>
                Code {session.joinCode} · {uniqueStudents.length} students on
                class list
                {myOffers.length
                  ? ` · ${myOffers.length} offering${myOffers.length === 1 ? "" : "s"}`
                  : ""}
              </div>
            </div>

            <PriorityCalendarStrip sessionId={session.id} />

            {tab === "calendar" ? (
              <div className="stack" id="teacher-calendar-section">
                <div className="card card-pad">
                  <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>
                    Click a weekday to publish an offering for that date. It
                    appears under <strong>My offerings → Your published
                    offerings</strong> (with the date). Students only see the
                    current week. Opens on <strong>this week / today</strong>.
                  </p>
                </div>
                <div className="card card-pad">
                  <YearCalendar
                    mode="teacher"
                    teacherId={person?.id}
                    sessionId={session.id}
                    focusTodayToken={calendarFocusToken}
                    onOfferChanged={() => {
                      void loadMyOffers();
                      setSuccess(
                        "Offering published — it now shows under My offerings."
                      );
                    }}
                  />
                </div>
                {myOffers.length > 0 ? (
                  <div className="card card-pad">
                    <div
                      className="row"
                      style={{
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: 8,
                      }}
                    >
                      <h3 className="section-title" style={{ margin: 0 }}>
                        Your published offerings ({myOffers.length})
                      </h3>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setTab("offers")}
                      >
                        Manage on My offerings →
                      </button>
                    </div>
                    <ul
                      className="muted"
                      style={{
                        margin: 0,
                        paddingLeft: "1.1rem",
                        fontSize: "0.9rem",
                      }}
                    >
                      {myOffers.slice(0, 8).map((o) => (
                        <li key={o.id} style={{ marginBottom: 4 }}>
                          <strong style={{ color: "var(--ink)" }}>
                            {o.date || "—"}
                          </strong>
                          {" · "}
                          {o.subject}
                          {o.unitTitle ? ` — ${o.unitTitle}` : ""}
                          {" · Room "}
                          {o.roomName}
                        </li>
                      ))}
                      {myOffers.length > 8 ? (
                        <li>…and {myOffers.length - 8} more</li>
                      ) : null}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            {tab === "offers" ? (
              <div className="stack">
                <div className="card card-pad">
                  <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>
                    <strong>Two ways to publish:</strong> (1) Quick add below for
                    this session week, or (2) Priority calendar — click any
                    weekday (including future weeks). Both write the same
                    published list. Students only see the current week.
                  </p>
                  <button
                    className="btn btn-accent btn-sm"
                    style={{ marginTop: 10 }}
                    onClick={() => setTab("calendar")}
                  >
                    Open year calendar →
                  </button>
                </div>
                <div className="card card-pad stack">
                  <h3 className="section-title">
                    Quick add for this week
                  </h3>
                  <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>
                    Or add for a specific day of the current session week. Grade,
                    subject, unit, open/closed, room.
                  </p>
                  <div className="row">
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={offerForm.grade7}
                        onChange={(e) =>
                          setOfferForm((f) => ({ ...f, grade7: e.target.checked }))
                        }
                      />
                      7th grade
                    </label>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={offerForm.grade8}
                        onChange={(e) =>
                          setOfferForm((f) => ({ ...f, grade8: e.target.checked }))
                        }
                      />
                      8th grade
                    </label>
                  </div>
                  <div className="field">
                    <label>Day this week</label>
                    <div className="row">
                      {DAYS.map((d) => (
                        <button
                          key={d}
                          type="button"
                          className={`day-chip ${offerForm.day === d ? "selected" : ""}`}
                          onClick={() =>
                            setOfferForm((f) => ({ ...f, day: d }))
                          }
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid-2">
                    <div className="field">
                      <label>Subject / department</label>
                      <select
                        className="select"
                        value={offerForm.subject}
                        onChange={(e) =>
                          setOfferForm((f) => ({ ...f, subject: e.target.value }))
                        }
                      >
                        {DEFAULT_SUBJECTS.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                        <option value="Other">Other</option>
                      </select>
                    </div>
                    <div className="field">
                      <label>Room number</label>
                      <input
                        className="input"
                        value={offerForm.roomName}
                        onChange={(e) =>
                          setOfferForm((f) => ({
                            ...f,
                            roomName: e.target.value,
                          }))
                        }
                        placeholder="e.g. 33 or Library"
                      />
                    </div>
                    <div className="field" style={{ gridColumn: "1 / -1" }}>
                      <label>Unit or title</label>
                      <input
                        className="input"
                        value={offerForm.unitTitle}
                        onChange={(e) =>
                          setOfferForm((f) => ({
                            ...f,
                            unitTitle: e.target.value,
                          }))
                        }
                        placeholder="e.g. Socratic Seminar Makeups, Math Support…"
                      />
                    </div>
                    <div className="field">
                      <label>Open or closed</label>
                      <select
                        className="select"
                        value={offerForm.accessMode}
                        onChange={(e) =>
                          setOfferForm((f) => ({
                            ...f,
                            accessMode: e.target.value as "open" | "closed",
                          }))
                        }
                      >
                        <option value="closed">
                          Closed — required students only
                        </option>
                        <option value="open">
                          Open — free students may choose (FCFS)
                        </option>
                      </select>
                    </div>
                    {offerForm.accessMode === "open" ? (
                      <div className="field">
                        <label>Seat capacity</label>
                        <input
                          className="input"
                          type="number"
                          min={1}
                          value={offerForm.capacity}
                          onChange={(e) =>
                            setOfferForm((f) => ({
                              ...f,
                              capacity: e.target.value,
                            }))
                          }
                        />
                      </div>
                    ) : null}
                  </div>
                  <button
                    className="btn btn-accent"
                    disabled={loading}
                    onClick={async () => {
                      if (!session || !person) return;
                      const grades: ("7" | "8")[] = [];
                      if (offerForm.grade7) grades.push("7");
                      if (offerForm.grade8) grades.push("8");
                      setLoading(true);
                      setError("");
                      try {
                        const { dateForDay } = await import("@/lib/dates");
                        const date = dateForDay(
                          session.weekOf,
                          offerForm.day
                        );
                        await api("/api/teacher-offers", {
                          method: "POST",
                          body: JSON.stringify({
                            sessionId: session.id,
                            teacherId: person.id,
                            date,
                            grades,
                            subject: offerForm.subject,
                            unitTitle: offerForm.unitTitle,
                            accessMode: offerForm.accessMode,
                            roomName: offerForm.roomName,
                            capacity: Number(offerForm.capacity) || 30,
                          }),
                        });
                        await loadMyOffers();
                        setOfferForm((f) => ({
                          ...f,
                          unitTitle: "",
                        }));
                        setSuccess("Offering added — admin and students can see it.");
                      } catch (e) {
                        setError(
                          e instanceof Error ? e.message : "Could not save offering"
                        );
                      } finally {
                        setLoading(false);
                      }
                    }}
                  >
                    Publish offering
                  </button>
                </div>

                <div className="card" id="published-offerings">
                  <div className="card-pad" style={{ paddingBottom: 0 }}>
                    <h3 className="section-title">
                      Your published offerings ({myOffers.length})
                    </h3>
                    <p
                      className="muted"
                      style={{ margin: "0.25rem 0 0", fontSize: "0.85rem" }}
                    >
                      Includes quick-add and calendar offerings (all dates).
                    </p>
                  </div>
                  {myOffers.length === 0 ? (
                    <div className="empty">
                      No offerings yet. Use quick add above or click a day on the
                      priority calendar so it appears here and on the admin
                      compiled sheet.
                    </div>
                  ) : (
                    <div className="table-wrap" style={{ border: "none" }}>
                      <table className="data">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Grade</th>
                            <th>Subject</th>
                            <th>Unit / title</th>
                            <th>Open/Closed</th>
                            <th>Room</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {myOffers.map((o) => (
                            <tr key={o.id}>
                              <td>
                                <strong>{o.date || "—"}</strong>
                              </td>
                              <td>{o.grades.join("/")}</td>
                              <td>{o.subject}</td>
                              <td>{o.unitTitle}</td>
                              <td>
                                {o.accessMode === "open" ? (
                                  <span className="badge badge-teal">
                                    Open
                                    {o.capacity ? ` · ${o.capacity}` : ""}
                                  </span>
                                ) : (
                                  <span className="badge badge-gray">Closed</span>
                                )}
                              </td>
                              <td>{o.roomName}</td>
                              <td>
                                <button
                                  className="btn btn-danger btn-sm"
                                  onClick={async () => {
                                    if (!person) return;
                                    const data = await api<{
                                      offers: typeof myOffers;
                                    }>("/api/teacher-offers", {
                                      method: "DELETE",
                                      body: JSON.stringify({
                                        id: o.id,
                                        teacherId: person.id,
                                      }),
                                    });
                                    setMyOffers(data.offers || []);
                                    setSuccess("Offering removed.");
                                  }}
                                >
                                  Remove
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {tab === "roster" ? (
              <div className="stack">
                <div className="card card-pad">
                  <h3 className="section-title">Your class list stays on your account</h3>
                  <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>
                    Upload once — it is stored on <strong>your teacher account</strong> and
                    comes back every day you sign in. You only redo{" "}
                    <strong>offerings</strong> each new week. Use a{" "}
                    <strong>Student ID</strong> column when you can so the same kid
                    isn&apos;t created 7 times across teachers.
                  </p>
                </div>

                <div className="card card-pad stack">
                  <h3 className="section-title">
                    Option A — Pick from school directory
                  </h3>
                  <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
                    If admin (or another teacher) already loaded students, search
                    and add them to <em>your</em> period — no new duplicates.
                  </p>
                  <div className="grid-2">
                    <div className="field">
                      <label>Period</label>
                      <input
                        className="input"
                        value={dirPeriod}
                        onChange={(e) => setDirPeriod(e.target.value)}
                        placeholder="1"
                      />
                    </div>
                    <div className="field">
                      <label>Subject for this class</label>
                      <input
                        className="input"
                        value={dirSubject}
                        onChange={(e) => setDirSubject(e.target.value)}
                        placeholder="e.g. Algebra"
                      />
                    </div>
                  </div>
                  <div className="field">
                    <label>Search school directory</label>
                    <input
                      className="input"
                      value={dirQuery}
                      onChange={(e) => void searchDirectory(e.target.value)}
                      placeholder="Type last name or student ID…"
                    />
                  </div>
                  {directory.length > 0 ? (
                    <div className="table-wrap">
                      <table className="data">
                        <thead>
                          <tr>
                            <th></th>
                            <th>Name</th>
                            <th>ID</th>
                            <th>Grade</th>
                          </tr>
                        </thead>
                        <tbody>
                          {directory.map((s) => (
                            <tr key={s.id}>
                              <td>
                                <input
                                  type="checkbox"
                                  checked={dirSelected.has(s.id)}
                                  onChange={() => {
                                    setDirSelected((prev) => {
                                      const n = new Set(prev);
                                      if (n.has(s.id)) n.delete(s.id);
                                      else n.add(s.id);
                                      return n;
                                    });
                                  }}
                                />
                              </td>
                              <td>
                                {s.lastName}, {s.firstName}
                              </td>
                              <td>
                                <code style={{ fontSize: "0.8rem" }}>{s.id}</code>
                              </td>
                              <td>{s.grade || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                  <button
                    className="btn btn-primary"
                    disabled={dirSelected.size === 0 || loading}
                    onClick={addFromDirectory}
                  >
                    Add {dirSelected.size || ""} selected to my class list
                  </button>
                </div>

                <div className="grid-2">
                  {/* Excel upload */}
                  <div className="card card-pad stack">
                    <h3 className="section-title">Option B — Upload Excel / CSV</h3>
                    <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
                      Preferred columns:{" "}
                      <code>Student ID, First, Last, Period, Subject</code> (or
                      First, Last, Period, Subject). Student ID prevents
                      duplicates across all 7 teachers.
                    </p>
                    <div
                      className="dropzone"
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOver(true);
                      }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragOver(false);
                        const f = e.dataTransfer.files?.[0];
                        if (f) void handleFile(f);
                      }}
                      onClick={() => fileInputRef.current?.click()}
                      style={{
                        border: `2px dashed ${dragOver ? "var(--brand)" : "var(--border)"}`,
                        borderRadius: 14,
                        padding: "1.75rem 1rem",
                        textAlign: "center",
                        cursor: "pointer",
                        background: dragOver ? "var(--brand-soft)" : "#f8fafc",
                        transition: "background 0.15s, border-color 0.15s",
                      }}
                    >
                      <div style={{ fontSize: "1.6rem", marginBottom: 6 }}>📄</div>
                      <div style={{ fontWeight: 650 }}>
                        Drop spreadsheet here or click to browse
                      </div>
                      <div
                        className="muted"
                        style={{ fontSize: "0.8rem", marginTop: 4 }}
                      >
                        Excel export from Aeries, Infinite Campus, Google Sheets…
                      </div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".xlsx,.xls,.csv,.ods,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                        style={{ display: "none" }}
                        onChange={(e) =>
                          void handleFile(e.target.files?.[0] || null)
                        }
                      />
                    </div>
                  </div>

                  {/* Paste */}
                  <div className="card card-pad stack">
                    <h3 className="section-title">Or copy & paste</h3>
                    <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
                      One student per line. Include ID when you can:
                      <br />
                      <code>StudentID, First, Last, Period, Subject</code>
                      <br />
                      or <code>First, Last, Period, Subject</code>
                    </p>
                    <textarea
                      className="textarea"
                      value={paste}
                      onChange={(e) => onPasteChange(e.target.value)}
                      placeholder={`12345, Ava, Chen, 2, Algebra\n12346, Jordan, Smith, 3, English`}
                    />
                  </div>
                </div>

                {/* Preview + import */}
                {previewRows.length > 0 ? (
                  <div className="card">
                    <div
                      className="card-pad row"
                      style={{
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        flexWrap: "wrap",
                        gap: "0.75rem",
                      }}
                    >
                      <div>
                        <h3 className="section-title" style={{ marginBottom: 4 }}>
                          Preview — {previewRows.length} student
                          {previewRows.length === 1 ? "" : "s"}
                        </h3>
                        <div className="muted" style={{ fontSize: "0.85rem" }}>
                          Source: {previewSource || "paste"}
                        </div>
                        {previewWarnings.map((w) => (
                          <div
                            key={w}
                            className="muted"
                            style={{ fontSize: "0.8rem", color: "var(--warn)" }}
                          >
                            ⚠ {w}
                          </div>
                        ))}
                      </div>
                      <button
                        className="btn btn-accent"
                        disabled={loading}
                        onClick={confirmImport}
                      >
                        Import class list
                      </button>
                    </div>
                    <div className="table-wrap" style={{ border: "none" }}>
                      <table className="data">
                        <thead>
                          <tr>
                            <th>First</th>
                            <th>Last</th>
                            <th>Period</th>
                            <th>Subject</th>
                            <th>ID (if any)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {previewRows.slice(0, 50).map((r, i) => (
                            <tr key={`${r.firstName}-${r.lastName}-${i}`}>
                              <td>{r.firstName}</td>
                              <td>{r.lastName}</td>
                              <td>{r.period}</td>
                              <td>{r.subject}</td>
                              <td className="muted">{r.studentId || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {previewRows.length > 50 ? (
                      <p
                        className="muted"
                        style={{
                          padding: "0.75rem 1.25rem",
                          fontSize: "0.85rem",
                          margin: 0,
                        }}
                      >
                        Showing first 50 of {previewRows.length}. All will be
                        imported.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {/* Saved roster */}
                <div className="card">
                  <div
                    className="card-pad row"
                    style={{
                      justifyContent: "space-between",
                      paddingBottom: 0,
                    }}
                  >
                    <h3 className="section-title" style={{ margin: 0 }}>
                      Saved class list ({uniqueStudents.length} students
                      {roster.length !== uniqueStudents.length
                        ? ` · ${roster.length} period rows`
                        : ""}
                      )
                    </h3>
                    {uniqueStudents.length > 0 ? (
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => setTab("assign")}
                      >
                        Select who must attend →
                      </button>
                    ) : null}
                  </div>
                  {roster.length === 0 ? (
                    <div className="empty">
                      No class list yet. Upload an Excel file or paste names
                      above.
                    </div>
                  ) : (
                    <div className="table-wrap" style={{ border: "none" }}>
                      <table className="data">
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th>Student ID</th>
                            <th>Period</th>
                            <th>Subject</th>
                          </tr>
                        </thead>
                        <tbody>
                          {roster.map((r) => (
                            <tr key={r.id}>
                              <td>
                                {r.lastName}, {r.firstName}
                              </td>
                              <td>
                                <code style={{ fontSize: "0.8rem" }}>
                                  {r.studentId}
                                </code>
                              </td>
                              <td>{r.period}</td>
                              <td>{r.subject}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {tab === "assign" ? (
              <div className="stack">
                <div className="card card-pad">
                  <h3 className="section-title">
                    Select students who need to attend
                  </h3>
                  <p className="muted" style={{ marginTop: 0, fontSize: "0.9rem" }}>
                    Check students who need your room, choose day(s), then confirm.
                    If another teacher also requests the same student,{" "}
                    <strong>weekly priority</strong> (set by admin) decides which
                    room they attend. Your class list stays saved when you log back
                    in.
                  </p>

                  <div style={{ marginBottom: "0.75rem" }}>
                    <div
                      className="muted"
                      style={{
                        fontSize: "0.75rem",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        marginBottom: 6,
                      }}
                    >
                      Days they must attend
                    </div>
                    <div className="row">
                      {DAYS.map((d) => (
                        <button
                          key={d}
                          type="button"
                          className={`day-chip ${assignDays.has(d) ? "selected" : ""}`}
                          onClick={() => toggleAssignDay(d)}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="row" style={{ marginTop: "0.5rem" }}>
                    <button
                      className="btn btn-primary"
                      disabled={
                        selected.size === 0 || assignDays.size === 0 || loading
                      }
                      onClick={assignSelected}
                    >
                      Require {selected.size || 0} student
                      {selected.size === 1 ? "" : "s"} on{" "}
                      {assignDays.size
                        ? [...assignDays].join(", ")
                        : "selected days"}
                    </button>
                    {selected.size > 0 ? (
                      <button
                        className="btn btn-secondary"
                        onClick={() => setSelected(new Set())}
                      >
                        Clear selection
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="card">
                  <div
                    className="card-pad"
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "0.65rem",
                      alignItems: "flex-end",
                      justifyContent: "space-between",
                    }}
                  >
                    <div className="row" style={{ flex: 1, minWidth: 220 }}>
                      <div className="field" style={{ flex: 1, minWidth: 160 }}>
                        <label>Search</label>
                        <input
                          className="input"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          placeholder="Name or student ID…"
                        />
                      </div>
                      <div className="field" style={{ minWidth: 120 }}>
                        <label>Period</label>
                        <select
                          className="select"
                          value={periodFilter}
                          onChange={(e) => setPeriodFilter(e.target.value)}
                        >
                          <option value="all">All periods</option>
                          {periods.map((p) => (
                            <option key={p} value={p}>
                              Period {p}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={toggleAllFiltered}
                      disabled={filteredStudents.length === 0}
                    >
                      {filteredStudents.length > 0 &&
                      filteredStudents.every((s) => selected.has(s.studentId))
                        ? "Unselect shown"
                        : "Select all shown"}
                    </button>
                  </div>

                  {uniqueStudents.length === 0 ? (
                    <div className="empty">
                      Import a class list first (Excel or paste).
                      <div style={{ marginTop: 10 }}>
                        <button
                          className="btn btn-accent btn-sm"
                          onClick={() => setTab("roster")}
                        >
                          Go to class list
                        </button>
                      </div>
                    </div>
                  ) : filteredStudents.length === 0 ? (
                    <div className="empty">No students match your filters.</div>
                  ) : (
                    <div className="table-wrap" style={{ border: "none" }}>
                      <table className="data">
                        <thead>
                          <tr>
                            <th style={{ width: 42 }}>
                              <input
                                type="checkbox"
                                checked={
                                  filteredStudents.length > 0 &&
                                  filteredStudents.every((s) =>
                                    selected.has(s.studentId)
                                  )
                                }
                                onChange={toggleAllFiltered}
                                title="Select all shown"
                              />
                            </th>
                            <th>Student</th>
                            <th>ID</th>
                            <th>Period / Subject</th>
                            <th>Already required</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredStudents.map((s) => {
                            const periodsLabel = roster
                              .filter((r) => r.studentId === s.studentId)
                              .map((r) => `${r.period} · ${r.subject}`)
                              .join(", ");
                            const existing = assignmentMap.get(s.studentId) || [];
                            const isSel = selected.has(s.studentId);
                            return (
                              <tr
                                key={s.studentId}
                                onClick={() => toggleStudent(s.studentId)}
                                style={{
                                  cursor: "pointer",
                                  background: isSel
                                    ? "var(--brand-soft)"
                                    : undefined,
                                }}
                              >
                                <td onClick={(e) => e.stopPropagation()}>
                                  <input
                                    type="checkbox"
                                    checked={isSel}
                                    onChange={() => toggleStudent(s.studentId)}
                                  />
                                </td>
                                <td style={{ fontWeight: isSel ? 650 : 400 }}>
                                  {s.lastName}, {s.firstName}
                                </td>
                                <td>
                                  <code style={{ fontSize: "0.8rem" }}>
                                    {s.studentId}
                                  </code>
                                </td>
                                <td className="muted">{periodsLabel}</td>
                                <td onClick={(e) => e.stopPropagation()}>
                                  {existing.length === 0 ? (
                                    <span className="muted">—</span>
                                  ) : (
                                    <div
                                      className="stack"
                                      style={{ gap: 4, alignItems: "flex-start" }}
                                    >
                                      {existing.map((d) => {
                                        const elsewhere =
                                          d.isEffective === false &&
                                          d.assignedTeacherName;
                                        const awaiting =
                                          d.needsStudentChoice ||
                                          d.effectiveRoom ===
                                            "Awaiting student choice";
                                        return (
                                          <div key={d.day}>
                                            <button
                                              type="button"
                                              className={`badge ${
                                                awaiting
                                                  ? "badge-amber"
                                                  : elsewhere
                                                    ? "badge-gray"
                                                    : "badge-blue"
                                              }`}
                                              title={
                                                elsewhere
                                                  ? `With ${d.assignedTeacherName}${
                                                      d.assignedRoomName
                                                        ? ` (Room ${d.assignedRoomName})`
                                                        : ""
                                                    } — contact them to trade. Click to remove your request.`
                                                  : awaiting
                                                    ? "Student still choosing — on your attendance list. Click to remove request."
                                                    : "Click to remove this day"
                                              }
                                              style={{
                                                border: "none",
                                                cursor: "pointer",
                                              }}
                                              onClick={() =>
                                                void removeStudentDay(
                                                  s.studentId,
                                                  d.day
                                                )
                                              }
                                            >
                                              {d.day}
                                              {awaiting
                                                ? " · choice"
                                                : elsewhere
                                                  ? " · with other"
                                                  : d.type === "open_study"
                                                    ? " · open"
                                                    : ""}{" "}
                                              ×
                                            </button>
                                            {elsewhere ? (
                                              <div
                                                style={{
                                                  fontSize: "0.78rem",
                                                  marginTop: 2,
                                                  color: "var(--ink)",
                                                  fontWeight: 600,
                                                }}
                                              >
                                                Contact: {d.assignedTeacherName}
                                                {d.assignedRoomName &&
                                                d.assignedRoomName !== "—"
                                                  ? ` · Room ${d.assignedRoomName}`
                                                  : ""}
                                              </div>
                                            ) : null}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {selected.size > 0 ? (
                  <div
                    className="card card-pad"
                    style={{
                      position: "sticky",
                      bottom: 12,
                      background: "#0f172a",
                      color: "white",
                      borderColor: "#0f172a",
                    }}
                  >
                    <div
                      className="row"
                      style={{ justifyContent: "space-between" }}
                    >
                      <div>
                        <strong>
                          {selected.size} student
                          {selected.size === 1 ? "" : "s"} selected
                        </strong>
                        <div style={{ opacity: 0.8, fontSize: "0.85rem" }}>
                          Days:{" "}
                          {assignDays.size
                            ? [...assignDays].join(", ")
                            : "none selected"}
                        </div>
                      </div>
                      <button
                        className="btn btn-accent"
                        disabled={assignDays.size === 0 || loading}
                        onClick={assignSelected}
                      >
                        Confirm — must attend
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {tab === "attendance" ? (
              <div className="stack">
                <div className="card card-pad">
                  <div
                    className="row"
                    style={{ justifyContent: "space-between" }}
                  >
                    <div className="row">
                      {DAYS.map((d) => (
                        <button
                          key={d}
                          type="button"
                          className={`day-chip ${attendDay === d ? "selected" : ""}`}
                          onClick={() => setAttendDay(d)}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                    <button
                      className="btn btn-accent btn-sm"
                      disabled={dayRoster.length === 0 || loading}
                      onClick={markAllPresent}
                    >
                      Mark all present
                    </button>
                  </div>
                </div>

                <div className="card">
                  {(() => {
                    // On list: priority winners + awaiting student choice (all requesters)
                    const presentList = dayRoster.filter(
                      (s) => s.isEffective !== false
                    );
                    // Only lost when another teacher has higher subject priority
                    const lostList = dayRoster.filter(
                      (s) =>
                        s.isEffective === false || s.lostToPriority === true
                    );
                    if (presentList.length === 0 && lostList.length === 0) {
                      return (
                        <div className="empty">
                          No students required for {attendDay} yet.
                          <div style={{ marginTop: 10 }}>
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => setTab("assign")}
                            >
                              Select who must attend
                            </button>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <>
                        {lostList.length > 0 ? (
                          <div
                            className="card-pad"
                            style={{
                              background: "var(--warn-soft)",
                              borderBottom: "1px solid #fde68a",
                            }}
                          >
                            <strong style={{ fontSize: "0.9rem" }}>
                              {lostList.length} student
                              {lostList.length === 1 ? "" : "s"} already placed
                              elsewhere — contact the teacher if you need a trade
                            </strong>
                            <div className="table-wrap" style={{ marginTop: 10 }}>
                              <table className="data">
                                <thead>
                                  <tr>
                                    <th>Student</th>
                                    <th>With teacher</th>
                                    <th>Room</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {lostList.map((s) => (
                                    <tr key={s.studentId}>
                                      <td>
                                        {s.lastName}, {s.firstName}
                                      </td>
                                      <td>
                                        <strong>
                                          {s.assignedTeacherName ||
                                            s.effectiveRoom ||
                                            "—"}
                                        </strong>
                                      </td>
                                      <td>
                                        {s.assignedRoomName &&
                                        s.assignedRoomName !== "—"
                                          ? s.assignedRoomName
                                          : "—"}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ) : null}
                        {presentList.length === 0 ? (
                          <div className="empty">
                            No students on your attendance list for {attendDay}
                            after priority resolution.
                          </div>
                        ) : (
                          <div className="table-wrap" style={{ border: "none" }}>
                            <table className="data">
                              <thead>
                                <tr>
                                  <th>Student</th>
                                  <th>ID</th>
                                  <th>Type</th>
                                  <th>Status</th>
                                  <th>Mark</th>
                                </tr>
                              </thead>
                              <tbody>
                                {presentList.map((s) => (
                                  <tr key={s.studentId}>
                                    <td>
                                      {s.lastName}, {s.firstName}
                                      {s.needsStudentChoice ? (
                                        <div
                                          className="muted"
                                          style={{
                                            fontSize: "0.75rem",
                                            marginTop: 2,
                                          }}
                                        >
                                          Awaiting student choice
                                          {s.contestedWith?.length
                                            ? ` (also requested by ${s.contestedWith.join(", ")})`
                                            : ""}
                                          — mark present if they show up
                                        </div>
                                      ) : null}
                                    </td>
                                    <td>
                                      <code style={{ fontSize: "0.8rem" }}>
                                        {s.studentId}
                                      </code>
                                    </td>
                                    <td>
                                      {s.needsStudentChoice ? (
                                        <span className="badge badge-amber">
                                          Choice pending
                                        </span>
                                      ) : s.type === "open_study" ? (
                                        <span className="badge badge-teal">
                                          Open study
                                        </span>
                                      ) : (
                                        <span className="badge badge-blue">
                                          Required
                                        </span>
                                      )}
                                    </td>
                                    <td>
                                      <StatusBadge
                                        status={s.attendanceStatus}
                                      />
                                      {s.markedByName &&
                                      (s.attendanceStatus === "present" ||
                                        s.attendanceStatus === "excused" ||
                                        s.attendanceStatus === "absent") ? (
                                        <div
                                          className="muted"
                                          style={{
                                            fontSize: "0.75rem",
                                            marginTop: 2,
                                          }}
                                        >
                                          marked by {s.markedByName}
                                        </div>
                                      ) : null}
                                    </td>
                                    <td>
                                      <div className="row">
                                        <button
                                          className="btn btn-sm"
                                          style={{
                                            background: "var(--ok-soft)",
                                            color: "var(--ok)",
                                          }}
                                          onClick={() =>
                                            markOne(s.studentId, "present")
                                          }
                                        >
                                          Present
                                        </button>
                                        <button
                                          className="btn btn-sm"
                                          style={{
                                            background: "var(--danger-soft)",
                                            color: "var(--danger)",
                                          }}
                                          onClick={() =>
                                            markOne(s.studentId, "absent")
                                          }
                                        >
                                          Absent
                                        </button>
                                        <button
                                          className="btn btn-sm btn-secondary"
                                          onClick={() =>
                                            markOne(s.studentId, "excused")
                                          }
                                        >
                                          Excused
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            ) : null}
          </>
        )}
      </main>
    </>
  );
}
