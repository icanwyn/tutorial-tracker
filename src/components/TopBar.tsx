"use client";

import Link from "next/link";
import { useEffect } from "react";

export function TopBar({
  subtitle,
  right,
  below,
}: {
  subtitle?: string;
  right?: React.ReactNode;
  /** Sticky secondary nav (e.g. frozen Priority calendar / Offerings sheet) */
  below?: React.ReactNode;
}) {
  useEffect(() => {
    // Keep pinned nav offset correct if topbar height changes
    const el = document.querySelector(".topbar") as HTMLElement | null;
    if (!el) return;
    const set = () => {
      document.documentElement.style.setProperty(
        "--topbar-h",
        `${el.offsetHeight}px`
      );
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [below]);

  return (
    <>
      <header className="topbar">
        <div className="container topbar-inner">
          <Link href="/" className="brand">
            <span className="brand-mark">TT</span>
            <span>
              Tutorial Tracker
              {subtitle ? (
                <span
                  className="muted"
                  style={{ fontWeight: 500, marginLeft: 8 }}
                >
                  · {subtitle}
                </span>
              ) : null}
            </span>
          </Link>
          <div className="row">{right}</div>
        </div>
      </header>
      {below ? (
        <div className="pinned-nav">
          <div className="container pinned-nav-inner">{below}</div>
        </div>
      ) : null}
    </>
  );
}
