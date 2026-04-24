import { compactEngineLabel } from "../lib/format";
import type { EngineKey, GraphPayload, Selection, SpaceKey } from "../lib/types";
import { GraphCard } from "./GraphCard";

type Props = {
  graphs: Partial<Record<SpaceKey, GraphPayload>>;
  spaces: readonly SpaceKey[];
  activeEngine: EngineKey;
  activeSpace: SpaceKey;
  selection: Selection;
  onNodeSelect: (space: SpaceKey, submissionId: string) => void;
  onEdgeSelect: (space: SpaceKey, source: string, target: string) => void;
  onActivateSpace: (space: SpaceKey) => void;
  onClearSelection: () => void;
};

export function GraphsGrid({
  graphs,
  spaces,
  activeEngine,
  activeSpace,
  selection,
  onNodeSelect,
  onEdgeSelect,
  onActivateSpace,
  onClearSelection,
}: Props) {
  return (
    <section>
      <div className="mb-5 flex flex-col gap-2 border-b border-slate-200/80 pb-4 dark:border-mdn-dark-border">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-mdn-dark-muted">Graphen</div>
        <h2 className="text-2xl font-semibold tracking-[-0.02em] text-slate-950 dark:text-mdn-dark-text">
          {compactEngineLabel(activeEngine)} Workspace
        </h2>
      </div>

      <div className={`grid grid-cols-1 gap-6 ${spaces.length > 1 ? "xl:grid-cols-2" : ""}`}>
        {spaces.map((space) => (
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
