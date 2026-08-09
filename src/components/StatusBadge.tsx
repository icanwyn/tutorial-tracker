import type { AttendanceStatus } from "@/lib/types";

export function StatusBadge({ status }: { status: AttendanceStatus }) {
  const map: Record<AttendanceStatus, { cls: string; label: string }> = {
    present: { cls: "badge-green", label: "Present" },
    absent: { cls: "badge-red", label: "Absent" },
    excused: { cls: "badge-amber", label: "Excused" },
    unmarked: { cls: "badge-gray", label: "Unmarked" },
  };
  const m = map[status] || map.unmarked;
  return <span className={`badge ${m.cls}`}>{m.label}</span>;
}
