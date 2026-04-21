import { formatSpaceLabel } from "../lib/format";
import { SPACES, type GraphPayload, type SpaceKey } from "../lib/types";
import { Card } from "./Card";
import { Metric } from "./Metric";

type Props = {
  graphs: Partial<Record<SpaceKey, GraphPayload>>;
  activeSpace: SpaceKey;
};

export function WorkspaceSummary({ graphs, activeSpace }: Props) {
  return (
    <Card
      eyebrow="Workspace"
      title="Graphen im Überblick"
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {SPACES.map((space) => (
          <Metric
            key={space}
            label={`${formatSpaceLabel(space)}${space === activeSpace ? " · aktiv" : ""}`}
            value={graphs[space] ? `${graphs[space]?.nodes.length ?? 0} Nodes · ${graphs[space]?.edges.length ?? 0} Edges` : "Wartet auf Daten"}
            tone={space === activeSpace ? "accent" : "default"}
          />
        ))}
      </div>
    </Card>
  );
}
