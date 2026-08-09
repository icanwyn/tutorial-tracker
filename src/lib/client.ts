"use client";

import type { Person } from "./types";

const PERSON_KEY = "tt_person";
const SESSION_KEY = "tt_session";
const TEACHER_JOIN_KEY = "tt_teacher_join";
const STUDENT_KEY = "tt_student";

export function savePerson(person: Person) {
  if (typeof window === "undefined") return;
  localStorage.setItem(PERSON_KEY, JSON.stringify(person));
}

export function loadPerson(): Person | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PERSON_KEY);
    return raw ? (JSON.parse(raw) as Person) : null;
  } catch {
    return null;
  }
}

export function clearPerson() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(PERSON_KEY);
}

export function saveSessionId(id: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(SESSION_KEY, id);
}

export function loadSessionId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(SESSION_KEY);
}

export function saveTeacherJoin(data: {
  sessionId: string;
  teacherId: string;
  roomName: string;
  isOpenStudy: boolean;
}) {
  if (typeof window === "undefined") return;
  localStorage.setItem(TEACHER_JOIN_KEY, JSON.stringify(data));
}

export function loadTeacherJoin(): {
  sessionId: string;
  teacherId: string;
  roomName: string;
  isOpenStudy: boolean;
} | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(TEACHER_JOIN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveStudentId(id: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STUDENT_KEY, id);
}

export function loadStudentId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STUDENT_KEY);
}

export async function api<T = unknown>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export {
  parseRosterText,
  parseRosterFile,
  formatRosterPreview,
  type RosterParseRow,
  type ParseResult,
} from "./rosterParse";
