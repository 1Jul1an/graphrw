import Link from "next/link";
import { compactEngineLabel, compactSpaceLabel } from "../lib/format";
import type { EngineKey, RunPayload, SpaceKey } from "../lib/types";
import { ThemeToggle } from "./ThemeToggle";

type Props = {
  activeEngine?: EngineKey;
  activeSpace?: SpaceKey;
  run?: RunPayload | null;
};

export function TopBar({ activeEngine, activeSpace, run }: Props) {
  return (
    <div className="sticky top-0 z-40 border-b border-slate-250/90 bg-white/80 backdrop-blur-xl dark:border-mdn-dark-border dark:bg-[#18191be6]">
      <div className="flex w-full items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-5">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-mdn-dark-muted">Experimental</div>
            <div className="truncate text-sm font-semibold text-slate-900 dark:text-mdn-dark-text">GraphRW</div>
          </div>
          <nav className="hidden items-center rounded-full border border-slate-250 bg-white/70 p-1 text-xs font-semibold text-slate-600 dark:border-mdn-dark-border dark:bg-[#212426] dark:text-mdn-dark-muted sm:flex">
            <Link href="/" className="rounded-full px-3 py-1.5 transition hover:bg-slate-100 hover:text-slate-950 dark:hover:bg-[#2a2d30] dark:hover:text-mdn-dark-text">
              Workspace
            </Link>
            <Link href="/drift" className="rounded-full px-3 py-1.5 transition hover:bg-slate-100 hover:text-slate-950 dark:hover:bg-[#2a2d30] dark:hover:text-mdn-dark-text">
              Drift-Workspace
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <ThemeToggle />
          {activeEngine && activeSpace ? (
            <div className="hidden items-center gap-3 sm:flex">
              <div className="rounded-full border border-slate-250 bg-white/70 px-3 py-1.5 text-xs text-slate-700 backdrop-blur dark:border-mdn-dark-border dark:bg-[#212426] dark:text-mdn-dark-muted">
                Engine: <span className="font-semibold text-slate-900 dark:text-mdn-dark-text">{compactEngineLabel(activeEngine)}</span>
              </div>
              <div className="rounded-full border border-slate-250 bg-white/70 px-3 py-1.5 text-xs text-slate-700 backdrop-blur dark:border-mdn-dark-border dark:bg-[#212426] dark:text-mdn-dark-muted">
                Raum: <span className="font-semibold text-slate-900 dark:text-mdn-dark-text">{compactSpaceLabel(activeSpace)}</span>
              </div>
              <div className="rounded-full border border-slate-250 bg-white/70 px-3 py-1.5 text-xs text-slate-700 backdrop-blur dark:border-mdn-dark-border dark:bg-[#212426] dark:text-mdn-dark-muted">
                Run: <span className="font-semibold text-slate-900 dark:text-mdn-dark-text">{run?.status ?? "idle"}</span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
