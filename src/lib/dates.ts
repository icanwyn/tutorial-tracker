import type { DayOfWeek } from "./types";
import { DAYS } from "./types";

/** Return ISO date (YYYY-MM-DD) for the Monday of the week containing `d`. */
export function mondayOfWeek(d: Date = new Date()): string {
  const date = new Date(d);
  const day = date.getDay(); // 0 Sun … 6 Sat
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return toISODate(date);
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function dayOfWeekFromDate(iso: string): DayOfWeek | null {
  const d = new Date(iso + "T12:00:00");
  const js = d.getDay();
  // Mon=1 … Fri=5
  if (js < 1 || js > 5) return null;
  return DAYS[js - 1]!;
}

/** Map DayOfWeek to ISO date given week Monday */
export function dateForDay(weekOf: string, day: DayOfWeek): string {
  const idx = DAYS.indexOf(day);
  const d = new Date(weekOf + "T12:00:00");
  d.setDate(d.getDate() + idx);
  return toISODate(d);
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function todayDay(): DayOfWeek | null {
  return dayOfWeekFromDate(todayISO());
}

export function formatWeekLabel(weekOf: string): string {
  const mon = new Date(weekOf + "T12:00:00");
  const fri = new Date(mon);
  fri.setDate(fri.getDate() + 4);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const year = mon.getFullYear();
  return `${mon.toLocaleDateString("en-US", opts)} – ${fri.toLocaleDateString("en-US", opts)}, ${year}`;
}

export function formatMonthLabel(year: number, month: number): string {
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export function addMonths(year: number, month: number, delta: number): {
  year: number;
  month: number;
} {
  const d = new Date(year, month - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

/** School year: Aug 1 → Jun 30 (Northern hemisphere typical). */
export function schoolYearForDate(d: Date = new Date()): {
  label: string;
  startDate: string;
  endDate: string;
  startYear: number;
} {
  const y = d.getFullYear();
  const m = d.getMonth(); // 0–11
  const startYear = m >= 7 ? y : y - 1; // Aug–Dec → this year; Jan–Jul → previous
  return {
    label: `${startYear}–${String(startYear + 1).slice(2)}`,
    startDate: `${startYear}-08-01`,
    endDate: `${startYear + 1}-06-30`,
    startYear,
  };
}

/** All Mondays (week starts) in the school year that have Mon–Fri school days. */
export function weeksInSchoolYear(startDate: string, endDate: string): string[] {
  const weeks: string[] = [];
  let mon = mondayOfWeek(new Date(startDate + "T12:00:00"));
  // If Monday is before year start, step forward
  while (mon < startDate) {
    mon = addDays(mon, 7);
  }
  while (mon <= endDate) {
    weeks.push(mon);
    mon = addDays(mon, 7);
  }
  return weeks;
}

/** Calendar cells for a month view (includes leading/trailing days). */
export function monthGrid(year: number, month: number): {
  date: string;
  inMonth: boolean;
  isWeekend: boolean;
  dayOfWeek: number;
}[] {
  const first = new Date(year, month - 1, 1);
  const startPad = (first.getDay() + 6) % 7; // Mon=0 … Sun=6
  const gridStart = new Date(year, month - 1, 1 - startPad);
  const cells: {
    date: string;
    inMonth: boolean;
    isWeekend: boolean;
    dayOfWeek: number;
  }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    const iso = toISODate(d);
    const js = d.getDay();
    cells.push({
      date: iso,
      inMonth: d.getMonth() === month - 1,
      isWeekend: js === 0 || js === 6,
      dayOfWeek: js,
    });
  }
  return cells;
}

export function formatShortDate(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
