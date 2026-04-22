import { formatSpaceLabel } from "../lib/format";
import type { GraphPayload, Selection, SpaceKey } from "../lib/types";
import { Card } from "./Card";
import { GraphView } from "./GraphView";

const SPACE_STYLES: Record<SpaceKey, string> = {
  expr: "border-brand-200 dark:border-brand-700",
  struct: "border-emerald-200 dark:border-emerald-700",
  sem: "border-violet-200 dark:border-violet-700",
  fusion: "border-amber-200 dark:border-amber-700",
};

type Props = {
  space: SpaceKey;
  graph: GraphPayload | null;
  selection: Selection;
  isActive: boolean;
  onNodeSelect: (submissionId: string) => void;
  onEdgeSelect: (source: string, target: string) => void;
  onActivate: () => void;
  onClearSelection: () => void;
};

export function GraphCard({
  space,
  graph,
  selection,
  isActive,
  onNodeSelect,
  onEdgeSelect,
  onActivate,
  onClearSelection,
}: Props) {
  const selectedNodeId = selection?.space === space && selection.kind === "node" ? selection.submissionId : null;
  const selectedEdgeId =
    selection?.space === space && selection.kind === "edge" ? `${selection.source}::${selection.target}` : null;

  return (
    <div onClick={onActivate} className="min-w-0">
      <Card
        className={`${isActive ? `ring-2 ring-brand-100 dark:ring-brand-700/40 ${SPACE_STYLES[space]}` : ""} transition`}
        eyebrow={`Raum ${formatSpaceLabel(space)}`}
        title={`${formatSpaceLabel(space)} Graph`}
        actions={
          <div
            className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
              isActive
                ? "border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-700 dark:bg-brand-700/15 dark:text-brand-100"
                : "border-slate-200 bg-slate-25 text-slate-600 dark:border-mdn-dark-border dark:bg-mdn-dark-surface dark:text-mdn-dark-muted"
            }`}
          >
            {isActive ? "aktiv" : "bereit"}
          </div>
        }
      >
        <div className="mb-4 flex flex-wrap gap-3 text-sm text-slate-600 dark:text-mdn-dark-muted">
          <div className="rounded-full border border-slate-200 bg-slate-25 px-3 py-1.5 dark:border-mdn-dark-border dark:bg-mdn-dark-surface">
            <span className="font-semibold text-slate-900 dark:text-mdn-dark-text">{graph?.nodes.length ?? 0}</span> Nodes
          </div>
          <div className="rounded-full border border-slate-200 bg-slate-25 px-3 py-1.5 dark:border-mdn-dark-border dark:bg-mdn-dark-surface">
            <span className="font-semibold text-slate-900 dark:text-mdn-dark-text">{graph?.edges.length ?? 0}</span> Edges
          </div>
          <div className="rounded-full border border-slate-200 bg-slate-25 px-3 py-1.5 dark:border-mdn-dark-border dark:bg-mdn-dark-surface">
            <span className="font-semibold text-slate-900 dark:text-mdn-dark-text">{graph?.cluster_legend?.length ?? 0}</span> Cluster
          </div>
          {!!graph?.noise_count && (
            <div className="rounded-full border border-slate-200 bg-slate-25 px-3 py-1.5 dark:border-mdn-dark-border dark:bg-mdn-dark-surface">
              <span className="font-semibold text-slate-900 dark:text-mdn-dark-text">{graph.noise_count}</span> Noise
            </div>
          )}
        </div>

        {!!graph?.cluster_legend?.length && (
          <div className="mb-4 rounded-2xl border border-slate-200/80 bg-slate-25/80 p-3 dark:border-mdn-dark-border dark:bg-mdn-dark-surface/80">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-mdn-dark-muted">Cluster-Legende</div>
            <div className="flex flex-wrap gap-2">
              {graph.cluster_legend.map((cluster) => (
                <div
                  key={cluster.cluster_id}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 dark:border-mdn-dark-border dark:bg-[#212426] dark:text-mdn-dark-text"
                >
                  <span
                    className="inline-block h-3 w-3 rounded-full border"
                    style={{ backgroundColor: cluster.color ?? "#94a3b8", borderColor: cluster.border_color ?? cluster.color ?? "#64748b" }}
                  />
                  <span>{cluster.cluster_id.toUpperCase()}</span>
                  <span className="text-slate-500 dark:text-mdn-dark-muted">{cluster.size}</span>
                </div>
              ))}
              {!!graph.noise_count && (
                <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 dark:border-mdn-dark-border dark:bg-[#212426] dark:text-mdn-dark-text">
                  <span className="inline-block h-3 w-3 rounded-full border border-slate-400 bg-slate-300 dark:border-slate-500 dark:bg-slate-600" />
                  <span>Noise</span>
                  <span className="text-slate-500 dark:text-mdn-dark-muted">{graph.noise_count}</span>
                </div>
              )}
            </div>
          </div>
        )}

        <GraphView
          graph={graph}
          space={space}
          selectedNodeId={selectedNodeId}
          selectedEdgeId={selectedEdgeId}
          onNodeSelect={onNodeSelect}
          onEdgeSelect={onEdgeSelect}
          onClearSelection={onClearSelection}
        />
      </Card>
    </div>
  );
}
