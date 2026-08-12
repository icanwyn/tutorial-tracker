"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { DayOfWeek } from "@/lib/types";

export type CalendarDayView = {
  day: DayOfWeek;
  date: string;
  dateLabel: string;
  primarySubject: string | null;
  subjectOrder: string[];
  note: string;
  isToday: boolean;
};

export type CalendarData = {
  weekOf: string;
  weekLabel: string;
  days: CalendarDayView[];
  subjects: string[];
};

type Props = {
  sessionId: string;
  /** Admin can edit; teachers only view */
  editable?: boolean;
  compact?: boolean;
};

export function PriorityCalendar({
  sessionId,
  editable = false,
  compact = false,
}: Props) {
  const [calendar, setCalendar] = useState<CalendarData | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedDay, setSelectedDay] = useState<DayOfWeek | null>(null);
  const [draftPrimary, setDraftPrimary] = useState("");
  const [draftOrder, setDraftOrder] = useState<string[]>([]);
  const [draftNote, setDraftNote] = useState("");
  const [weekPrimary, setWeekPrimary] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await api<{ calendar: CalendarData }>(
        `/api/calendar?sessionId=${sessionId}`
      );
      setCalendar(data.calendar);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load calendar");
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  function openDay(day: CalendarDayView) {
    if (!editable) return;
    setSelectedDay(day.day);
    setDraftPrimary(day.primarySubject || "");
    setDraftOrder(
      day.subjectOrder.length
        ? [...day.subjectOrder]
        : day.primarySubject
          ? [day.primarySubject]
          : []
    );
    setDraftNote(day.note || "");
  }

  async function saveDay() {
    if (!selectedDay) return;
    setSaving(true);
    setError("");
    try {
      let order = [...draftOrder];
      if (draftPrimary && !order.includes(draftPrimary)) {
        order = [draftPrimary, ...order.filter((s) => s !== draftPrimary)];
      } else if (draftPrimary) {
        order = [draftPrimary, ...order.filter((s) => s !== draftPrimary)];
      }
      const data = await api<{ calendar: CalendarData }>("/api/calendar", {
        method: "POST",
        body: JSON.stringify({
          sessionId,
          day: selectedDay,
          subjectOrder: order,
          note: draftNote,
        }),
      });
      setCalendar(data.calendar);
      setSelectedDay(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function clearDay(day: DayOfWeek) {
    setSaving(true);
    try {
      const data = await api<{ calendar: CalendarData }>("/api/calendar", {
        method: "POST",
        body: JSON.stringify({
          action: "clear_day",
          sessionId,
          day,
        }),
      });
      setCalendar(data.calendar);
      if (selectedDay === day) setSelectedDay(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Clear failed");
    } finally {
      setSaving(false);
    }
  }

  async function applyWeek() {
    if (!weekPrimary.trim()) return;
    setSaving(true);
    setError("");
    try {
      const data = await api<{ calendar: CalendarData }>("/api/calendar", {
        method: "POST",
        body: JSON.stringify({
          action: "set_week",
          sessionId,
          primarySubject: weekPrimary.trim(),
        }),
      });
      setCalendar(data.calendar);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  function moveInOrder(subject: string, dir: -1 | 1) {
    setDraftOrder((prev) => {
      const i = prev.indexOf(subject);
      if (i < 0) return prev;
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  }

  function toggleInOrder(subject: string) {
    setDraftOrder((prev) => {
      if (prev.includes(subject)) {
        return prev.filter((s) => s !== subject);
      }
      return [...prev, subject];
    });
    if (!draftPrimary) setDraftPrimary(subject);
  }

  if (!calendar) {
    return <p className="muted">{error || "Loading calendar…"}</p>;
  }

  const subjects = calendar.subjects;

  return (
    <div className="stack">
      {error ? <div className="error-banner">{error}</div> : null}

      <div
        className="row"
        style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}
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
            Priority calendar
          </div>
          <strong style={{ fontSize: compact ? "1rem" : "1.15rem" }}>
            {calendar.weekLabel || "This week"}
          </strong>
        </div>
        {editable ? (
          <div className="row">
            <select
              className="select"
              value={weekPrimary}
              onChange={(e) => setWeekPrimary(e.target.value)}
              style={{ minWidth: 160 }}
            >
              <option value="">Set all days to…</option>
              {subjects.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button
              className="btn btn-secondary btn-sm"
              disabled={!weekPrimary || saving}
              onClick={applyWeek}
            >
              Apply to whole week
            </button>
          </div>
        ) : null}
      </div>

      <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>
        {editable
          ? "Click a day to set which subject has priority when multiple teachers request the same student. #1 is the day’s focus (like “Tuesday = English” on the handout)."
          : "Subject with priority for each day — if several teachers request the same student, the teacher in the higher-priority subject keeps them."}
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: compact
            ? "repeat(auto-fit, minmax(120px, 1fr))"
            : "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 10,
        }}
      >
        {calendar.days.map((d) => (
          <button
            key={d.day}
            type="button"
            onClick={() => openDay(d)}
            disabled={!editable}
            style={{
              textAlign: "left",
              border: d.isToday
                ? "2px solid #a8aeb8"
                : "1px solid rgba(168, 174, 184, 0.3)",
              borderRadius: 14,
              padding: compact ? "0.75rem" : "1rem",
              background: d.isToday
                ? "linear-gradient(165deg, #a68528 0%, #6b5618 100%)"
                : "linear-gradient(165deg, #8a7020 0%, #5c4a12 55%, #4a3c0e 100%)",
              cursor: editable ? "pointer" : "default",
              boxShadow: "0 8px 24px rgba(74, 60, 14, 0.35)",
              color: "#a8aeb8",
            }}
          >
            <div
              className="row"
              style={{ justifyContent: "space-between", marginBottom: 6 }}
            >
              <strong style={{ color: "#b8bec8" }}>{d.day}</strong>
              {d.isToday ? (
                <span
                  className="badge"
                  style={{
                    background: "rgba(168, 174, 184, 0.14)",
                    color: "#a8aeb8",
                    border: "1px solid rgba(168, 174, 184, 0.35)",
                  }}
                >
                  Today
                </span>
              ) : null}
            </div>
            <div
              style={{
                fontSize: "0.8rem",
                color: "#8b929e",
              }}
            >
              {d.dateLabel}
            </div>
            <div
              style={{
                marginTop: 10,
                fontWeight: 750,
                fontSize: compact ? "0.95rem" : "1.1rem",
                letterSpacing: "-0.02em",
                color: d.primarySubject ? "#a8aeb8" : "#7a8190",
              }}
            >
              {d.primarySubject || "No priority set"}
            </div>
            {d.subjectOrder.length > 1 ? (
              <div
                style={{
                  fontSize: "0.75rem",
                  marginTop: 6,
                  color: "#8b929e",
                }}
              >
                Then: {d.subjectOrder.slice(1, 4).join(" → ")}
                {d.subjectOrder.length > 4 ? "…" : ""}
              </div>
            ) : null}
            {d.note ? (
              <div
                style={{
                  fontSize: "0.75rem",
                  marginTop: 6,
                  color: "#8b929e",
                }}
              >
                {d.note}
              </div>
            ) : null}
          </button>
        ))}
      </div>

      {editable && selectedDay ? (
        <div className="card card-pad stack">
          <div
            className="row"
            style={{ justifyContent: "space-between" }}
          >
            <h3 className="section-title" style={{ margin: 0 }}>
              Edit {selectedDay} priority
            </h3>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setSelectedDay(null)}
            >
              Close
            </button>
          </div>

          <div className="field">
            <label>Primary subject for this day (#1 priority)</label>
            <select
              className="select"
              value={draftPrimary}
              onChange={(e) => {
                const v = e.target.value;
                setDraftPrimary(v);
                if (v) {
                  setDraftOrder((prev) => [
                    v,
                    ...prev.filter((s) => s !== v),
                  ]);
                }
              }}
            >
              <option value="">— None —</option>
              {subjects.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div
              className="muted"
              style={{
                fontSize: "0.75rem",
                fontWeight: 700,
                marginBottom: 6,
              }}
            >
              FULL ORDER (optional — click to include, arrows to reorder)
            </div>
            <div className="stack" style={{ gap: 6 }}>
              {subjects.map((s) => {
                const inOrder = draftOrder.includes(s);
                const rank = inOrder ? draftOrder.indexOf(s) + 1 : null;
                return (
                  <div
                    key={s}
                    className="row"
                    style={{
                      justifyContent: "space-between",
                      padding: "0.45rem 0.65rem",
                      borderRadius: 10,
                      border: "1px solid var(--border)",
                      background: inOrder ? "var(--brand-soft)" : "#f8fafc",
                    }}
                  >
                    <label className="checkbox-row" style={{ flex: 1 }}>
                      <input
                        type="checkbox"
                        checked={inOrder}
                        onChange={() => toggleInOrder(s)}
                      />
                      {rank ? (
                        <span className="badge badge-blue">#{rank}</span>
                      ) : null}
                      {s}
                    </label>
                    {inOrder ? (
                      <div className="row">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => moveInOrder(s, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => moveInOrder(s, 1)}
                        >
                          ↓
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="field">
            <label>Note (optional)</label>
            <input
              className="input"
              value={draftNote}
              onChange={(e) => setDraftNote(e.target.value)}
              placeholder='e.g. "English focus — Showcase prep none"'
            />
          </div>

          <div className="row">
            <button
              className="btn btn-primary"
              disabled={saving || (!draftPrimary && draftOrder.length === 0)}
              onClick={saveDay}
            >
              Save {selectedDay}
            </button>
            <button
              className="btn btn-danger btn-sm"
              disabled={saving}
              onClick={() => clearDay(selectedDay)}
            >
              Clear day
            </button>
          </div>
        </div>
      ) : null}

      {!editable && calendar.days.every((d) => !d.primarySubject) ? (
        <div className="empty" style={{ padding: "1rem" }}>
          Admin has not set subject priorities for this week yet.
        </div>
      ) : null}
    </div>
  );
}

/** Small strip for dashboards: today + week chips */
export function PriorityCalendarStrip({ sessionId }: { sessionId: string }) {
  const [calendar, setCalendar] = useState<CalendarData | null>(null);

  useEffect(() => {
    api<{ calendar: CalendarData }>(`/api/calendar?sessionId=${sessionId}`)
      .then((d) => setCalendar(d.calendar))
      .catch(() => {});
  }, [sessionId]);

  if (!calendar) return null;

  return (
    <div
      className="card card-pad"
      style={{
        background:
          "linear-gradient(165deg, #8a7020 0%, #5c4a12 55%, #4a3c0e 100%)",
        border: "1px solid #6b5618",
        color: "#a8aeb8",
      }}
    >
      <div
        className="row"
        style={{ justifyContent: "space-between", marginBottom: 8 }}
      >
        <strong style={{ fontSize: "0.95rem", color: "#b8bec8" }}>
          Subject priority this week
        </strong>
        <span style={{ fontSize: "0.8rem", color: "#8b929e" }}>
          {calendar.weekLabel}
        </span>
      </div>
      <div className="row" style={{ gap: 8 }}>
        {calendar.days.map((d) => (
          <div
            key={d.day}
            style={{
              flex: "1 1 0",
              minWidth: 70,
              padding: "0.5rem 0.55rem",
              borderRadius: 10,
              border: d.isToday
                ? "2px solid #a8aeb8"
                : "1px solid rgba(168, 174, 184, 0.3)",
              background: d.isToday
                ? "rgba(168, 174, 184, 0.12)"
                : "rgba(0, 0, 0, 0.22)",
              textAlign: "center",
              color: "#a8aeb8",
            }}
          >
            <div
              style={{
                fontWeight: 700,
                fontSize: "0.8rem",
                color: "#b8bec8",
              }}
            >
              {d.day}
            </div>
            <div
              style={{
                fontSize: "0.72rem",
                fontWeight: 650,
                marginTop: 4,
                color: d.primarySubject ? "#a8aeb8" : "#7a8190",
              }}
            >
              {d.primarySubject || "—"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

