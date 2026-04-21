import { formatSpaceLabel } from "../lib/format";
import type { SpaceKey } from "../lib/types";

type Props = {
  activeSpace: SpaceKey;
  hasGraphs: boolean;
};

export function PageHeader({ activeSpace, hasGraphs }: Props) {
  return (
    <header className="mb-8 border-b border-slate-200/80 dark:border-mdn-dark-border pb-7">
      <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-mdn-dark-muted">Experimental</div>
      <h1 className="max-w-4xl text-4xl font-bold tracking-[-0.04em] text-slate-950 dark:text-mdn-dark-text sm:text-5xl">GraphRW</h1>

      <div className="mt-6 flex flex-wrap gap-3">
        <div className="rounded-full border border-slate-200 bg-white/80 px-4 py-2 text-sm text-slate-700 shadow-sm backdrop-blur dark:border-mdn-dark-border dark:bg-[#212426] dark:text-mdn-dark-muted">
          Aktiver Raum: <span className="font-semibold text-slate-900 dark:text-mdn-dark-text">{formatSpaceLabel(activeSpace)}</span>
        </div>
        <div className="rounded-full border border-slate-200 bg-white/80 px-4 py-2 text-sm text-slate-700 shadow-sm backdrop-blur dark:border-mdn-dark-border dark:bg-[#212426] dark:text-mdn-dark-muted">
          Sichtbarkeit: <span className="font-semibold text-slate-900 dark:text-mdn-dark-text">{hasGraphs ? "4 Graphen parallel" : "bereit zum Laden"}</span>
        </div>
      </div>
    </header>
  );
}
