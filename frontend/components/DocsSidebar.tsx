import { formatSpaceLabel } from "../lib/format";
import { SPACES, type GraphPayload, type RunPayload, type SpaceKey } from "../lib/types";

type Props = {
  activeSpace: SpaceKey;
  graphs: Partial<Record<SpaceKey, GraphPayload>>;
  run: RunPayload | null;
};

const LINKS = [
  { href: "#setup", label: "Setup" },
  { href: "#workspace", label: "Workspace" },
  { href: "#graphs", label: "Graphen" },
  { href: "#inspector", label: "Inspector" },
];

export function DocsSidebar({ activeSpace, graphs, run }: Props) {
  return (
    <div className="sticky top-24 space-y-4">
      <div className="docs-card overflow-hidden p-0">
        <div className="border-b border-slate-150 px-5 py-4 dark:border-mdn-dark-border">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-mdn-dark-muted">Navigation</div>
        </div>
        <nav className="p-2">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="flex items-center justify-between rounded-xl px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-75 hover:text-slate-900 dark:text-mdn-dark-muted dark:hover:bg-[#2a2d30] dark:hover:text-mdn-dark-text"
            >
              <span>{link.label}</span>
              <span className="text-slate-400 dark:text-mdn-dark-muted">→</span>
            </a>
          ))}
        </nav>
      </div>

      <div className="docs-card p-5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-mdn-dark-muted">Räume</div>
        <div className="mt-4 space-y-2">
          {SPACES.map((space) => {
            const graph = graphs[space];
            const isActive = space === activeSpace;
            return (
              <div
                key={space}
                className={`rounded-xl border px-3 py-3 ${isActive ? "border-brand-200 bg-brand-50 dark:border-brand-700 dark:bg-brand-700/15" : "border-slate-200 bg-slate-25 dark:border-mdn-dark-border dark:bg-mdn-dark-surface"}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-900 dark:text-mdn-dark-text">{formatSpaceLabel(space)}</div>
                  {isActive ? <span className="text-xs font-medium text-brand-700 dark:text-brand-100">aktiv</span> : null}
                </div>
                <div className="mt-1 text-xs leading-5 text-slate-600 dark:text-mdn-dark-muted">
                  {graph ? `${graph.nodes.length} Nodes · ${graph.edges.length} Edges` : "wartet auf Daten"}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="docs-card p-5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-mdn-dark-muted">Pipeline</div>
        <div className="mt-3 text-sm leading-6 text-slate-700 dark:text-mdn-dark-muted">
          Status <span className="font-semibold text-slate-900 dark:text-mdn-dark-text">{run?.status ?? "idle"}</span>
        </div>
      </div>
    </div>
  );
}
