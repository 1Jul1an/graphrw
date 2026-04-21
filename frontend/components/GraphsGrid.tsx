import { SPACES, type GraphPayload, type Selection, type SpaceKey } from "../lib/types";
import { GraphCard } from "./GraphCard";

type Props = {
  graphs: Partial<Record<SpaceKey, GraphPayload>>;
  activeSpace: SpaceKey;
  selection: Selection;
  onNodeSelect: (space: SpaceKey, submissionId: string) => void;
  onEdgeSelect: (space: SpaceKey, source: string, target: string) => void;
  onActivateSpace: (space: SpaceKey) => void;
  onClearSelection: () => void;
};

export function GraphsGrid({
  graphs,
  activeSpace,
  selection,
  onNodeSelect,
  onEdgeSelect,
  onActivateSpace,
  onClearSelection,
}: Props) {
  return (
    <section>
      <div className="mb-5 flex flex-col gap-2 border-b border-slate-200/80 dark:border-mdn-dark-border pb-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-mdn-dark-muted">Graphen</div>
        <h2 className="text-2xl font-semibold tracking-[-0.02em] text-slate-950 dark:text-mdn-dark-text">Alle vier Räume</h2>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {SPACES.map((space) => (
          <GraphCard
            key={space}
            space={space}
            graph={graphs[space] ?? null}
            selection={selection}
            isActive={activeSpace === space}
            onActivate={() => onActivateSpace(space)}
            onNodeSelect={(submissionId) => onNodeSelect(space, submissionId)}
            onEdgeSelect={(source, target) => onEdgeSelect(space, source, target)}
            onClearSelection={onClearSelection}
          />
        ))}
      </div>
    </section>
  );
}
