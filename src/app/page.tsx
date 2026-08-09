"use client";

import Link from "next/link";
import { TopBar } from "@/components/TopBar";

export default function HomePage() {
  return (
    <>
      <TopBar />
      <main className="container" style={{ padding: "2rem 0 3rem" }}>
        <div className="hero-card" style={{ marginBottom: "1.5rem" }}>
          <div className="row" style={{ marginBottom: "0.75rem" }}>
            <span className="pulse-dot" />
            <span style={{ fontSize: "0.85rem", fontWeight: 600, opacity: 0.95 }}>
              Schoolwide tutorial program
            </span>
          </div>
          <h1>Know where every student is — and who still needs to check in.</h1>
          <p>
            Plan the year with a priority calendar, publish offerings in advance,
            and run each day with clear rooms, attendance, and open study.
          </p>
        </div>

        <div className="role-grid">
          <Link href="/admin" className="role-card">
            <div className="role-icon">🏫</div>
            <div>
              <h2
                style={{
                  margin: "0 0 0.25rem",
                  fontSize: "1.1rem",
                  color: "var(--gold-bright)",
                }}
              >
                Admin
              </h2>
              <p
                className="muted"
                style={{ margin: 0, fontSize: "0.9rem", lineHeight: 1.45 }}
              >
                Host the week, set year-long priorities, compile offerings, and
                see every student&apos;s room.
              </p>
            </div>
            <span
              className="btn btn-primary"
              style={{ width: "100%", marginTop: "auto" }}
            >
              Open admin console
            </span>
          </Link>

          <Link href="/teacher" className="role-card">
            <div className="role-icon">📋</div>
            <div>
              <h2
                style={{
                  margin: "0 0 0.25rem",
                  fontSize: "1.1rem",
                  color: "var(--gold-bright)",
                }}
              >
                Teacher
              </h2>
              <p
                className="muted"
                style={{ margin: 0, fontSize: "0.9rem", lineHeight: 1.45 }}
              >
                Join with a code, keep your class list, schedule offerings on the
                year calendar, and take attendance.
              </p>
            </div>
            <span
              className="btn btn-accent"
              style={{ width: "100%", marginTop: "auto" }}
            >
              Join as teacher
            </span>
          </Link>

          <Link href="/student" className="role-card">
            <div className="role-icon">🎒</div>
            <div>
              <h2
                style={{
                  margin: "0 0 0.25rem",
                  fontSize: "1.1rem",
                  color: "var(--gold-bright)",
                }}
              >
                Student
              </h2>
              <p
                className="muted"
                style={{ margin: 0, fontSize: "0.9rem", lineHeight: 1.45 }}
              >
                See your placement, browse this week&apos;s offerings, or sign up
                for open rooms when free.
              </p>
            </div>
            <span
              className="btn btn-secondary"
              style={{ width: "100%", marginTop: "auto" }}
            >
              Student portal
            </span>
          </Link>
        </div>

        <div className="card card-pad" style={{ marginTop: "1.5rem" }}>
          <h3 className="section-title">How a week works</h3>
          <ol
            className="muted"
            style={{
              margin: 0,
              paddingLeft: "1.2rem",
              lineHeight: 1.7,
              fontSize: "0.95rem",
            }}
          >
            <li>
              <strong style={{ color: "var(--gold-bright)" }}>Admin</strong> sets
              subject priorities on the year calendar and starts the week.
            </li>
            <li>
              <strong style={{ color: "var(--gold-bright)" }}>Teachers</strong>{" "}
              publish offerings in advance, keep class lists on their account, and
              request required students.
            </li>
            <li>
              Free students choose open rooms; admin auto-places anyone left.
            </li>
            <li>
              Teachers take attendance; admin sees every room and who is missing.
            </li>
          </ol>
        </div>
      </main>
    </>
  );
}
