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
        </div>

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
