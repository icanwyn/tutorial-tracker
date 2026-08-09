/**
 * Parse weekly priority lists (paste or Excel).
 *
 * Expected columns:
 *   First Name, Last Name, Student ID (optional),
 *   Priority 1, Priority 2, Priority 3, ...
 *
 * Priority labels should match a teacher name or room name
 * (e.g. "Room 214" or "Ms. Rivera").
 */

import type { PriorityUploadRow } from "./store";

export type PriorityParseResult = {
  rows: PriorityUploadRow[];
  warnings: string[];
  sourceLabel: string;
};

function cellStr(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function normHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function parseMatrix(
  matrix: unknown[][],
  sourceLabel: string
): PriorityParseResult {
  const warnings: string[] = [];
  if (!matrix.length) {
    return { rows: [], warnings: ["File is empty."], sourceLabel };
  }

  let start = 0;
  while (
    start < matrix.length &&
    !(matrix[start] || []).some((c) => cellStr(c))
  ) {
    start++;
  }
  if (start >= matrix.length) {
    return { rows: [], warnings: ["No data found."], sourceLabel };
  }

  const headers = (matrix[start] || []).map((h) => normHeader(cellStr(h)));

  let firstIdx = headers.findIndex((h) =>
    ["first", "first name", "firstname", "fname"].includes(h)
  );
  let lastIdx = headers.findIndex((h) =>
    ["last", "last name", "lastname", "lname", "surname"].includes(h)
  );
  let idIdx = headers.findIndex((h) =>
    ["id", "student id", "studentid", "sid", "school id"].includes(h)
  );
  let nameIdx = headers.findIndex((h) =>
    ["name", "student", "student name", "full name"].includes(h)
  );

  const priorityIdxs: number[] = [];
  headers.forEach((h, i) => {
    if (
      /^priority\s*\d*$/.test(h) ||
      /^pri\s*\d+$/.test(h) ||
      /^p\d+$/.test(h) ||
      h === "priority" ||
      h.startsWith("priority ")
    ) {
      priorityIdxs.push(i);
    }
  });

  // If no priority headers, treat columns after name fields as ranks
  const usedHeader = firstIdx >= 0 || lastIdx >= 0 || nameIdx >= 0;
  let dataStart = start;

  if (!usedHeader) {
    // Assume: First, Last, P1, P2, P3... or First, Last, ID, P1...
    firstIdx = 0;
    lastIdx = 1;
    idIdx = -1;
    priorityIdxs.length = 0;
    for (let i = 2; i < (matrix[start]?.length || 0); i++) {
      // If third col looks like STU- id, treat as id
      if (i === 2 && /^stu-/i.test(cellStr(matrix[start]?.[i]))) {
        idIdx = 2;
        continue;
      }
      if (idIdx === 2 && i === 2) continue;
      priorityIdxs.push(i);
    }
    warnings.push(
      "No headers detected — assumed First, Last, [ID], Priority1…"
    );
  } else {
    dataStart = start + 1;
    if (priorityIdxs.length === 0) {
      // Remaining columns after known fields
      headers.forEach((_, i) => {
        if (i === firstIdx || i === lastIdx || i === idIdx || i === nameIdx)
          return;
        priorityIdxs.push(i);
      });
    }
  }

  if (priorityIdxs.length === 0) {
    warnings.push(
      "No priority columns found. Add columns like Priority 1, Priority 2 (room or teacher name)."
    );
  }

  const rows: PriorityUploadRow[] = [];

  for (let r = dataStart; r < matrix.length; r++) {
    const cells = (matrix[r] || []).map(cellStr);
    if (!cells.some(Boolean)) continue;

    let firstName = firstIdx >= 0 ? cells[firstIdx] || "" : "";
    let lastName = lastIdx >= 0 ? cells[lastIdx] || "" : "";
    if ((!firstName || !lastName) && nameIdx >= 0) {
      const full = cells[nameIdx] || "";
      if (full.includes(",")) {
        const [last, rest = ""] = full.split(",").map((s) => s.trim());
        lastName = lastName || last || "";
        firstName = firstName || rest || "";
      } else {
        const parts = full.split(/\s+/);
        if (parts.length >= 2) {
          firstName = firstName || parts.slice(0, -1).join(" ");
          lastName = lastName || parts[parts.length - 1] || "";
        }
      }
    }

    if (
      /^(first|last|name|student)$/i.test(firstName) &&
      /^(last|name|first)?$/i.test(lastName)
    ) {
      continue;
    }

    const studentId = idIdx >= 0 ? cells[idIdx] || undefined : undefined;
    const ranks = priorityIdxs.map((i) => cells[i] || "").filter(Boolean);

    if (!firstName && !lastName && !studentId) continue;
    if (ranks.length === 0) continue;

    rows.push({
      firstName: firstName || "—",
      lastName: lastName || "—",
      studentId: studentId || undefined,
      ranks,
    });
  }

  if (rows.length === 0) {
    warnings.push("No priority rows parsed.");
  }

  return { rows, warnings, sourceLabel };
}

export function parsePriorityText(text: string): PriorityParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim());
  const matrix = lines.map((line) =>
    line.includes("\t") ? line.split("\t").map((c) => c.trim()) : splitCsvLine(line)
  );
  return parseMatrix(matrix, "pasted text");
}

export async function parsePriorityFile(file: File): Promise<PriorityParseResult> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const workbook = XLSX.read(buf, { type: "array", raw: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return {
      rows: [],
      warnings: ["Workbook has no sheets."],
      sourceLabel: file.name,
    };
  }
  const sheet = workbook.Sheets[sheetName]!;
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: false,
  }) as unknown[][];
  return parseMatrix(matrix, file.name);
}
