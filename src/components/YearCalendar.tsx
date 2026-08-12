"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { DayOfWeek, GradeLevel, RoomAccessMode } from "@/lib/types";
import { DEFAULT_SUBJECTS } from "@/lib/types";
import { addMonths, mondayOfWeek } from "@/lib/dates";

type YearCalData = {
  schoolYear: { label: string; startDate: string; endDate: string };
  view: "month" | "week";
  year: number;
  month: number;
  monthLabel: string;
  weekOf: string;
  weekLabel: string;
  subjects: string[];
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
  weekDays: {
    day: DayOfWeek;
    date: string;
    dateLabel: string;
    primarySubject: string | null;
    subjectOrder: string[];
    note: string;
    isToday: boolean;
    dayType: string;
    offerCount: number;
    openOfferCount: number;
  }[];
  weekOffers: {
    id: string;
    date: string;
    teacherId: string;
    teacherName: string;
    grades: GradeLevel[];
    subject: string;
    unitTitle: string;
    accessMode: RoomAccessMode;
    roomName: string;
    capacity: number;
  }[];
};

type Props = {
  mode: "admin" | "teacher" | "student";
  teacherId?: string;
  /** When teacher/admin is in a live session, pass for linking */
  sessionId?: string;
  onWeekChange?: (weekOf: string) => void;
  /** Called after a teacher successfully creates/updates/deletes an offering */
  onOfferChanged?: () => void;
  /** Jump to this week and scroll to today (e.g. teacher opens Priority calendar) */
  focusTodayToken?: number;
};

export function YearCalendar({
  mode,
  teacherId,
  sessionId,
  onWeekChange,
  onOfferChanged,
  focusTodayToken = 0,
}: Props) {
  /** Students only ever see one week at a time — no month grid */
  const studentWeekOnly = mode === "student";
  const [view, setView] = useState<"month" | "week">(
    studentWeekOnly || mode === "teacher" ? "week" : "month"
  );
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth() + 1);
  const [weekOf, setWeekOf] = useState(() => mondayOfWeek());
  const [data, setData] = useState<YearCalData | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const todayCellRef = useRef<HTMLButtonElement | null>(null);

  // Keep students locked to week view even if state is toggled somehow
  useEffect(() => {
    if (studentWeekOnly && view !== "week") setView("week");
  }, [studentWeekOnly, view]);

  // Jump to current week / today when teacher opens the Priority calendar tab
  useEffect(() => {
    if (!focusTodayToken) return;
    const now = new Date();
    setYear(now.getFullYear());
    setMonth(now.getMonth() + 1);
    setWeekOf(mondayOfWeek());
    setView("week");
  }, [focusTodayToken]);

  useEffect(() => {
    if (!focusTodayToken || !data) return;
    const t = window.setTimeout(() => {
      todayCellRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "center",
      });
    }, 80);
    return () => window.clearTimeout(t);
  }, [focusTodayToken, data]);

  // Admin priority popover (appears at click)
  const [editDate, setEditDate] = useState<string | null>(null);
  const [primary, setPrimary] = useState("");
  const [note, setNote] = useState("");
  const [dayType, setDayType] = useState<"tutorial" | "no_tutorial" | "special">(
    "tutorial"
  );
  const [popPos, setPopPos] = useState<{ top: number; left: number } | null>(
    null
  );
  const priorityEditorRef = useRef<HTMLDivElement>(null);

  // Teacher offer popover
  const [offerDate, setOfferDate] = useState<string | null>(null);
  const offerEditorRef = useRef<HTMLDivElement>(null);
  const unitTitleRef = useRef<HTMLInputElement>(null);
  const [offerForm, setOfferForm] = useState({
    grade7: true,
    grade8: true,
    subject: "English",
    unitTitle: "",
    accessMode: "closed" as RoomAccessMode,
    roomName: "",
    capacity: "30",
  });

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({
        yearCal: "1",
        view,
        year: String(year),
        month: String(month),
        weekOf,
      });
      if (teacherId) q.set("teacherId", teacherId);
      const res = await api<{ calendar: YearCalData }>(`/api/calendar?${q}`);
      setData(res.calendar);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load calendar");
    }
  }, [view, year, month, weekOf, teacherId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    onWeekChange?.(weekOf);
  }, [weekOf, onWeekChange]);

  function goMonth(delta: number) {
    const next = addMonths(year, month, delta);
    setYear(next.year);
    setMonth(next.month);
    setView("month");
  }

  function selectWeek(date: string) {
    const mon = mondayOfWeek(new Date(date + "T12:00:00"));
    setWeekOf(mon);
    setView("week");
    const d = new Date(date + "T12:00:00");
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  }

  function clampPopover(x: number, y: number, w = 320, h = 380) {
    const pad = 12;
    const left = Math.min(
      Math.max(pad, x),
      Math.max(pad, window.innerWidth - w - pad)
    );
    const top = Math.min(
      Math.max(pad, y),
      Math.max(pad, window.innerHeight - h - pad)
    );
    return { top, left };
  }

  function positionPopover(e: React.MouseEvent | undefined, w: number, h: number) {
    if (e) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      // Sit just under the day they clicked; clamp so it stays on screen
      const below = clampPopover(rect.left, rect.bottom + 6, w, h);
      // If not enough room below, open above the day instead
      if (below.top < rect.bottom) {
        setPopPos(clampPopover(rect.left, rect.top - h - 6, w, h));
      } else {
        setPopPos(below);
      }
      return;
    }
    setPopPos(clampPopover(window.innerWidth / 2 - w / 2, 120, w, h));
  }

  function openAdminDay(
    date: string,
    cell?: YearCalData["cells"][0],
    e?: React.MouseEvent
  ) {
    if (mode !== "admin") {
      selectWeek(date);
      return;
    }
    // Only enforce month-cell constraints when a month cell was passed
    if (cell && (cell.isWeekend || !cell.inSchoolYear)) return;
    setOfferDate(null);
    positionPopover(e, 320, 420);

    setEditDate(date);
    setPrimary(cell?.primarySubject || "");
    setNote("");
    setDayType(
      (cell?.dayType as "tutorial" | "no_tutorial" | "special") || "tutorial"
    );
    const wd = data?.weekDays.find((d) => d.date === date);
    if (wd) {
      setNote(wd.note || "");
      setPrimary(wd.primarySubject || "");
      setDayType(
        (wd.dayType as "tutorial" | "no_tutorial" | "special") || "tutorial"
      );
    }
  }

  function openTeacherDay(date: string, e?: React.MouseEvent) {
    if (mode !== "teacher" || !teacherId) {
      selectWeek(date);
      return;
    }
    const d = new Date(date + "T12:00:00");
    if (d.getDay() === 0 || d.getDay() === 6) return;
    setEditDate(null);
    positionPopover(e, 340, 480);
    setOfferDate(date);
    setOfferForm((f) => ({ ...f, unitTitle: "" }));
  }

  // Close popover on Escape / outside click
  useEffect(() => {
    if (!editDate && !offerDate) return;
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") {
        setEditDate(null);
        setOfferDate(null);
      }
    }
    function onDown(ev: MouseEvent) {
      const t = ev.target as Node;
      if (
        priorityEditorRef.current?.contains(t) ||
        offerEditorRef.current?.contains(t)
      ) {
        return;
      }
      // Don't close when clicking another day cell — openAdminDay will replace
      const el = ev.target as HTMLElement | null;
      if (el?.closest?.("[data-cal-day]")) return;
      setEditDate(null);
      setOfferDate(null);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [editDate, offerDate]);

  async function savePriority() {
    if (!editDate) return;
    setSaving(true);
    setError("");
    try {
      await api("/api/calendar", {
        method: "POST",
        body: JSON.stringify({
          date: editDate,
          primarySubject: dayType === "no_tutorial" ? "" : primary,
          subjectOrder: dayType === "no_tutorial" ? [] : primary ? [primary] : [],
          note,
          dayType,
          sessionId,
        }),
      });
      setEditDate(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function clearPriority() {
    if (!editDate) return;
    setSaving(true);
    try {
      await api("/api/calendar", {
        method: "POST",
        body: JSON.stringify({ action: "clear_day", date: editDate }),
      });
      setEditDate(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Clear failed");
    } finally {
      setSaving(false);
    }
  }

  async function applyWeekPrimary() {
    if (!primary && !editDate) return;
    const subj = primary;
    if (!subj) return;
    setSaving(true);
    try {
      await api("/api/calendar", {
        method: "POST",
        body: JSON.stringify({
          action: "set_week",
          weekOf,
          primarySubject: subj,
          sessionId,
        }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveOffer() {
    if (!offerDate || !teacherId) return;
    setSaving(true);
    setError("");
    try {
      const grades: GradeLevel[] = [];
      if (offerForm.grade7) grades.push("7");
      if (offerForm.grade8) grades.push("8");
      await api("/api/teacher-offers", {
        method: "POST",
        body: JSON.stringify({
          teacherId,
          sessionId,
          date: offerDate,
          grades,
          subject: offerForm.subject,
          unitTitle: offerForm.unitTitle,
          accessMode: offerForm.accessMode,
          roomName: offerForm.roomName,
          capacity: Number(offerForm.capacity) || 30,
        }),
      });
      setOfferDate(null);
      await load();
      onOfferChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save offering");
    } finally {
      setSaving(false);
    }
  }

  async function deleteOffer(id: string) {
    if (!teacherId) return;
    if (!confirm("Remove this offering?")) return;
    await api("/api/teacher-offers", {
      method: "DELETE",
      body: JSON.stringify({ id, teacherId }),
    });
    await load();
    onOfferChanged?.();
  }

  if (!data) {
    return <p className="muted">{error || "Loading school year calendar…"}</p>;
  }

  const subjects = data.subjects.length ? data.subjects : [...DEFAULT_SUBJECTS];

  return (
    <div className="stack">
      {error ? <div className="error-banner">{error}</div> : null}

      {/* Header */}
      <div
        className="row"
        style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}
      >
        <div>
          <div
            className="muted"
            style={{
              fontSize: "0.75rem",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            School year {data.schoolYear.label}
          </div>
          <strong style={{ fontSize: "1.2rem" }}>
            {view === "month" ? data.monthLabel : data.weekLabel}
          </strong>
        </div>
        <div className="row">
          {!studentWeekOnly ? (
            <div className="tabs">
              <button
                className={`tab ${view === "month" ? "active" : ""}`}
                onClick={() => setView("month")}
              >
                Month
              </button>
              <button
                className={`tab ${view === "week" ? "active" : ""}`}
                onClick={() => setView("week")}
              >
                Week
              </button>
            </div>
          ) : null}
          {view === "month" && !studentWeekOnly ? (
            <>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => goMonth(-1)}
              >
                ←
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => goMonth(1)}
              >
                →
              </button>
            </>
          ) : (
            <>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  const d = new Date(weekOf + "T12:00:00");
                  d.setDate(d.getDate() - 7);
                  const mon = mondayOfWeek(d);
                  setWeekOf(mon);
                  setYear(d.getFullYear());
                  setMonth(d.getMonth() + 1);
                }}
              >
                ← Week
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  const d = new Date(weekOf + "T12:00:00");
                  d.setDate(d.getDate() + 7);
                  const mon = mondayOfWeek(d);
                  setWeekOf(mon);
                  setYear(d.getFullYear());
                  setMonth(d.getMonth() + 1);
                }}
              >
                Week →
              </button>
            </>
          )}
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => {
              const now = new Date();
              setYear(now.getFullYear());
              setMonth(now.getMonth() + 1);
              setWeekOf(mondayOfWeek());
              setView("week");
            }}
          >
            This week
          </button>
        </div>
      </div>

      <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>
        {mode === "admin" &&
          "Click a day to set subject priority (or mark no tutorial). Use Month to plan the year; Week for detail."}
        {mode === "teacher" &&
          "Click a day to add an offering in advance. Students only see one week at a time."}
        {mode === "student" &&
          "Showing one week at a time. Use ← Week / Week → to change weeks. Open signup is for free days only."}
      </p>

      {/* Month view (admin / teacher only) */}
      {view === "month" && !studentWeekOnly ? (
        <div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gap: 4,
              marginBottom: 4,
            }}
          >
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div
                key={d}
                className="muted"
                style={{
                  textAlign: "center",
                  fontSize: "0.72rem",
                  fontWeight: 700,
                  padding: "0.35rem",
                }}
              >
                {d}
              </div>
            ))}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gap: 4,
            }}
          >
            {data.cells.map((c) => {
              const clickable =
                !c.isWeekend &&
                c.inSchoolYear &&
                (mode === "admin" || mode === "teacher" || mode === "student");
              return (
                <button
                  key={c.date}
                  type="button"
                  ref={c.isToday ? todayCellRef : undefined}
                  disabled={!clickable}
                  data-cal-day={c.date}
                  onClick={(e) => {
                    if (mode === "admin") openAdminDay(c.date, c, e);
                    else if (mode === "teacher") openTeacherDay(c.date, e);
                    else selectWeek(c.date);
                  }}
                  style={{
                    minHeight: 72,
                    padding: "0.4rem",
                    borderRadius: 10,
                    border: c.isToday
                      ? "2px solid var(--brand)"
                      : "1px solid var(--border)",
                    background: !c.inMonth
                      ? "rgba(6,13,24,0.5)"
                      : !c.inSchoolYear
                        ? "rgba(15,26,42,0.8)"
                        : c.dayType === "no_tutorial"
                          ? "rgba(201,162,39,0.12)"
                          : c.primarySubject
                            ? "rgba(201,162,39,0.1)"
                            : "var(--surface)",
                    opacity: c.inMonth ? 1 : 0.45,
                    cursor: clickable ? "pointer" : "default",
                    textAlign: "left",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.8rem",
                      fontWeight: c.isToday ? 800 : 600,
                      color: c.inMonth ? "var(--ink)" : "var(--muted)",
                    }}
                  >
                    {Number(c.date.slice(8, 10))}
                  </div>
                  {!c.isWeekend && c.inSchoolYear ? (
                    <>
                      <div
                        style={{
                          fontSize: "0.65rem",
                          fontWeight: 700,
                          color:
                            c.dayType === "no_tutorial"
                              ? "var(--warn)"
                              : "var(--brand)",
                          marginTop: 4,
                          lineHeight: 1.2,
                        }}
                      >
                        {c.dayType === "no_tutorial"
                          ? "No tutorial"
                          : c.primarySubject || "—"}
                      </div>
                      {(mode === "teacher"
                        ? c.myOfferCount
                        : c.offerCount) > 0 ? (
                        <div
                          className="muted"
                          style={{ fontSize: "0.62rem", marginTop: 2 }}
                        >
                          {mode === "teacher"
                            ? `${c.myOfferCount} mine`
                            : `${c.offerCount} offer${c.offerCount === 1 ? "" : "s"}`}
                          {c.openOfferCount
                            ? ` · ${c.openOfferCount} open`
                            : ""}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </button>
              );
            })}
          </div>
          <p className="muted" style={{ fontSize: "0.8rem", marginTop: 8 }}>
            Click a weekday to {mode === "admin" ? "set priority" : mode === "teacher" ? "add offering" : "open that week"}.
            Click again via Week view for full detail.
          </p>
        </div>
      ) : null}

      {/* Week view */}
      {view === "week" ? (
        <div className="stack">
          {mode === "admin" ? (
            <div className="row">
              <select
                className="select"
                value={primary}
                onChange={(e) => setPrimary(e.target.value)}
                style={{ minWidth: 160 }}
              >
                <option value="">Set all days this week to…</option>
                {subjects.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-secondary btn-sm"
                disabled={!primary || saving}
                onClick={applyWeekPrimary}
              >
                Apply to week
              </button>
            </div>
          ) : null}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: 10,
            }}
          >
            {data.weekDays.map((d) => (
              <button
                key={d.date}
                type="button"
                ref={d.isToday ? todayCellRef : undefined}
                data-cal-day={d.date}
                onClick={(e) => {
                  if (mode === "admin") openAdminDay(d.date, undefined, e);
                  else if (mode === "teacher") openTeacherDay(d.date, e);
                }}
                style={{
                  textAlign: "left",
                  border: d.isToday
                    ? "2px solid var(--brand)"
                    : "1px solid var(--border)",
                  borderRadius: 14,
                  padding: "0.9rem",
                  background:
                    d.dayType === "no_tutorial"
                      ? "rgba(201,162,39,0.12)"
                      : d.primarySubject
                        ? "linear-gradient(180deg,rgba(201,162,39,0.12),var(--surface) 70%)"
                        : "var(--surface)",
                  cursor:
                    mode === "student" ? "default" : "pointer",
                  boxShadow: "var(--shadow)",
                }}
              >
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong>{d.day}</strong>
                  {d.isToday ? (
                    <span className="badge badge-blue">Today</span>
                  ) : null}
                </div>
                <div className="muted" style={{ fontSize: "0.8rem" }}>
                  {d.dateLabel}
                </div>
                <div
                  style={{
                    marginTop: 10,
                    fontWeight: 750,
                    fontSize: "1.05rem",
                    color:
                      d.dayType === "no_tutorial"
                        ? "var(--warn)"
                        : d.primarySubject
                          ? "var(--brand)"
                          : "var(--muted)",
                  }}
                >
                  {d.dayType === "no_tutorial"
                    ? "No tutorial"
                    : d.primarySubject || "No priority"}
                </div>
                <div className="muted" style={{ fontSize: "0.75rem", marginTop: 6 }}>
                  {d.offerCount} offering{d.offerCount === 1 ? "" : "s"}
                  {d.openOfferCount ? ` · ${d.openOfferCount} open` : ""}
                </div>
                {d.note ? (
                  <div className="muted" style={{ fontSize: "0.72rem", marginTop: 4 }}>
                    {d.note}
                  </div>
                ) : null}
              </button>
            ))}
          </div>

          {/* Week offerings list (students + everyone) */}
          <div className="card">
            <div className="card-pad" style={{ paddingBottom: 0 }}>
              <h3 className="section-title">
                Offerings this week ({data.weekOffers.length})
              </h3>
              <p className="muted" style={{ margin: "0 0 0.5rem", fontSize: "0.85rem" }}>
                {mode === "student"
                  ? "Choose an open room on a free day. Required placements are set by teachers."
                  : "Compiled like the department handout for this week."}
              </p>
            </div>
            {data.weekOffers.length === 0 ? (
              <div className="empty">No offerings scheduled this week yet.</div>
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
                      <th>Teacher</th>
                      {mode === "teacher" ? <th></th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {data.weekOffers.map((o) => (
                      <tr key={o.id}>
                        <td>{o.date}</td>
                        <td>{o.grades.join("/")}</td>
                        <td>{o.subject}</td>
                        <td>{o.unitTitle}</td>
                        <td>
                          {o.accessMode === "open" ? (
                            <span className="badge badge-teal">
                              Open · {o.capacity}
                            </span>
                          ) : (
                            <span className="badge badge-gray">Closed</span>
                          )}
                        </td>
                        <td>
                          <strong>{o.roomName}</strong>
                        </td>
                        <td>{o.teacherName}</td>
                        {mode === "teacher" && o.teacherId === teacherId ? (
                          <td>
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => void deleteOffer(o.id)}
                            >
                              Remove
                            </button>
                          </td>
                        ) : mode === "teacher" ? (
                          <td />
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* Admin priority popover — appears at click */}
      {mode === "admin" && editDate && popPos ? (
        <div
          ref={priorityEditorRef}
          className="card card-pad stack"
          role="dialog"
          aria-label={`Set priority for ${editDate}`}
          style={{
            position: "fixed",
            top: popPos.top,
            left: popPos.left,
            width: 320,
            maxWidth: "calc(100vw - 24px)",
            maxHeight: "min(420px, calc(100vh - 24px))",
            overflow: "auto",
            zIndex: 50,
            outline: "2px solid var(--gold)",
            outlineOffset: 0,
            boxShadow: "var(--shadow), var(--shadow-gold)",
          }}
        >
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <div
                className="muted"
                style={{
                  fontSize: "0.68rem",
                  fontWeight: 750,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                }}
              >
                Set priority
              </div>
              <strong style={{ color: "var(--gold-bright)" }}>{editDate}</strong>
            </div>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setEditDate(null)}
            >
              ✕
            </button>
          </div>

          <div className="row" style={{ gap: 6 }}>
            {(
              [
                ["tutorial", "Tutorial"],
                ["no_tutorial", "None"],
                ["special", "Special"],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                className={`btn btn-sm ${dayType === val ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setDayType(val)}
              >
                {label}
              </button>
            ))}
          </div>

          {dayType !== "no_tutorial" ? (
            <div>
              <div
                className="muted"
                style={{
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  marginBottom: 8,
                }}
              >
                Subject (click to select)
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 6,
                }}
              >
                {subjects.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`btn btn-sm ${
                      primary === s ? "btn-primary" : "btn-secondary"
                    }`}
                    style={{ justifyContent: "flex-start" }}
                    onClick={() => setPrimary(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="field">
            <label>Note (optional)</label>
            <input
              className="input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Showcase prep…"
              onKeyDown={(e) => {
                if (e.key === "Enter") void savePriority();
              }}
            />
          </div>

          <div className="row">
            <button
              className="btn btn-primary"
              disabled={saving || (dayType !== "no_tutorial" && !primary)}
              onClick={savePriority}
              style={{ flex: 1 }}
            >
              Save
            </button>
            <button
              className="btn btn-danger btn-sm"
              disabled={saving}
              onClick={clearPriority}
            >
              Clear
            </button>
          </div>
        </div>
      ) : null}

      {/* Teacher offer popover — appears at click */}
      {mode === "teacher" && offerDate && popPos ? (
        <div
          ref={offerEditorRef}
          className="card card-pad stack"
          role="dialog"
          aria-label={`Add offering for ${offerDate}`}
          style={{
            position: "fixed",
            top: popPos.top,
            left: popPos.left,
            width: 340,
            maxWidth: "calc(100vw - 24px)",
            maxHeight: "min(480px, calc(100vh - 24px))",
            overflow: "auto",
            zIndex: 50,
            outline: "2px solid var(--gold)",
            boxShadow: "var(--shadow), var(--shadow-gold)",
          }}
        >
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <div
                className="muted"
                style={{
                  fontSize: "0.68rem",
                  fontWeight: 750,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                }}
              >
                Add offering
              </div>
              <strong style={{ color: "var(--gold-bright)" }}>{offerDate}</strong>
            </div>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setOfferDate(null)}
            >
              ✕
            </button>
          </div>
          <div className="row">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={offerForm.grade7}
                onChange={(e) =>
                  setOfferForm((f) => ({ ...f, grade7: e.target.checked }))
                }
              />
              7th
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={offerForm.grade8}
                onChange={(e) =>
                  setOfferForm((f) => ({ ...f, grade8: e.target.checked }))
                }
              />
              8th
            </label>
          </div>
          <div className="field">
            <label>Subject</label>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 6,
              }}
            >
              {subjects.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`btn btn-sm ${
                    offerForm.subject === s ? "btn-primary" : "btn-secondary"
                  }`}
                  style={{ justifyContent: "flex-start", fontSize: "0.78rem" }}
                  onClick={() =>
                    setOfferForm((f) => ({ ...f, subject: s }))
                  }
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="cal-unit-title">Unit / title</label>
            <input
              id="cal-unit-title"
              ref={unitTitleRef}
              className="input"
              value={offerForm.unitTitle}
              onChange={(e) =>
                setOfferForm((f) => ({ ...f, unitTitle: e.target.value }))
              }
              placeholder="Math Support"
            />
          </div>
          <div className="grid-2">
            <div className="field">
              <label>Room</label>
              <input
                className="input"
                value={offerForm.roomName}
                onChange={(e) =>
                  setOfferForm((f) => ({ ...f, roomName: e.target.value }))
                }
                placeholder="33"
              />
            </div>
            <div className="field">
              <label>Access</label>
              <select
                className="select"
                value={offerForm.accessMode}
                onChange={(e) =>
                  setOfferForm((f) => ({
                    ...f,
                    accessMode: e.target.value as RoomAccessMode,
                  }))
                }
              >
                <option value="closed">Closed</option>
                <option value="open">Open</option>
              </select>
            </div>
          </div>
          {offerForm.accessMode === "open" ? (
            <div className="field">
              <label>Capacity</label>
              <input
                className="input"
                type="number"
                min={1}
                value={offerForm.capacity}
                onChange={(e) =>
                  setOfferForm((f) => ({ ...f, capacity: e.target.value }))
                }
              />
            </div>
          ) : null}
          <button
            className="btn btn-primary"
            disabled={saving}
            onClick={saveOffer}
          >
            Publish offering
          </button>
        </div>
      ) : null}
    </div>
  );
}
