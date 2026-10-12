"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

export type Tab = { id: string; label: string };

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The newspaper: a top navigation row, then the current page, which turns with a fold
 * animation. Links with data-page="<id>" are intercepted; data-scatter first moves the
 * collage pictures aside. Arrow keys and horizontal swipes turn pages too.
 * Without JavaScript every link is a normal link to /?p=<id>.
 */
export function Paper({ page, tabs, notice, children }: { page: string; tabs: Tab[]; notice?: React.ReactNode; children: React.ReactNode }) {
  const router = useRouter();
  const [phase, setPhase] = useState<"enter" | "leave">("enter");
  const [dir, setDir] = useState<"fwd" | "back">("fwd");
  const busy = useRef(false);
  const ref = useRef<HTMLDivElement>(null);
  const index = Math.max(0, tabs.findIndex((t) => t.id === page));

  const go = useCallback(async (id: string, opts: { scatter?: boolean } = {}) => {
    if (busy.current || id === page) return;
    busy.current = true;
    const target = tabs.findIndex((t) => t.id === id);
    setDir(target < index ? "back" : "fwd");
    if (!reduced()) {
      if (opts.scatter) { ref.current?.querySelector(".collage")?.classList.add("scatter"); await sleep(480); }
      setPhase("leave");
      await sleep(400);
    }
    router.push(id === "overview" ? "/" : `/?p=${id}`, { scroll: true });
  }, [index, page, router, tabs]);

  useEffect(() => { setPhase("enter"); busy.current = false; }, [page]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[data-page]");
      if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      void go(a.dataset.page!, { scatter: a.hasAttribute("data-scatter") });
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [go]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable]") || e.altKey || e.metaKey || e.ctrlKey) return;
      if (e.key === "ArrowRight" && index < tabs.length - 1) void go(tabs[index + 1].id);
      if (e.key === "ArrowLeft" && index > 0) void go(tabs[index - 1].id);
    };
    let x0 = 0, y0 = 0;
    const onStart = (e: TouchEvent) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; };
    const onEnd = (e: TouchEvent) => {
      const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
      if (Math.abs(dx) < 80 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
      if ((e.target as HTMLElement).closest(".topnav, pre, iframe, .rows")) return;
      if (dx < 0 && index < tabs.length - 1) void go(tabs[index + 1].id);
      if (dx > 0 && index > 0) void go(tabs[index - 1].id);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("touchstart", onStart); window.removeEventListener("touchend", onEnd); };
  }, [go, index, tabs]);

  return (
    <>
      <nav className="topnav" aria-label="Pages">
        {tabs.map((t) => (
          <a key={t.id} href={t.id === "overview" ? "/" : `/?p=${t.id}`} data-page={t.id} className={t.id === page ? "on" : ""} aria-current={t.id === page ? "page" : undefined}>
            {t.label}
          </a>
        ))}
      </nav>
      {notice}
      <div ref={ref} key={page} className={`page ${phase}${dir === "back" ? " back" : ""}`}>{children}</div>
    </>
  );
}
