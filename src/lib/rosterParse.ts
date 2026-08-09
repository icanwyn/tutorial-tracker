/**
 * Parse class rosters from paste text, CSV, or Excel workbooks.
 * Column headers are flexible (First/Last/Name/Period/Subject/ID).
 */

export type RosterParseRow = {
  firstName: string;
  lastName: string;
  period: string;
  subject: string;
  studentId?: string;
  grade?: "7" | "8" | null;
};

export type ParseResult = {
  rows: RosterParseRow[];
  warnings: string[];
  sourceLabel: string;
};

const HEADER_ALIASES: Record<string, keyof RosterParseRow | "fullName"> = {
  first: "firstName",
  firstname: "firstName",
  first_name: "firstName",
  "first name": "firstName",
  fname: "firstName",
  given: "firstName",
  givenname: "firstName",
  "given name": "firstName",
  last: "lastName",
  lastname: "lastName",
  last_name: "lastName",
  "last name": "lastName",
  lname: "lastName",
  surname: "lastName",
  family: "lastName",
  familyname: "lastName",
  "family name": "lastName",
  name: "fullName",
  student: "fullName",
  studentname: "fullName",
  "student name": "fullName",
  fullname: "fullName",
  "full name": "fullName",
  period: "period",
  per: "period",
  classperiod: "period",
  "class period": "period",
  pd: "period",
  p: "period",
  subject: "subject",
  course: "subject",
  class: "subject",
  classname: "subject",
  "class name": "subject",
  coursename: "subject",
  "course name": "subject",
  id: "studentId",
  studentid: "studentId",
  student_id: "studentId",
  "student id": "studentId",
  sid: "studentId",
  "school id": "studentId",
  schoolid: "studentId",
  grade: "grade",
  gr: "grade",
};

function normHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitFullName(full: string): { firstName: string; lastName: string } {
  const cleaned = full.trim().replace(/\s+/g, " ");
  if (!cleaned) return { firstName: "", lastName: "" };

  // "Last, First" or "Last, First Middle"
  if (cleaned.includes(",")) {
    const [last, rest = ""] = cleaned.split(",").map((s) => s.trim());
    return { firstName: rest || "—", lastName: last || "—" };
  }

  const parts = cleaned.split(" ");
  if (parts.length === 1) return { firstName: parts[0]!, lastName: "—" };
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1]!,
  };
}

function cellStr(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number" && Number.isFinite(v)) {
    // Excel sometimes stores IDs as numbers
    return String(v);
  }
  return String(v).trim();
}

/** Map header row → field indices */
function mapHeaders(headers: string[]): {
  map: Partial<Record<keyof RosterParseRow | "fullName", number>>;
  usedHeaderRow: boolean;
} {
  const map: Partial<Record<keyof RosterParseRow | "fullName", number>> = {};
  let hits = 0;

  headers.forEach((h, i) => {
    const key = HEADER_ALIASES[normHeader(h)];
    if (key && map[key] === undefined) {
      map[key] = i;
      hits++;
    }
  });

  // Heuristic default if no headers recognized: first, last, period, subject [, id]
  if (hits === 0) {
    return {
      map: {
        firstName: 0,
        lastName: 1,
        period: 2,
        subject: 3,
        studentId: 4,
      },
      usedHeaderRow: false,
    };
  }

  return { map, usedHeaderRow: true };
}

function rowFromCells(
  cells: string[],
  map: Partial<Record<keyof RosterParseRow | "fullName", number>>
): RosterParseRow | null {
  let firstName = "";
  let lastName = "";

  if (map.fullName !== undefined) {
    const full = cells[map.fullName] || "";
    const split = splitFullName(full);
    firstName = split.firstName;
    lastName = split.lastName;
  }

  if (map.firstName !== undefined) {
    firstName = cells[map.firstName] || firstName;
  }
  if (map.lastName !== undefined) {
    lastName = cells[map.lastName] || lastName;
  }

  // Fallback: first two non-empty cells if still missing
  if (!firstName && !lastName) {
    const nonempty = cells.filter(Boolean);
    if (nonempty.length >= 2) {
      firstName = nonempty[0]!;
      lastName = nonempty[1]!;
    } else if (nonempty.length === 1) {
      const split = splitFullName(nonempty[0]!);
      firstName = split.firstName;
      lastName = split.lastName;
    }
  }

  firstName = firstName.trim();
  lastName = lastName.trim();
  if (!firstName && !lastName) return null;
  if (!firstName) firstName = "—";
  if (!lastName) lastName = "—";

  // Skip residual header-looking rows
  if (
    /^(first|last|name|student)$/i.test(firstName) &&
    /^(last|name|first|student)?$/i.test(lastName)
  ) {
    return null;
  }

  const period =
    (map.period !== undefined ? cells[map.period] : "") || "—";
  const subject =
    (map.subject !== undefined ? cells[map.subject] : "") || "—";
  const studentId =
    map.studentId !== undefined ? cells[map.studentId] || undefined : undefined;

  let grade: "7" | "8" | null = null;
  if (map.grade !== undefined) {
    const g = (cells[map.grade] || "").replace(/[^0-9]/g, "");
    if (g === "7" || g === "8") grade = g;
  }

  return {
    firstName,
    lastName,
    period: period.trim() || "—",
    subject: subject.trim() || "—",
    studentId: studentId?.trim() || undefined,
    grade,
  };
}

function parseMatrix(matrix: unknown[][], sourceLabel: string): ParseResult {
  const warnings: string[] = [];
  if (!matrix.length) {
    return { rows: [], warnings: ["File/sheet is empty."], sourceLabel };
  }

  // Find first non-empty row as potential header
  let start = 0;
  while (
    start < matrix.length &&
    !(matrix[start] || []).some((c) => cellStr(c))
  ) {
    start++;
  }
  if (start >= matrix.length) {
    return { rows: [], warnings: ["No data rows found."], sourceLabel };
  }

  const headerCells = (matrix[start] || []).map(cellStr);
  const { map, usedHeaderRow } = mapHeaders(headerCells);

  if (!usedHeaderRow) {
    warnings.push(
      "No column headers detected — assumed order: First, Last, Period, Subject."
    );
  } else {
    if (map.firstName === undefined && map.fullName === undefined) {
      warnings.push(
        "Could not find a First Name or Name column — check your headers."
      );
    }
  }

  const dataStart = usedHeaderRow ? start + 1 : start;
  const rows: RosterParseRow[] = [];
  const seen = new Set<string>();

  for (let i = dataStart; i < matrix.length; i++) {
    const cells = (matrix[i] || []).map(cellStr);
    if (!cells.some(Boolean)) continue;
    const row = rowFromCells(cells, map);
    if (!row) continue;

    const key = `${row.firstName.toLowerCase()}|${row.lastName.toLowerCase()}|${row.period}|${row.subject}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }

  if (rows.length === 0) {
    warnings.push(
      "No student rows parsed. Expected columns like First Name, Last Name, Period, Subject."
    );
  }

  return { rows, warnings, sourceLabel };
}

/** Parse pasted CSV/TSV/plain text (Excel copy often uses tabs). */
export function parseRosterText(text: string): ParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim());

  const matrix: string[][] = lines.map((line) => {
    if (line.includes("\t")) {
      return line.split("\t").map((c) => c.trim());
    }
    // CSV with possible quoted fields
    return splitCsvLine(line);
  });

  return parseMatrix(matrix, "pasted text");
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

/** Parse an Excel/CSV File in the browser via SheetJS. */
export async function parseRosterFile(file: File): Promise<ParseResult> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const workbook = XLSX.read(buf, { type: "array", cellDates: true });

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

  const result = parseMatrix(matrix, file.name);
  if (workbook.SheetNames.length > 1) {
    result.warnings.push(
      `Using first sheet “${sheetName}” (${workbook.SheetNames.length} sheets found).`
    );
  }
  return result;
}

export function formatRosterPreview(rows: RosterParseRow[], max = 5): string {
  return rows
    .slice(0, max)
    .map((r) => `${r.lastName}, ${r.firstName} · P${r.period} ${r.subject}`)
    .join("\n");
}
