import { formatSpaceLabel } from "../lib/format";
import type { GraphPayload, Selection, SpaceKey } from "../lib/types";
import { Card } from "./Card";
import { GraphClusterList } from "./GraphClusterList";
import { GraphView } from "./GraphView";

const SPACE_STYLES: Record<SpaceKey, string> = {
  expr: "border-brand-200 dark:border-brand-700",
  struct: "border-emerald-200 dark:border-emerald-700",
  sem: "border-violet-200 dark:border-violet-700",
  fusion: "border-amber-200 dark:border-amber-700",
  embedding: "border-cyan-200 dark:border-cyan-700",
  supervised: "border-rose-200 dark:border-rose-700",
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

export function GraphCard({ space, graph, selection, isActive, onNodeSelect, onEdgeSelect, onActivate, onClearSelection }: Props) {
  const selectedNodeId = selection?.space === space && selection.kind === "node" ? selection.submissionId : null;
  const selectedEdgeId = selection?.space === space && selection.kind === "edge" ? `${selection.source}::${selection.target}` : null;
  const similarityStats = graph?.meta?.similarity_stats;
  const clusterCount = graph?.meta?.cluster_meta?.cluster_count ?? graph?.cluster_legend?.filter((item) => !item.is_noise).length ?? 0;
  const noiseCount = graph?.meta?.cluster_meta?.noise_count ?? graph?.cluster_legend?.find((item) => item.is_noise)?.size ?? 0;

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
        <div className="mb-4 grid grid-cols-2 gap-3 text-sm text-slate-600 dark:text-mdn-dark-muted xl:grid-cols-4">
          <StatPill label="Nodes" value={graph?.nodes.length ?? 0} />
          <StatPill label="Edges" value={graph?.edges.length ?? 0} />
          <StatPill label="Cluster" value={clusterCount} />
          <StatPill label="Noise" value={noiseCount} />
        </div>

        {similarityStats ? (
          <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-25 p-3 dark:border-mdn-dark-border dark:bg-mdn-dark-surface">
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600 dark:text-mdn-dark-muted">
              <span>P50 {Number(similarityStats.p50 ?? 0).toFixed(2)}</span>
              <span>P90 {Number(similarityStats.p90 ?? 0).toFixed(2)}</span>
              <span>Mean {Number(similarityStats.mean ?? 0).toFixed(2)}</span>
            </div>
            <div className="mt-3 flex items-end gap-1">
              {(similarityStats.histogram ?? []).map((bin) => {
                const maxCount = Math.max(1, ...(similarityStats.histogram ?? []).map((item) => item.count));
                const height = `${Math.max(10, (bin.count / maxCount) * 56)}px`;
                return (
                  <div key={bin.label} className="flex-1 text-center">
                    <div className="w-full rounded-t bg-slate-300 dark:bg-slate-600" style={{ height }} />
                    <div className="mt-1 text-[10px] text-slate-500 dark:text-mdn-dark-muted">{bin.label}</div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {graph?.cluster_legend?.length ? (
          <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-25 p-3 dark:border-mdn-dark-border dark:bg-mdn-dark-surface">
            <div className="mb-2 text-sm font-semibold text-slate-900 dark:text-mdn-dark-text">Cluster-Legende</div>
            <div className="flex flex-wrap gap-2">
              {graph.cluster_legend.map((item) => (
                <div
                  key={`${item.label}-${item.cluster_id ?? "noise"}`}
                  className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-mdn-dark-text"
                  style={{ borderColor: item.border_color, backgroundColor: `${item.color}22` }}
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                  <span>{item.label}</span>
                  <span className="text-slate-500 dark:text-mdn-dark-muted">{item.size}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <GraphView
          graph={graph}
          space={space}
          selectedNodeId={selectedNodeId}
          selectedEdgeId={selectedEdgeId}
          onNodeSelect={onNodeSelect}
          onEdgeSelect={onEdgeSelect}
          onClearSelection={onClearSelection}
        />

        {isActive ? <GraphClusterList graph={graph} onNodeSelect={onNodeSelect} onEdgeSelect={onEdgeSelect} /> : null}
      </Card>
    </div>
  );
}

function StatPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-full border border-slate-200 bg-slate-25 px-3 py-1.5 dark:border-mdn-dark-border dark:bg-mdn-dark-surface">
      <span className="font-semibold text-slate-900 dark:text-mdn-dark-text">{value}</span> {label}
    </div>
  );
}
