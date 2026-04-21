"use client";

import { useEffect, useState } from "react";

function applyTheme(nextTheme: "light" | "dark") {
  const root = document.documentElement;
  root.classList.toggle("dark", nextTheme === "dark");
  root.style.colorScheme = nextTheme;
  window.localStorage.setItem("theme", nextTheme);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem("theme");
    const nextTheme = stored === "dark" ? "dark" : "light";
    setTheme(nextTheme);
    applyTheme(nextTheme);
    setMounted(true);
  }, []);

  function handleToggle() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    applyTheme(nextTheme);
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-pressed={theme === "dark"}
      aria-label={mounted ? `Zu ${theme === "dark" ? "Light" : "Dark"} Mode wechseln` : "Theme umschalten"}
      className="group inline-flex items-center gap-3 rounded-full border border-slate-250 bg-white/80 px-3 py-2 text-xs font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-white dark:border-mdn-dark-border dark:bg-[#212426] dark:text-mdn-dark-text dark:hover:bg-[#272b2e]"
    >
      <span className="hidden sm:inline">{mounted ? (theme === "dark" ? "Dark" : "Light") : "Theme"}</span>
      <span className="relative inline-flex h-6 w-11 items-center rounded-full bg-slate-200 transition dark:bg-[#18191b]">
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition ${theme === "dark" ? "translate-x-5 bg-[#51565d]" : "translate-x-0.5"}`}
        />
      </span>
    </button>
  );
}
