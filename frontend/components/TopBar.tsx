import { compactSpaceLabel } from "../lib/format";
import type { RunPayload, SpaceKey } from "../lib/types";
import { ThemeToggle } from "./ThemeToggle";

type Props = {
  activeSpace: SpaceKey;
  run: RunPayload | null;
};

export function TopBar({ activeSpace, run }: Props) {
  return (
    <div className="sticky top-0 z-40 border-b border-slate-250/90 bg-white/80 backdrop-blur-xl dark:border-mdn-dark-border dark:bg-[#18191be6]">
      <div className="flex w-full items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-mdn-dark-muted">Experimental</div>
          <div className="truncate text-sm font-semibold text-slate-900 dark:text-mdn-dark-text">GraphRW</div>
        </div>

        <div className="flex items-center gap-3">
          <ThemeToggle />
          <div className="hidden items-center gap-3 sm:flex">
            <div className="rounded-full border border-slate-250 bg-white/70 px-3 py-1.5 text-xs text-slate-700 backdrop-blur dark:border-mdn-dark-border dark:bg-[#212426] dark:text-mdn-dark-muted">
              Aktiver Raum: <span className="font-semibold text-slate-900 dark:text-mdn-dark-text">{compactSpaceLabel(activeSpace)}</span>
            </div>
            <div className="rounded-full border border-slate-250 bg-white/70 px-3 py-1.5 text-xs text-slate-700 backdrop-blur dark:border-mdn-dark-border dark:bg-[#212426] dark:text-mdn-dark-muted">
              Run: <span className="font-semibold text-slate-900 dark:text-mdn-dark-text">{run?.status ?? "idle"}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
