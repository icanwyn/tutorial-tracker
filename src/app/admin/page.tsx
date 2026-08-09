"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { StatusBadge } from "@/components/StatusBadge";
import {
  api,
  clearPerson,
  loadPerson,
  loadSessionId,
  savePerson,
  saveSessionId,
} from "@/lib/client";
import {
  parsePriorityFile,
  parsePriorityText,
} from "@/lib/priorityParse";
import { YearCalendar } from "@/components/YearCalendar";
import type { DayOfWeek, Person, TutorialSession } from "@/lib/types";
import { DAYS } from "@/lib/types";

type AttendanceStatus = "present" | "absent" | "excused" | "unmarked";

type MasterStudent = {
  studentId: string;
  firstName: string;
  lastName: string;
  classes: {
    teacherId: string;
    teacherName: string;
    roomName: string;
    period: string;
    subject: string;
  }[];
  location: {
    roomName: string;
    teacherName: string;
    teacherId: string;
    type: "required" | "open_study";
    attendanceStatus: AttendanceStatus;
    contested?: boolean;
    claims?: string[];
  } | null;
  week: {
    day: DayOfWeek;
    roomName: string | null;
    teacherName: string | null;
    type: "required" | "open_study" | null;
    contested?: boolean;
  }[];
  priorityRanks?: string[];
};

type PriorityRow = {
  id: string;
  studentId: string;
  firstName: string;
  lastName: string;
  ranks: string[];
  updatedAt: string;
};

type Overview = {
  session: TutorialSession;
  day: DayOfWeek;
  teachers: {
    teacherId: string;
    teacherName: string;
    roomName: string;
    isOpenStudy: boolean;
    students: {
      studentId: string;
      firstName: string;
      lastName: string;
      type: string;
      attendanceStatus: AttendanceStatus;
    }[];
    present: number;
    absent: number;
    unmarked: number;
    excused: number;
  }[];
  missing: {
    studentId: string;
    firstName: string;
    lastName: string;
    teacherName: string;
    roomName: string;
    assignmentType: string;
    attendanceStatus: AttendanceStatus;
  }[];
  unassigned: { id: string; firstName: string; lastName: string }[];
  masterRoster: MasterStudent[];
  totals: {
    assigned: number;
    present: number;
    absent: number;
    unmarked: number;
    rooms: number;
    totalStudents: number;
    located: number;
    notLocated: number;
  };
};

export default function AdminPage() {
  const [person, setPerson] = useState<Person | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [sessionName, setSessionName] = useState("Schoolwide Tutorial");
  const [session, setSession] = useState<TutorialSession | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [day, setDay] = useState<DayOfWeek>("Mon");
  const [tab, setTab] = useState<
    | "students"
    | "rooms"
    | "missing"
    | "unassigned"
    | "priority"
    | "offerings"
    | "board"
    | "calendar"
    | "directory"
    | "admins"
  >("board");
  const [dirPaste, setDirPaste] = useState("");
  const [dirCount, setDirCount] = useState(0);
  const [board, setBoard] = useState<{
    rows: {
      id: string;
      grades: string[];
      gradeLabel: string;
      subject: string;
      unitTitle: string;
      accessMode: string;
      roomName: string;
      capacity: number;
      teacherName: string;
    }[];
    bySubject: Record<string, unknown[]>;
    subjects: string[];
  } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState<
    "all" | "in_room" | "no_room"
  >("all");
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(
    null
  );
  const [priorities, setPriorities] = useState<PriorityRow[]>([]);
  const [priorityPaste, setPriorityPaste] = useState("");
  const [priorityMsg, setPriorityMsg] = useState("");
  const priorityFileRef = useRef<HTMLInputElement>(null);
  const searchScrollKey = useRef("");
  const [offerings, setOfferings] = useState<
    {
      id: string;
      name: string;
      subject: string;
      description: string;
      priority: number;
      defaultCapacity: number;
    }[]
  >([]);
  const [offForm, setOffForm] = useState({
    name: "",
    subject: "",
    description: "",
    priority: "1",
    defaultCapacity: "30",
  });
  const [adminGrants, setAdminGrants] = useState<
    {
      id: string;
      name: string;
      grantedByName: string;
      isBootstrap?: boolean;
    }[]
  >([]);
  const [bootstrapAdmins, setBootstrapAdmins] = useState<string[]>([]);
  const [newAdminName, setNewAdminName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    async function boot() {
      try {
        const meta = await api<{ passwordRequired?: boolean }>("/api/auth");
        setPasswordRequired(!!meta.passwordRequired);
      } catch {
        setPasswordRequired(false);
      }

      const p = loadPerson();
      let admin = p?.role === "admin" ? p : null;
      // If a site password is required, don't auto-resume from localStorage alone
      // (avoids anyone with the device staying admin forever without re-auth).
      // Soft: still try resume; full password gate is on new sign-in. For stronger
      // lock, clear person when password required.
      if (admin) {
        setPerson(admin);
        setName(admin.name);
      }
      const sid = loadSessionId();
      try {
        // Prefer an active session (not a stale closed code in localStorage)
        const q = new URLSearchParams();
        if (admin?.id) q.set("adminId", admin.id);
        if (sid) q.set("sessionId", sid);
        const data = await api<{ session: TutorialSession | null }>(
          `/api/sessions?${q.toString()}`
        );
        if (data.session) {
          setSession(data.session);
          saveSessionId(data.session.id);
        }
      } catch {
        if (sid) {
          try {
            const d = await api<{ session: TutorialSession }>(
              `/api/sessions/${sid}`
            );
            setSession(d.session);
          } catch {
            /* ignore */
          }
        }
      }
      const js = new Date().getDay();
      if (js >= 1 && js <= 5) setDay(DAYS[js - 1]!);
      setBooting(false);
    }
    void boot();
  }, []);

  const refreshOverview = useCallback(async () => {
    if (!session) return;
    try {
      const data = await api<Overview>(
        `/api/admin/overview?sessionId=${session.id}&day=${day}`
      );
      setOverview(data);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load overview");
    }
  }, [session, day]);

  const refreshPriorities = useCallback(async () => {
    if (!session) return;
    try {
      const data = await api<{ priorities: PriorityRow[] }>(
        `/api/priorities?sessionId=${session.id}`
      );
      setPriorities(data.priorities);
    } catch {
      /* ignore */
    }
  }, [session]);

  const refreshOfferings = useCallback(async () => {
    if (!session) return;
    try {
      const data = await api<{ offerings: typeof offerings }>(
        `/api/offerings?sessionId=${session.id}`
      );
      setOfferings(data.offerings);
    } catch {
      /* ignore */
    }
  }, [session]);

  const refreshBoard = useCallback(async () => {
    if (!session) return;
    try {
      const data = await api<NonNullable<typeof board>>(
        `/api/teacher-offers?sessionId=${session.id}&compiled=1`
      );
      setBoard(data);
    } catch {
      /* ignore */
    }
  }, [session]);

  const refreshAdmins = useCallback(async () => {
    try {
      const data = await api<{
        grants: typeof adminGrants;
        bootstrapAdmins: string[];
      }>("/api/admins");
      setAdminGrants(data.grants);
      setBootstrapAdmins(data.bootstrapAdmins || []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (session) {
      void refreshOverview();
      void refreshPriorities();
      void refreshOfferings();
      void refreshBoard();
      const t = setInterval(() => {
        void refreshOverview();
        void refreshBoard();
      }, 12000);
      return () => clearInterval(t);
    }
  }, [
    session,
    refreshOverview,
    refreshPriorities,
    refreshOfferings,
    refreshBoard,
  ]);

  useEffect(() => {
    void refreshAdmins();
  }, [refreshAdmins]);

  async function importPriorities(
    rows: { firstName: string; lastName: string; studentId?: string; ranks: string[] }[]
  ) {
    if (!session) return;
    if (rows.length === 0) {
      setError("No priority rows to import.");
      return;
    }
    setLoading(true);
    setPriorityMsg("");
    setError("");
    try {
      const result = await api<{
        saved: number;
        unmatched: string[];
        priorities: PriorityRow[];
      }>("/api/priorities", {
        method: "POST",
        body: JSON.stringify({ sessionId: session.id, rows }),
      });
      setPriorities(result.priorities);
      setPriorityMsg(
        `Saved weekly priority for ${result.saved} student${
          result.saved === 1 ? "" : "s"
        }.${
          result.unmatched.length
            ? ` Unmatched: ${result.unmatched.slice(0, 5).join(", ")}`
            : ""
        }`
      );
      setPriorityPaste("");
      await refreshOverview();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Priority upload failed");
    } finally {
      setLoading(false);
    }
  }

  async function handlePriorityFile(file: File | null) {
    if (!file) return;
    setLoading(true);
    try {
      const parsed = await parsePriorityFile(file);
      if (parsed.warnings.length) {
        setPriorityMsg(parsed.warnings.join(" "));
      }
      await importPriorities(parsed.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read file");
      setLoading(false);
    }
  }

  const filteredStudents = useMemo(() => {
    if (!overview?.masterRoster) return [];
    const q = search.trim().toLowerCase();
    return overview.masterRoster.filter((s) => {
      if (locationFilter === "in_room" && !s.location) return false;
      if (locationFilter === "no_room" && s.location) return false;
      if (!q) return true;
      const hay = [
        s.firstName,
        s.lastName,
        `${s.firstName} ${s.lastName}`,
        `${s.lastName}, ${s.firstName}`,
        s.studentId,
        s.location?.roomName ?? "",
        s.location?.teacherName ?? "",
        ...s.classes.flatMap((c) => [
          c.subject,
          c.period,
          c.teacherName,
          c.roomName,
        ]),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [overview, search, locationFilter]);

  const selectedStudent = useMemo(() => {
    if (!selectedStudentId || !overview) return null;
    return (
      overview.masterRoster.find((s) => s.studentId === selectedStudentId) ||
      null
    );
  }, [selectedStudentId, overview]);

  // Keep selection in sync after refresh
  useEffect(() => {
    if (
      selectedStudentId &&
      overview &&
      !overview.masterRoster.some((s) => s.studentId === selectedStudentId)
    ) {
      setSelectedStudentId(null);
    }
  }, [overview, selectedStudentId]);

  // When admin searches a name, jump the view down to the matching student
  useEffect(() => {
    const q = search.trim().toLowerCase();
    if (!q || tab !== "students") {
      searchScrollKey.current = "";
      return;
    }
    const first = filteredStudents[0];
    if (!first) return;

    const key = `${q}|${first.studentId}|${filteredStudents.length}`;
    if (searchScrollKey.current === key) return;
    searchScrollKey.current = key;

    // Single clear match → open their detail card
    if (filteredStudents.length === 1) {
      setSelectedStudentId(first.studentId);
    }

    const timer = window.setTimeout(() => {
      const target =
        document.getElementById(`admin-student-${first.studentId}`) ||
        document.getElementById("admin-student-roster");
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [search, tab, filteredStudents]);

  async function register() {
    setError("");
    if (passwordRequired && !password.trim()) {
      setError("Admin password is required.");
      return;
    }
    setLoading(true);
    try {
      const { person: p } = await api<{ person: Person }>("/api/auth", {
        method: "POST",
        body: JSON.stringify({
          name,
          role: "admin",
          password: password || undefined,
        }),
      });
      savePerson(p);
      setPerson(p);
      setPassword(""); // don't keep password in React state
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  async function startSession() {
    if (!person) return;
    setError("");
    setLoading(true);
    try {
      const { session: s } = await api<{ session: TutorialSession }>(
        "/api/sessions",
        {
          method: "POST",
          body: JSON.stringify({ name: sessionName, adminId: person.id }),
        }
      );
      saveSessionId(s.id);
      setSession(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  async function closeSession() {
    if (!session) return;
    if (
      !confirm(
        "Close this tutorial session? Teachers will no longer be able to join with the code until you reopen it."
      )
    )
      return;
    setLoading(true);
    try {
      const { session: s } = await api<{ session: TutorialSession }>(
        `/api/sessions/${session.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ action: "close" }),
        }
      );
      setSession(s);
      await refreshOverview();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  async function reopenCurrentSession() {
    if (!session) return;
    setLoading(true);
    setError("");
    try {
      const { session: s } = await api<{ session: TutorialSession }>(
        `/api/sessions/${session.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ action: "reopen" }),
        }
      );
      setSession(s);
      saveSessionId(s.id);
      await refreshOverview();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reopen");
    } finally {
      setLoading(false);
    }
  }

  function beginNewSessionForm() {
    setSession(null);
    setOverview(null);
    // keep localStorage until a new session is created
  }

  function signOut() {
    clearPerson();
    setPerson(null);
    setSession(null);
  }

  function openStudent(studentId: string) {
    setSelectedStudentId(studentId);
    setTab("students");
  }

  if (booting) {
    return (
      <>
        <TopBar subtitle="Admin" />
        <main className="container" style={{ padding: "2rem 0" }}>
          <p className="muted">Loading…</p>
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar
        subtitle="Admin"
        right={
          person ? (
            <>
              <span className="muted" style={{ fontSize: "0.875rem" }}>
                {person.name}
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
                  onClick={() => setTab("calendar")}
                >
                  Priority calendar
                </button>
                <button
                  type="button"
                  className={`pinned-tab ${tab === "board" ? "active" : ""}`}
                  onClick={() => {
                    setTab("board");
                    void refreshBoard();
                  }}
                >
                  Offerings sheet
                  {board?.rows?.length != null ? ` (${board.rows.length})` : ""}
                </button>
              </div>
              <div className="pinned-nav-secondary">
                <button
                  type="button"
                  className={`tab ${tab === "students" ? "active" : ""}`}
                  onClick={() => setTab("students")}
                >
                  Students
                </button>
                <button
                  type="button"
                  className={`tab ${tab === "rooms" ? "active" : ""}`}
                  onClick={() => setTab("rooms")}
                >
                  Rooms
                </button>
                <button
                  type="button"
                  className={`tab ${tab === "missing" ? "active" : ""}`}
                  onClick={() => setTab("missing")}
                >
                  Missing
                </button>
                <button
                  type="button"
                  className={`tab ${tab === "unassigned" ? "active" : ""}`}
                  onClick={() => setTab("unassigned")}
                >
                  No room
                </button>
                <button
                  type="button"
                  className={`tab ${tab === "directory" ? "active" : ""}`}
                  onClick={async () => {
                    setTab("directory");
                    try {
                      const d = await api<{ count: number }>("/api/students");
                      setDirCount(d.count || 0);
                    } catch {
                      /* ignore */
                    }
                  }}
                >
                  Directory
                </button>
                <button
                  type="button"
                  className={`tab ${tab === "admins" ? "active" : ""}`}
                  onClick={() => {
                    setTab("admins");
                    void refreshAdmins();
                  }}
                >
                  Admins
                </button>
              </div>
            </>
          ) : null
        }
      />
      <main className="container stack" style={{ padding: "1.5rem 0 3rem" }}>
        {error ? <div className="error-banner">{error}</div> : null}

        {!person ? (
          <div className="card card-pad" style={{ maxWidth: 420 }}>
            <h2 className="section-title">Admin sign-in</h2>
            <p className="muted" style={{ marginTop: 0, fontSize: "0.9rem" }}>
              Sign in with an authorized admin name
              {passwordRequired ? " and the site admin password" : ""}. After
              you sign in, you can grant other admins access by name.
            </p>
            <div className="stack">
              <div className="field">
                <label>Your name</label>
                <input
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  autoComplete="username"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && name.trim()) {
                      if (passwordRequired && !password.trim()) {
                        (
                          document.getElementById(
                            "admin-password"
                          ) as HTMLInputElement | null
                        )?.focus();
                        return;
                      }
                      void register();
                    }
                  }}
                />
              </div>
              <div className="field">
                <label>
                  Admin password
                  {!passwordRequired ? (
                    <span className="muted" style={{ fontWeight: 400 }}>
                      {" "}
                      (optional until configured)
                    </span>
                  ) : null}
                </label>
                <input
                  id="admin-password"
                  className="input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={
                    passwordRequired
                      ? "Required"
                      : "Set ADMIN_PASSWORD on the server to require this"
                  }
                  autoComplete="current-password"
                  onKeyDown={(e) =>
                    e.key === "Enter" && name.trim() && void register()
                  }
                />
              </div>
              <button
                className="btn btn-primary"
                disabled={
                  !name.trim() ||
                  loading ||
                  (passwordRequired && !password.trim())
                }
                onClick={() => void register()}
              >
                Continue as admin
              </button>
            </div>
          </div>
        ) : !session ? (
          <div className="card card-pad" style={{ maxWidth: 480 }}>
            <h2 className="section-title">Start a tutorial call</h2>
            <p className="muted" style={{ marginTop: 0, fontSize: "0.9rem" }}>
              Teachers join with a code and upload class lists. As they load
              rosters, your complete schoolwide roster builds automatically.
            </p>
            <div className="stack">
              <div className="field">
                <label>Session name</label>
                <input
                  className="input"
                  value={sessionName}
                  onChange={(e) => setSessionName(e.target.value)}
                  placeholder="Schoolwide Tutorial"
                />
              </div>
              <button
                className="btn btn-primary"
                disabled={!sessionName.trim() || loading}
                onClick={startSession}
              >
                Start session & generate code
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="card card-pad">
              <div
                className="row"
                style={{
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                }}
              >
                <div>
                  <div className="row" style={{ marginBottom: 6 }}>
                    {session.status === "active" ? (
                      <>
                        <span className="pulse-dot" />
                        <span className="badge badge-green">Live — teachers can join</span>
                      </>
                    ) : (
                      <span className="badge badge-red">
                        Closed — teachers cannot join this code
                      </span>
                    )}
                    <span className="muted" style={{ fontSize: "0.85rem" }}>
                      {session.name}
                    </span>
                  </div>
                  <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                    Teacher join code
                  </div>
                  <div
                    className="code-pill"
                    style={{
                      marginTop: 6,
                      opacity: session.status === "active" ? 1 : 0.45,
                    }}
                  >
                    {session.joinCode}
                  </div>
                  <p
                    className="muted"
                    style={{ fontSize: "0.85rem", marginBottom: 0 }}
                  >
                    {session.status === "active"
                      ? "Share this exact code with teachers. Class lists they upload appear on your master roster."
                      : "This session is closed, so the code will not work until you reopen it."}
                  </p>
                </div>
                <div className="row">
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => void refreshOverview()}
                  >
                    Refresh
                  </button>
                  {session.status === "active" ? (
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={closeSession}
                      disabled={loading}
                    >
                      Close session
                    </button>
                  ) : (
                    <>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={reopenCurrentSession}
                        disabled={loading}
                      >
                        Reopen session
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={beginNewSessionForm}
                        disabled={loading}
                      >
                        Start new session
                      </button>
                    </>
                  )}
                </div>
              </div>
              {session.status !== "active" ? (
                <div className="error-banner" style={{ marginTop: "1rem" }}>
                  Teachers will see “invalid or inactive join code” until you
                  click <strong>Reopen session</strong> (keeps the same code and
                  data) or <strong>Start new session</strong> (new code).
                </div>
              ) : null}
            </div>

            {/* Day + search */}
            <div className="card card-pad stack" style={{ gap: "0.85rem" }}>
              <div
                className="row"
                style={{ justifyContent: "space-between" }}
              >
                <div>
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
                    Day for location / attendance
                  </div>
                  <div className="row">
                    {DAYS.map((d) => (
                      <button
                        key={d}
                        className={`day-chip ${day === d ? "selected" : ""}`}
                        onClick={() => setDay(d)}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="field">
                <label>Find a student — see which room they&apos;re in</label>
                <input
                  className="input"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setTab("students");
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    setTab("students");
                    const first = filteredStudents[0];
                    if (!first) return;
                    setSelectedStudentId(first.studentId);
                    window.setTimeout(() => {
                      document
                        .getElementById(`admin-student-${first.studentId}`)
                        ?.scrollIntoView({
                          behavior: "smooth",
                          block: "center",
                        });
                    }, 60);
                  }}
                  placeholder="Search name, student ID, room, teacher, or subject…"
                  autoComplete="off"
                  style={{ fontSize: "1.05rem", padding: "0.75rem 0.9rem" }}
                />
              </div>
            </div>

            {overview ? (
              <>
                <div className="stat-grid">
                  <div className="stat">
                    <div className="label">Master roster</div>
                    <div className="value">{overview.totals.totalStudents}</div>
                  </div>
                  <div className="stat">
                    <div className="label">Rooms</div>
                    <div className="value">{overview.totals.rooms}</div>
                  </div>
                  <div className="stat">
                    <div className="label">In a room ({day})</div>
                    <div className="value" style={{ color: "var(--brand)" }}>
                      {overview.totals.located}
                    </div>
                  </div>
                  <div className="stat">
                    <div className="label">No room yet</div>
                    <div className="value" style={{ color: "var(--warn)" }}>
                      {overview.totals.notLocated}
                    </div>
                  </div>
                  <div className="stat">
                    <div className="label">Present</div>
                    <div className="value" style={{ color: "var(--ok)" }}>
                      {overview.totals.present}
                    </div>
                  </div>
                  <div className="stat">
                    <div className="label">Missing / unmarked</div>
                    <div className="value" style={{ color: "var(--danger)" }}>
                      {overview.totals.absent + overview.totals.unmarked}
                    </div>
                  </div>
                </div>

                {/* Secondary tools — primary Calendar + Offerings are frozen in top nav */}
                <div className="tabs">
                  <button
                    className={`tab ${tab === "offerings" ? "active" : ""}`}
                    onClick={() => {
                      setTab("offerings");
                      void refreshOfferings();
                    }}
                  >
                    Subject priority
                  </button>
                  <button
                    className={`tab ${tab === "priority" ? "active" : ""}`}
                    onClick={() => {
                      setTab("priority");
                      void refreshPriorities();
                    }}
                  >
                    Student priority list
                  </button>
                </div>

                {tab === "directory" ? (
                  <div className="stack">
                    <div className="card card-pad stack">
                      <h3 className="section-title">
                        Schoolwide student directory
                      </h3>
                      <p
                        className="muted"
                        style={{ margin: 0, fontSize: "0.9rem" }}
                      >
                        Load students <strong>once</strong> from Aeries / Infinite
                        Campus. Each person gets one ID. All 7 of a student&apos;s
                        teachers then attach that same person to their class list —
                        no 7 copies of the same name.
                      </p>
                      <p
                        className="muted"
                        style={{ margin: 0, fontSize: "0.85rem" }}
                      >
                        Columns:{" "}
                        <code>Student ID, First Name, Last Name, Grade</code>{" "}
                        (grade optional). Currently{" "}
                        <strong>{dirCount}</strong> students in the directory.
                      </p>
                      <textarea
                        className="textarea"
                        value={dirPaste}
                        onChange={(e) => setDirPaste(e.target.value)}
                        placeholder={`Student ID, First Name, Last Name, Grade\n10001, Ava, Chen, 7\n10002, Jordan, Smith, 8`}
                      />
                      <button
                        className="btn btn-primary"
                        disabled={!dirPaste.trim() || loading}
                        onClick={async () => {
                          setLoading(true);
                          setError("");
                          try {
                            const { parseRosterText } = await import(
                              "@/lib/rosterParse"
                            );
                            // Reuse flexible parser: map studentId, first, last, grade
                            const parsed = parseRosterText(dirPaste);
                            const rows = parsed.rows.map((r) => ({
                              firstName: r.firstName,
                              lastName: r.lastName,
                              studentId: r.studentId,
                              grade: r.grade,
                            }));
                            // Also support ID, First, Last without period columns
                            if (rows.length === 0) {
                              const lines = dirPaste
                                .split(/\r?\n/)
                                .map((l) => l.trim())
                                .filter(Boolean);
                              for (const line of lines) {
                                if (/student\s*id/i.test(line)) continue;
                                const parts = line.includes("\t")
                                  ? line.split("\t")
                                  : line.split(",").map((p) => p.trim());
                                if (parts.length >= 3) {
                                  // ID, First, Last [, Grade]
                                  const g = (parts[3] || "").replace(
                                    /[^0-9]/g,
                                    ""
                                  );
                                  rows.push({
                                    studentId: parts[0],
                                    firstName: parts[1]!,
                                    lastName: parts[2]!,
                                    grade:
                                      g === "7" || g === "8" ? g : null,
                                  });
                                }
                              }
                            }
                            const result = await api<{
                              created: number;
                              updated: number;
                              total: number;
                            }>("/api/students", {
                              method: "POST",
                              body: JSON.stringify({
                                action: "import_directory",
                                rows,
                              }),
                            });
                            setDirCount(result.total);
                            setDirPaste("");
                            setPriorityMsg(
                              `Directory updated: ${result.created} new, ${result.updated} existing linked. Total ${result.total} students.`
                            );
                          } catch (e) {
                            setError(
                              e instanceof Error ? e.message : "Import failed"
                            );
                          } finally {
                            setLoading(false);
                          }
                        }}
                      >
                        Import school directory
                      </button>
                      {priorityMsg ? (
                        <div className="success-banner">{priorityMsg}</div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {tab === "calendar" ? (
                  <div className="card card-pad">
                    <YearCalendar mode="admin" sessionId={session.id} />
                  </div>
                ) : null}

                {tab === "board" ? (
                  <div className="stack">
                    <div className="card card-pad">
                      <div
                        className="row"
                        style={{ justifyContent: "space-between" }}
                      >
                        <div>
                          <h3 className="section-title" style={{ margin: 0 }}>
                            Compiled tutorial offerings
                          </h3>
                          <p
                            className="muted"
                            style={{ margin: "0.35rem 0 0", fontSize: "0.9rem" }}
                          >
                            Live version of the department handout: Grade · Subject
                            · Unit · Open/Closed · Room · Teacher. Auto-refreshes
                            as teachers publish.
                          </p>
                        </div>
                        <div className="row">
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => void refreshBoard()}
                          >
                            Refresh
                          </button>
                          <button
                            className="btn btn-primary btn-sm"
                            disabled={loading}
                            onClick={async () => {
                              if (!session) return;
                              if (
                                !confirm(
                                  `Place free students (not required by any teacher) into open rooms with seats for ${day}?\n\nStudents already requested by teachers stay with those teachers / student choice — they are not auto-moved.`
                                )
                              )
                                return;
                              setLoading(true);
                              setError("");
                              try {
                                const result = await api<{
                                  placed: number;
                                  stillOpen: number;
                                  awaitingChoice: number;
                                  noOpenSeats: number;
                                  awaitingChoiceNames: string[];
                                  noSeatsNames: string[];
                                }>("/api/auto-place", {
                                  method: "POST",
                                  body: JSON.stringify({
                                    sessionId: session.id,
                                    day,
                                  }),
                                });
                                const parts = [
                                  `Auto-placed ${result.placed} free student(s) into open rooms.`,
                                ];
                                if (result.awaitingChoice) {
                                  parts.push(
                                    `${result.awaitingChoice} still need a student choice (multiple teachers requested them — not auto-filled): ${
                                      (result.awaitingChoiceNames || [])
                                        .slice(0, 5)
                                        .join("; ") || "see attendance"
                                    }${
                                      result.awaitingChoice > 5 ? "…" : ""
                                    }`
                                  );
                                }
                                if (result.noOpenSeats) {
                                  parts.push(
                                    `${result.noOpenSeats} free student(s) had no open seats left: ${(result.noSeatsNames || []).join(", ")}`
                                  );
                                }
                                setPriorityMsg(parts.join(" "));
                                await refreshOverview();
                              } catch (e) {
                                setError(
                                  e instanceof Error
                                    ? e.message
                                    : "Auto-place failed"
                                );
                              } finally {
                                setLoading(false);
                              }
                            }}
                          >
                            Auto-place free students ({day})
                          </button>
                        </div>
                      </div>
                      {priorityMsg ? (
                        <div
                          className="success-banner"
                          style={{ marginTop: "0.75rem" }}
                        >
                          {priorityMsg}
                        </div>
                      ) : null}
                    </div>

                    {!board || board.rows.length === 0 ? (
                      <div className="card empty">
                        No teacher offerings yet. When teachers publish rows
                        (grade, subject, unit, open/closed, room), they appear
                        here grouped by department.
                      </div>
                    ) : (
                      board.subjects.map((subject) => {
                        const rows = board.rows.filter(
                          (r) => r.subject === subject
                        );
                        return (
                          <div key={subject} className="card">
                            <div
                              className="card-pad"
                              style={{
                                paddingBottom: 0,
                                background: "#0f172a",
                                color: "white",
                                borderRadius: "16px 16px 0 0",
                              }}
                            >
                              <h3
                                className="section-title"
                                style={{ margin: 0, color: "white" }}
                              >
                                {subject}
                              </h3>
                            </div>
                            <div
                              className="table-wrap"
                              style={{ border: "none" }}
                            >
                              <table className="data">
                                <thead>
                                  <tr>
                                    <th>Grade</th>
                                    <th>Unit / title</th>
                                    <th>Open/Closed</th>
                                    <th>Room</th>
                                    <th>Teacher</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {rows.map((r) => (
                                    <tr key={r.id}>
                                      <td>{r.gradeLabel}</td>
                                      <td>{r.unitTitle}</td>
                                      <td>
                                        {r.accessMode === "open" ? (
                                          <span className="badge badge-teal">
                                            Open
                                            {r.capacity
                                              ? ` · cap ${r.capacity}`
                                              : ""}
                                          </span>
                                        ) : (
                                          <span className="badge badge-gray">
                                            Closed
                                          </span>
                                        )}
                                      </td>
                                      <td>
                                        <strong>{r.roomName}</strong>
                                      </td>
                                      <td>{r.teacherName}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                ) : null}

                {tab === "students" ? (
                  <div className="stack">
                    {/* Selected student detail card */}
                    {selectedStudent ? (
                      <div
                        id={`admin-student-${selectedStudent.studentId}`}
                        className="card card-pad"
                        style={{
                          borderColor: "#b8bcc4",
                          background: "#e5e7eb",
                          color: "#374151",
                        }}
                      >
                        <div
                          className="row"
                          style={{
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                          }}
                        >
                          <div>
                            <div
                              style={{
                                fontSize: "0.75rem",
                                fontWeight: 700,
                                color: "#4b5563",
                              }}
                            >
                              STUDENT LOCATION
                            </div>
                            <h2
                              style={{
                                margin: "0.15rem 0 0.25rem",
                                fontSize: "1.35rem",
                                color: "#1f2937",
                              }}
                            >
                              {selectedStudent.lastName},{" "}
                              {selectedStudent.firstName}
                            </h2>
                            <code
                              style={{
                                fontSize: "0.9rem",
                                color: "#4b5563",
                                background: "#d1d5db",
                              }}
                            >
                              {selectedStudent.studentId}
                            </code>
                          </div>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => setSelectedStudentId(null)}
                          >
                            Close
                          </button>
                        </div>

                        <div
                          style={{
                            marginTop: "1rem",
                            padding: "1rem 1.1rem",
                            borderRadius: 12,
                            background: selectedStudent.location
                              ? "#0f172a"
                              : "#d1d5db",
                            border: `1px solid ${
                              selectedStudent.location ? "#1e3a5f" : "#9ca3af"
                            }`,
                            color: selectedStudent.location
                              ? "#e5e7eb"
                              : "#374151",
                          }}
                        >
                          <div
                            style={{
                              fontSize: "0.75rem",
                              fontWeight: 700,
                              textTransform: "uppercase",
                              letterSpacing: "0.04em",
                              color: selectedStudent.location
                                ? "#94a3b8"
                                : "#4b5563",
                            }}
                          >
                            Currently on {day}
                          </div>
                          {selectedStudent.location ? (
                            <>
                              <div
                                style={{
                                  fontSize: "1.5rem",
                                  fontWeight: 750,
                                  marginTop: 4,
                                  letterSpacing: "-0.02em",
                                  color: "#f8fafc",
                                }}
                              >
                                {selectedStudent.location.roomName}
                              </div>
                              <div
                                style={{
                                  marginTop: 4,
                                  color: "#cbd5e1",
                                }}
                              >
                                Teacher:{" "}
                                <strong style={{ color: "#f1f5f9" }}>
                                  {selectedStudent.location.teacherName}
                                </strong>
                                {" · "}
                                {selectedStudent.location.type ===
                                "open_study" ? (
                                  <span className="badge badge-teal">
                                    Open study
                                  </span>
                                ) : (
                                  <span className="badge badge-blue">
                                    Required
                                  </span>
                                )}{" "}
                                <StatusBadge
                                  status={
                                    selectedStudent.location.attendanceStatus
                                  }
                                />
                                {selectedStudent.location.contested ? (
                                  <span
                                    className="badge badge-amber"
                                    style={{ marginLeft: 6 }}
                                  >
                                    Priority resolved
                                  </span>
                                ) : null}
                              </div>
                              {selectedStudent.location.contested &&
                              selectedStudent.location.claims?.length ? (
                                <div
                                  style={{
                                    fontSize: "0.85rem",
                                    marginTop: 6,
                                    color: "#94a3b8",
                                  }}
                                >
                                  Contested by:{" "}
                                  {selectedStudent.location.claims.join(" · ")}
                                </div>
                              ) : null}
                            </>
                          ) : (
                            <div
                              style={{
                                fontSize: "1.15rem",
                                fontWeight: 650,
                                marginTop: 4,
                                color: "#4b5563",
                              }}
                            >
                              Not placed in a room for {day}
                            </div>
                          )}
                        </div>

                        <div
                          style={{
                            marginTop: "1rem",
                            padding: "0.85rem 0.9rem",
                            borderRadius: 12,
                            background:
                              "linear-gradient(165deg, #8a7020 0%, #5c4a12 55%, #4a3c0e 100%)",
                            border: "1px solid #6b5618",
                            color: "#f5efd8",
                          }}
                        >
                          <div
                            style={{
                              fontSize: "0.75rem",
                              fontWeight: 700,
                              marginBottom: 8,
                              letterSpacing: "0.04em",
                              color: "#e8d48a",
                            }}
                          >
                            WEEK AT A GLANCE
                          </div>
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns:
                                "repeat(auto-fit, minmax(100px, 1fr))",
                              gap: 8,
                            }}
                          >
                            {selectedStudent.week.map((w) => (
                              <div
                                key={w.day}
                                style={{
                                  padding: "0.55rem 0.65rem",
                                  borderRadius: 10,
                                  border: `1px solid ${
                                    w.day === day
                                      ? "rgba(245, 239, 216, 0.45)"
                                      : "rgba(245, 239, 216, 0.18)"
                                  }`,
                                  background:
                                    w.day === day
                                      ? "rgba(245, 239, 216, 0.18)"
                                      : "rgba(0, 0, 0, 0.18)",
                                  color: "#f5efd8",
                                }}
                              >
                                <div
                                  style={{
                                    fontWeight: 700,
                                    color: "#f8f1c8",
                                  }}
                                >
                                  {w.day}
                                </div>
                                <div
                                  style={{
                                    fontSize: "0.85rem",
                                    marginTop: 2,
                                    fontWeight: w.roomName ? 650 : 400,
                                    color: w.roomName
                                      ? "#f5efd8"
                                      : "rgba(245, 239, 216, 0.55)",
                                  }}
                                >
                                  {w.roomName || "—"}
                                </div>
                                {w.teacherName ? (
                                  <div
                                    style={{
                                      fontSize: "0.75rem",
                                      color: "rgba(245, 239, 216, 0.72)",
                                    }}
                                  >
                                    {w.teacherName}
                                  </div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </div>

                        {selectedStudent.classes.length > 0 ? (
                          <div style={{ marginTop: "1rem" }}>
                            <div
                              className="muted"
                              style={{
                                fontSize: "0.75rem",
                                fontWeight: 700,
                                marginBottom: 6,
                              }}
                            >
                              CLASS LIST SOURCES (from teachers)
                            </div>
                            <div className="row">
                              {selectedStudent.classes.map((c, i) => (
                                <span
                                  key={`${c.teacherId}-${c.period}-${i}`}
                                  className="badge badge-gray"
                                >
                                  P{c.period} {c.subject} · {c.teacherName} (
                                  {c.roomName})
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {selectedStudent.priorityRanks &&
                        selectedStudent.priorityRanks.length > 0 ? (
                          <div style={{ marginTop: "1rem" }}>
                            <div
                              className="muted"
                              style={{
                                fontSize: "0.75rem",
                                fontWeight: 700,
                                marginBottom: 6,
                              }}
                            >
                              WEEKLY PRIORITY (highest → lowest)
                            </div>
                            <div className="row">
                              {selectedStudent.priorityRanks.map((r, i) => (
                                <span
                                  key={`${r}-${i}`}
                                  className={`badge ${i === 0 ? "badge-blue" : "badge-gray"}`}
                                >
                                  #{i + 1} {r}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="card" id="admin-student-roster">
                      <div
                        className="card-pad row"
                        style={{
                          justifyContent: "space-between",
                          flexWrap: "wrap",
                          gap: "0.65rem",
                          paddingBottom: 0,
                        }}
                      >
                        <div>
                          <h3 className="section-title" style={{ margin: 0 }}>
                            Complete roster
                          </h3>
                          <p
                            className="muted"
                            style={{
                              margin: "0.25rem 0 0",
                              fontSize: "0.85rem",
                            }}
                          >
                            Combined from every teacher class list. Showing{" "}
                            {filteredStudents.length}
                            {search || locationFilter !== "all"
                              ? ` of ${overview.masterRoster.length}`
                              : ""}{" "}
                            · click a row for room details
                          </p>
                        </div>
                        <div className="row">
                          <select
                            className="select"
                            value={locationFilter}
                            onChange={(e) =>
                              setLocationFilter(
                                e.target.value as typeof locationFilter
                              )
                            }
                            style={{ minWidth: 140 }}
                          >
                            <option value="all">All locations</option>
                            <option value="in_room">In a room ({day})</option>
                            <option value="no_room">No room yet</option>
                          </select>
                          {search ? (
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => setSearch("")}
                            >
                              Clear search
                            </button>
                          ) : null}
                        </div>
                      </div>

                      {overview.masterRoster.length === 0 ? (
                        <div className="empty">
                          No students yet. When teachers join with code{" "}
                          <strong>{session.joinCode}</strong> and upload class
                          lists, they appear here automatically.
                        </div>
                      ) : filteredStudents.length === 0 ? (
                        <div className="empty">
                          No students match “{search}”.
                        </div>
                      ) : (
                        <div className="table-wrap" style={{ border: "none" }}>
                          <table className="data">
                            <thead>
                              <tr>
                                <th>Student</th>
                                <th>ID</th>
                                <th>Current room ({day})</th>
                                <th>Teacher</th>
                                <th>Attendance</th>
                                <th>From class list(s)</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredStudents.map((s) => {
                                const active =
                                  selectedStudentId === s.studentId;
                                return (
                                  <tr
                                    key={s.studentId}
                                    id={
                                      // Prefer detail card id when selected; else row is the scroll target
                                      active
                                        ? undefined
                                        : `admin-student-${s.studentId}`
                                    }
                                    onClick={() => openStudent(s.studentId)}
                                    style={{
                                      cursor: "pointer",
                                      background: active
                                        ? "#e5e7eb"
                                        : undefined,
                                      color: active ? "#1f2937" : undefined,
                                    }}
                                  >
                                    <td style={{ fontWeight: active ? 700 : 500 }}>
                                      {s.lastName}, {s.firstName}
                                    </td>
                                    <td>
                                      <code style={{ fontSize: "0.8rem" }}>
                                        {s.studentId}
                                      </code>
                                    </td>
                                    <td>
                                      {s.location ? (
                                        <>
                                          <strong>{s.location.roomName}</strong>
                                          {s.location.contested ? (
                                            <span
                                              className="badge badge-amber"
                                              style={{ marginLeft: 6 }}
                                            >
                                              priority
                                            </span>
                                          ) : null}
                                        </>
                                      ) : (
                                        <span
                                          className="badge badge-amber"
                                          style={{ fontWeight: 600 }}
                                        >
                                          Not placed
                                        </span>
                                      )}
                                    </td>
                                    <td className="muted">
                                      {s.location?.teacherName ?? "—"}
                                      {s.location?.type === "open_study" ? (
                                        <span
                                          className="badge badge-teal"
                                          style={{ marginLeft: 6 }}
                                        >
                                          Open
                                        </span>
                                      ) : null}
                                    </td>
                                    <td>
                                      {s.location ? (
                                        <StatusBadge
                                          status={s.location.attendanceStatus}
                                        />
                                      ) : (
                                        <span className="muted">—</span>
                                      )}
                                    </td>
                                    <td
                                      className="muted"
                                      style={{
                                        maxWidth: 220,
                                        whiteSpace: "normal",
                                        fontSize: "0.82rem",
                                      }}
                                    >
                                      {s.classes.length === 0
                                        ? "—"
                                        : s.classes
                                            .map(
                                              (c) =>
                                                `P${c.period} ${c.subject} (${c.teacherName})`
                                            )
                                            .join("; ")}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}

                {tab === "rooms" ? (
                  <div className="stack">
                    {overview.teachers.length === 0 ? (
                      <div className="card empty">
                        No teachers have joined yet. Share code{" "}
                        <strong>{session.joinCode}</strong>.
                      </div>
                    ) : (
                      overview.teachers.map((t) => (
                        <div key={t.teacherId} className="card">
                          <button
                            type="button"
                            onClick={() =>
                              setExpanded(
                                expanded === t.teacherId ? null : t.teacherId
                              )
                            }
                            style={{
                              width: "100%",
                              textAlign: "left",
                              border: "none",
                              background: "transparent",
                              padding: "1rem 1.25rem",
                              cursor: "pointer",
                            }}
                          >
                            <div
                              className="row"
                              style={{ justifyContent: "space-between" }}
                            >
                              <div>
                                <strong>{t.roomName}</strong>
                                <span
                                  className="muted"
                                  style={{ marginLeft: 8 }}
                                >
                                  {t.teacherName}
                                </span>
                                {t.isOpenStudy ? (
                                  <span
                                    className="badge badge-teal"
                                    style={{ marginLeft: 8 }}
                                  >
                                    Open study
                                  </span>
                                ) : null}
                                <span
                                  className="muted"
                                  style={{ marginLeft: 8, fontSize: "0.85rem" }}
                                >
                                  {t.students.length} students
                                </span>
                              </div>
                              <div
                                className="row"
                                style={{ fontSize: "0.85rem" }}
                              >
                                <span className="badge badge-green">
                                  {t.present} present
                                </span>
                                <span className="badge badge-red">
                                  {t.absent} absent
                                </span>
                                <span className="badge badge-amber">
                                  {t.unmarked} unmarked
                                </span>
                                <span className="muted">
                                  {expanded === t.teacherId ? "▲" : "▼"}
                                </span>
                              </div>
                            </div>
                          </button>
                          {expanded === t.teacherId ? (
                            <div style={{ padding: "0 1.25rem 1rem" }}>
                              {t.students.length === 0 ? (
                                <p
                                  className="muted empty"
                                  style={{ padding: "1rem" }}
                                >
                                  No students assigned for {day}.
                                </p>
                              ) : (
                                <div className="table-wrap">
                                  <table className="data">
                                    <thead>
                                      <tr>
                                        <th>Student</th>
                                        <th>ID</th>
                                        <th>Type</th>
                                        <th>Attendance</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {t.students.map((s) => (
                                        <tr
                                          key={s.studentId}
                                          onClick={() =>
                                            openStudent(s.studentId)
                                          }
                                          style={{ cursor: "pointer" }}
                                        >
                                          <td>
                                            {s.lastName}, {s.firstName}
                                          </td>
                                          <td>
                                            <code>{s.studentId}</code>
                                          </td>
                                          <td>
                                            {s.type === "open_study" ? (
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
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                ) : null}

                {tab === "missing" ? (
                  <div className="card">
                    {overview.missing.length === 0 ? (
                      <div className="empty">
                        Everyone assigned for {day} is present or excused. 🎉
                      </div>
                    ) : (
                      <div className="table-wrap" style={{ border: "none" }}>
                        <table className="data">
                          <thead>
                            <tr>
                              <th>Student</th>
                              <th>ID</th>
                              <th>Room</th>
                              <th>Teacher</th>
                              <th>Type</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {overview.missing.map((m) => (
                              <tr
                                key={m.studentId + m.roomName}
                                onClick={() => openStudent(m.studentId)}
                                style={{ cursor: "pointer" }}
                              >
                                <td>
                                  {m.lastName}, {m.firstName}
                                </td>
                                <td>
                                  <code>{m.studentId}</code>
                                </td>
                                <td>
                                  <strong>{m.roomName}</strong>
                                </td>
                                <td>{m.teacherName}</td>
                                <td>
                                  {m.assignmentType === "open_study" ? (
                                    <span className="badge badge-teal">
                                      Open
                                    </span>
                                  ) : (
                                    <span className="badge badge-blue">
                                      Required
                                    </span>
                                  )}
                                </td>
                                <td>
                                  <StatusBadge status={m.attendanceStatus} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ) : null}

                {tab === "unassigned" ? (
                  <div className="card">
                    {overview.unassigned.length === 0 ? (
                      <div className="empty">
                        All rostered students have a placement for {day}.
                      </div>
                    ) : (
                      <>
                        <div className="card-pad" style={{ paddingBottom: 0 }}>
                          <p
                            className="muted"
                            style={{ margin: 0, fontSize: "0.9rem" }}
                          >
                            On a teacher class list but not assigned to any room
                            on {day}. Click a student to inspect.
                          </p>
                        </div>
                        <div className="table-wrap" style={{ border: "none" }}>
                          <table className="data">
                            <thead>
                              <tr>
                                <th>Student</th>
                                <th>ID</th>
                              </tr>
                            </thead>
                            <tbody>
                              {overview.unassigned.map((s) => (
                                <tr
                                  key={s.id}
                                  onClick={() => openStudent(s.id)}
                                  style={{ cursor: "pointer" }}
                                >
                                  <td>
                                    {s.lastName}, {s.firstName}
                                  </td>
                                  <td>
                                    <code>{s.id}</code>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </div>
                ) : null}

                {tab === "offerings" ? (
                  <div className="stack">
                    <div className="card card-pad stack">
                      <h3 className="section-title">
                        Tutorial offering sections
                      </h3>
                      <p
                        className="muted"
                        style={{ margin: 0, fontSize: "0.9rem" }}
                      >
                        Teachers pick one of these when they join.{" "}
                        <strong>Priority 1 is highest</strong> — if multiple
                        teachers request the same student, the highest-priority
                        subject wins and that student lands on that teacher&apos;s
                        attendance roster automatically. Set a default seat cap
                        for open rooms.
                      </p>
                      <div className="grid-2">
                        <div className="field">
                          <label>Section name</label>
                          <input
                            className="input"
                            value={offForm.name}
                            onChange={(e) =>
                              setOffForm((f) => ({ ...f, name: e.target.value }))
                            }
                            placeholder="e.g. Math Lab"
                          />
                        </div>
                        <div className="field">
                          <label>Subject</label>
                          <input
                            className="input"
                            value={offForm.subject}
                            onChange={(e) =>
                              setOffForm((f) => ({
                                ...f,
                                subject: e.target.value,
                              }))
                            }
                            placeholder="e.g. Algebra"
                          />
                        </div>
                        <div className="field">
                          <label>Priority (1 = highest)</label>
                          <input
                            className="input"
                            type="number"
                            min={1}
                            value={offForm.priority}
                            onChange={(e) =>
                              setOffForm((f) => ({
                                ...f,
                                priority: e.target.value,
                              }))
                            }
                          />
                        </div>
                        <div className="field">
                          <label>Default open-room capacity</label>
                          <input
                            className="input"
                            type="number"
                            min={1}
                            value={offForm.defaultCapacity}
                            onChange={(e) =>
                              setOffForm((f) => ({
                                ...f,
                                defaultCapacity: e.target.value,
                              }))
                            }
                          />
                        </div>
                      </div>
                      <div className="field">
                        <label>Description (optional)</label>
                        <input
                          className="input"
                          value={offForm.description}
                          onChange={(e) =>
                            setOffForm((f) => ({
                              ...f,
                              description: e.target.value,
                            }))
                          }
                          placeholder="What students work on in this section"
                        />
                      </div>
                      <button
                        className="btn btn-primary"
                        disabled={
                          !offForm.name.trim() ||
                          !offForm.subject.trim() ||
                          loading
                        }
                        onClick={async () => {
                          if (!session) return;
                          setLoading(true);
                          setError("");
                          try {
                            const data = await api<{
                              offerings: typeof offerings;
                            }>("/api/offerings", {
                              method: "POST",
                              body: JSON.stringify({
                                sessionId: session.id,
                                name: offForm.name,
                                subject: offForm.subject,
                                description: offForm.description,
                                priority: Number(offForm.priority) || 1,
                                defaultCapacity:
                                  Number(offForm.defaultCapacity) || 30,
                              }),
                            });
                            setOfferings(data.offerings);
                            setOffForm({
                              name: "",
                              subject: "",
                              description: "",
                              priority: String((data.offerings?.length || 0) + 1),
                              defaultCapacity: "30",
                            });
                          } catch (e) {
                            setError(
                              e instanceof Error ? e.message : "Failed to save"
                            );
                          } finally {
                            setLoading(false);
                          }
                        }}
                      >
                        Add section
                      </button>
                    </div>
                    <div className="card">
                      {offerings.length === 0 ? (
                        <div className="empty">
                          No sections yet. Add offerings so teachers can choose
                          what they teach this week.
                        </div>
                      ) : (
                        <div className="table-wrap" style={{ border: "none" }}>
                          <table className="data">
                            <thead>
                              <tr>
                                <th>Priority</th>
                                <th>Section</th>
                                <th>Subject</th>
                                <th>Default cap</th>
                                <th></th>
                              </tr>
                            </thead>
                            <tbody>
                              {offerings.map((o) => (
                                <tr key={o.id}>
                                  <td>
                                    <span className="badge badge-blue">
                                      #{o.priority}
                                    </span>
                                  </td>
                                  <td>
                                    <strong>{o.name}</strong>
                                    {o.description ? (
                                      <div
                                        className="muted"
                                        style={{ fontSize: "0.8rem" }}
                                      >
                                        {o.description}
                                      </div>
                                    ) : null}
                                  </td>
                                  <td>{o.subject}</td>
                                  <td>{o.defaultCapacity}</td>
                                  <td>
                                    <button
                                      className="btn btn-danger btn-sm"
                                      onClick={async () => {
                                        if (!session) return;
                                        if (!confirm(`Remove “${o.name}”?`))
                                          return;
                                        const data = await api<{
                                          offerings: typeof offerings;
                                        }>("/api/offerings", {
                                          method: "DELETE",
                                          body: JSON.stringify({
                                            id: o.id,
                                            sessionId: session.id,
                                          }),
                                        });
                                        setOfferings(data.offerings);
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

                {tab === "admins" ? (
                  <div className="stack">
                    <div className="card card-pad stack">
                      <h3 className="section-title">Admin access</h3>
                      <p
                        className="muted"
                        style={{ margin: 0, fontSize: "0.9rem" }}
                      >
                        Hardcoded first admins:{" "}
                        <strong>
                          {(bootstrapAdmins.length
                            ? bootstrapAdmins
                            : ["Lisa", "Principal Lee", "Admin"]
                          ).join(", ")}
                        </strong>
                        . Grant others by exact display name they will use at
                        sign-in.
                      </p>
                      <div className="row">
                        <div className="field" style={{ flex: 1 }}>
                          <label>Grant admin access to</label>
                          <input
                            className="input"
                            value={newAdminName}
                            onChange={(e) => setNewAdminName(e.target.value)}
                            placeholder="e.g. Ms. Chen"
                          />
                        </div>
                        <button
                          className="btn btn-primary"
                          style={{ alignSelf: "flex-end" }}
                          disabled={!newAdminName.trim() || !person || loading}
                          onClick={async () => {
                            if (!person) return;
                            setLoading(true);
                            setError("");
                            try {
                              const data = await api<{
                                grants: typeof adminGrants;
                              }>("/api/admins", {
                                method: "POST",
                                body: JSON.stringify({
                                  name: newAdminName,
                                  grantedById: person.id,
                                }),
                              });
                              setAdminGrants(data.grants);
                              setNewAdminName("");
                            } catch (e) {
                              setError(
                                e instanceof Error ? e.message : "Failed"
                              );
                            } finally {
                              setLoading(false);
                            }
                          }}
                        >
                          Grant access
                        </button>
                      </div>
                    </div>
                    <div className="card">
                      <div className="table-wrap" style={{ border: "none" }}>
                        <table className="data">
                          <thead>
                            <tr>
                              <th>Name</th>
                              <th>Source</th>
                              <th></th>
                            </tr>
                          </thead>
                          <tbody>
                            {adminGrants.map((g) => (
                              <tr key={g.id}>
                                <td>
                                  <strong>{g.name}</strong>
                                </td>
                                <td className="muted">
                                  {g.isBootstrap
                                    ? "Hardcoded bootstrap"
                                    : `Granted by ${g.grantedByName}`}
                                </td>
                                <td>
                                  {g.isBootstrap ? (
                                    <span className="badge badge-gray">
                                      Locked
                                    </span>
                                  ) : (
                                    <button
                                      className="btn btn-danger btn-sm"
                                      onClick={async () => {
                                        if (!person) return;
                                        const data = await api<{
                                          grants: typeof adminGrants;
                                        }>("/api/admins", {
                                          method: "DELETE",
                                          body: JSON.stringify({
                                            grantId: g.id,
                                            byAdminId: person.id,
                                          }),
                                        });
                                        setAdminGrants(data.grants);
                                      }}
                                    >
                                      Revoke
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                ) : null}

                {tab === "priority" ? (
                  <div className="stack">
                    <div className="card card-pad stack">
                      <h3 className="section-title">Weekly priority list</h3>
                      <p
                        className="muted"
                        style={{ margin: 0, fontSize: "0.9rem" }}
                      >
                        When multiple teachers request the same student for a
                        day, the student attends the highest-priority room on
                        this list. Labels should match a{" "}
                        <strong>room name</strong> or{" "}
                        <strong>teacher name</strong> (e.g.{" "}
                        <code>Room 214</code> or <code>Ms. Rivera</code>).
                      </p>
                      <p
                        className="muted"
                        style={{ margin: 0, fontSize: "0.85rem" }}
                      >
                        Columns:{" "}
                        <code>
                          First Name, Last Name, Student ID (optional), Priority
                          1, Priority 2, Priority 3…
                        </code>
                      </p>

                      <div className="grid-2">
                        <div className="stack">
                          <button
                            className="btn btn-secondary"
                            type="button"
                            onClick={() => priorityFileRef.current?.click()}
                            disabled={loading}
                          >
                            Upload Excel / CSV
                          </button>
                          <input
                            ref={priorityFileRef}
                            type="file"
                            accept=".xlsx,.xls,.csv,text/csv"
                            style={{ display: "none" }}
                            onChange={(e) =>
                              void handlePriorityFile(
                                e.target.files?.[0] || null
                              )
                            }
                          />
                        </div>
                        <div className="field">
                          <label>Or paste rows</label>
                          <textarea
                            className="textarea"
                            value={priorityPaste}
                            onChange={(e) => setPriorityPaste(e.target.value)}
                            placeholder={`First Name, Last Name, Priority 1, Priority 2, Priority 3\nAva, Chen, Room 214, Room 101, Library\nJordan, Smith, Ms. Rivera, Room 214`}
                          />
                          <button
                            className="btn btn-primary"
                            disabled={!priorityPaste.trim() || loading}
                            onClick={() => {
                              const parsed = parsePriorityText(priorityPaste);
                              void importPriorities(parsed.rows);
                            }}
                          >
                            Import priority list
                          </button>
                        </div>
                      </div>
                      {priorityMsg ? (
                        <div className="success-banner">{priorityMsg}</div>
                      ) : null}
                    </div>

                    <div className="card">
                      <div className="card-pad" style={{ paddingBottom: 0 }}>
                        <h3 className="section-title">
                          Saved priorities ({priorities.length})
                        </h3>
                      </div>
                      {priorities.length === 0 ? (
                        <div className="empty">
                          No weekly priority list yet. Upload one so contested
                          students go to the correct room.
                        </div>
                      ) : (
                        <div className="table-wrap" style={{ border: "none" }}>
                          <table className="data">
                            <thead>
                              <tr>
                                <th>Student</th>
                                <th>ID</th>
                                <th>Priority order (1 = highest)</th>
                              </tr>
                            </thead>
                            <tbody>
                              {priorities.map((p) => (
                                <tr
                                  key={p.id}
                                  onClick={() => openStudent(p.studentId)}
                                  style={{ cursor: "pointer" }}
                                >
                                  <td>
                                    {p.lastName}, {p.firstName}
                                  </td>
                                  <td>
                                    <code style={{ fontSize: "0.8rem" }}>
                                      {p.studentId}
                                    </code>
                                  </td>
                                  <td>
                                    <div className="row">
                                      {p.ranks.map((r, i) => (
                                        <span
                                          key={`${p.id}-${i}`}
                                          className={`badge ${
                                            i === 0
                                              ? "badge-blue"
                                              : "badge-gray"
                                          }`}
                                        >
                                          {i + 1}. {r}
                                        </span>
                                      ))}
                                    </div>
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
              </>
            ) : (
              <p className="muted">Loading live overview…</p>
            )}
          </>
        )}
      </main>
    </>
  );
}
